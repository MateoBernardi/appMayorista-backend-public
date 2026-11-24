import type { PoolClient } from 'pg';
import * as repo from '../../adapters/db/licenciasTurnosRepo';
import { jornadaMinutos } from './jornada';
import { compararTs } from './fechaLocal';
import {
    aplicarPorHoras, debeConsumirFranco, repartirJornadaPorDia, revertirPorHoras, solicitudesQueSolapan,
    turnosAMarcarPorDias, turnosARevertirPorDias, ventanaTurnos,
} from './licenciasTurnosReglas';

/**
 * Licencias sobre los turnos (port de aplicar_licencia / revertir_licencia / aplicar_licencias_a_turnos).
 * Todo corre en la transacción del `client` recibido.
 */

/**
 * Aplica una solicitud APROBADA a los turnos que solapa (o solo a `turnoIds`). No es idempotente por
 * sí misma. Devuelve los minutos de solape aplicados (0 para licencias por días).
 */
export const aplicarLicencia = async (client: PoolClient, solicitudId: number, turnoIds?: number[] | null): Promise<number> => {
    const sol = await repo.getSolicitudAprobada(client, solicitudId);
    if (!sol) return 0;
    const ventana = ventanaTurnos(sol);
    if (!ventana) return 0;

    if (sol.cantidad_minutos == null) {
        const todos = await repo.getTurnosUsuario(client, sol.usuario_id, ventana);
        const marcados = turnosAMarcarPorDias(sol, todos, turnoIds);
        await repo.marcarTurnosConLicencia(client, marcados);
        if (marcados.length === 0) return 0;

        // Un día con todos sus turnos en licencia descuenta la jornada del objetivo semanal.
        const actualizados = todos.map(t => (marcados.includes(t.id) ? { ...t, licencia: true } : t));
        const jornada = jornadaMinutos(todos[0]?.minutos_objetivo);
        await repo.setMinutosLicencia(client, repartirJornadaPorDia(actualizados, marcados, jornada));
        return 0;
    }

    const turnos = await repo.getTurnosUsuario(client, sol.usuario_id, {
        ...ventana, ids: turnoIds ?? null, soloSinLicencia: true, bloquear: true,
    });
    const { cambios, total } = aplicarPorHoras(sol, turnos, turnoIds);
    for (const c of cambios) await repo.actualizarTurnoLicencia(client, c);

    if (debeConsumirFranco(sol, total)) await repo.consumirFranco(client, sol.usuario_id, total, sol.id);
    return total;
};

/** Revierte en los turnos una licencia (al cancelarla). No toca saldos_francos. Devuelve los turnos revertidos. */
export const revertirLicencia = async (client: PoolClient, solicitudId: number): Promise<number> => {
    const sol = await repo.getSolicitudPorId(client, solicitudId);
    if (!sol) return 0;
    const ventana = ventanaTurnos(sol);
    if (!ventana) return 0;

    if (sol.cantidad_minutos == null) {
        const todos = await repo.getTurnosUsuario(client, sol.usuario_id, ventana);
        const ids = turnosARevertirPorDias(sol, todos);
        await repo.limpiarLicenciaTurnos(client, ids);
        return ids.length;
    }

    const turnos = await repo.getTurnosUsuario(client, sol.usuario_id, { ...ventana, soloConMinutos: true, bloquear: true });
    if (turnos.length === 0) return 0;
    const otras = await repo.getOtrasSolicitudesHoras(client, sol.usuario_id, sol.id);
    const plantilla = await repo.getPlantillaActiva(client, sol.usuario_id);
    const { cambios, revertidos } = revertirPorHoras(sol, turnos, otras, plantilla);
    for (const c of cambios) await repo.actualizarTurnoLicencia(client, c);
    return revertidos;
};

/** Aplica a turnos recién creados o modificados todas las licencias aprobadas que los solapan. */
export const aplicarLicenciasATurnos = async (client: PoolClient, turnoIds: number[]): Promise<void> => {
    if (!turnoIds || turnoIds.length === 0) return;
    const turnos = (await repo.getTurnosPorIds(client, turnoIds)).filter(t => t.esperado_in != null);
    if (turnos.length === 0) return;

    const usuarios = [...new Set(turnos.map(t => t.user_context_id))];
    const desde = turnos
        .map(t => t.esperado_in as string)
        .reduce((m, ts) => (compararTs(ts, m) < 0 ? ts : m));
    const candidatas = await repo.getSolicitudesAprobadasDeUsuarios(client, usuarios, desde);
    for (const id of solicitudesQueSolapan(turnos, candidatas)) {
        await aplicarLicencia(client, id, turnoIds);
    }
};
