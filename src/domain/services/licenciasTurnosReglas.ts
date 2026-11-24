import {
    TimestampLocal, FechaLocal, compararTs, combinar, diffMinutos, fechaDe, horaMinuto, isoDow, minTs, maxTs, redondearPg, sumarDias, sumarMinutos,
} from './fechaLocal';
import { finTurno } from './jornada';

/**
 * Reglas puras de las licencias sobre los turnos (planificacion_diaria). Port 1:1 de las funciones
 * SQL aplicar_licencia / revertir_licencia (migración 075), aplicar_licencias_a_turnos y
 * planificacion_fin_turno (migración 074). Sin acceso a la DB: los datos entran ya leídos.
 */

export const TIPO_LICENCIA_FRANCO = 2;
const SABADO = 6;
const HORA_CORTE_SABADO = '13:00';

export interface SolicitudLicencia {
    id: number;
    usuario_id: number;
    tipo_licencia_id: number;
    /** timestamp (puede ser null en la DB; sin fechas la solicitud no toca ningún turno). */
    fecha_inicio: TimestampLocal | null;
    fecha_fin: TimestampLocal | null;
    /** NULL = licencia por días. */
    cantidad_minutos: number | null;
}

export interface TurnoLicencia {
    id: number;
    turno: string;
    esperado_in: TimestampLocal | null;
    esperado_out: TimestampLocal | null;
    licencia: boolean;
    minutos_licencia: number;
    generica: boolean;
    /** usuarios_horas_objetivo.minutos_objetivo del usuario (null si no tiene). */
    minutos_objetivo: number | null;
}

/** Turno del usuario más su dueño; solo para aplicarLicenciasATurnos. */
export interface TurnoDeUsuario extends TurnoLicencia {
    user_context_id: number;
}

/** Cambios de una fila de planificacion_diaria. */
export interface CambioTurno {
    id: number;
    esperado_in: TimestampLocal | null;
    esperado_out: TimestampLocal | null;
    licencia: boolean;
    minutos_licencia: number;
}

/** planificacion_fin_turno(pd.id) sobre un turno ya leído (requiere esperado_in). */
export const finDelTurno = (t: TurnoLicencia): TimestampLocal =>
    finTurno(t.esperado_in as TimestampLocal, t.esperado_out, t.minutos_objetivo);

const tieneFechas = (sol: SolicitudLicencia): sol is SolicitudLicencia & { fecha_inicio: TimestampLocal; fecha_fin: TimestampLocal } =>
    sol.fecha_inicio != null && sol.fecha_fin != null;

/** Ventana de esperado_in [desde, hasta) que alcanza para leer los turnos que una solicitud puede tocar. */
export const ventanaTurnos = (sol: SolicitudLicencia): { desde: FechaLocal; hasta: FechaLocal } | null => {
    if (!tieneFechas(sol)) return null;
    // 2 días antes del inicio cubre los turnos que arrancan antes y terminan dentro; +1 día cubre los turnos
    // hermanos del último día tocado (el reparto de la jornada mira el día completo).
    return { desde: sumarDias(sol.fecha_inicio, -2), hasta: sumarDias(sol.fecha_fin, 1) };
};

// ───────────────────────── Rama por días (cantidad_minutos NULL) ─────────────────────────

/** Ids de los turnos que una licencia por días marca con licencia = true. */
export const turnosAMarcarPorDias = (
    sol: SolicitudLicencia,
    turnos: TurnoLicencia[],
    turnoIds?: number[] | null,
): number[] => {
    if (!tieneFechas(sol)) return [];
    return turnos
        .filter(t =>
            !t.licencia
            && (turnoIds == null || turnoIds.includes(t.id))
            && t.esperado_in != null
            && compararTs(t.esperado_in, sol.fecha_inicio) >= 0
            && compararTs(finDelTurno(t), sol.fecha_fin) <= 0)
        .map(t => t.id);
};

/**
 * Reparto de la jornada de cada día tocado. `turnos` debe reflejar ya la marca (licencia = true en los
 * `marcados`). Por cada día (DATE(esperado_in)) de los marcados, sobre los turnos NO genéricos del usuario ese día:
 * si todos tienen licencia y la suma previa de minutos_licencia es 0, cada uno recibe jornada / n (entero)
 * y el primero (orden esperado_in, id) además el resto. Devuelve id → minutos_licencia nuevos.
 */
export const repartirJornadaPorDia = (
    turnos: TurnoLicencia[],
    marcados: number[],
    jornada: number,
): Array<{ id: number; minutos_licencia: number }> => {
    const dias = new Set<FechaLocal>();
    for (const t of turnos) {
        if (marcados.includes(t.id) && t.esperado_in != null) dias.add(fechaDe(t.esperado_in));
    }
    const resultado: Array<{ id: number; minutos_licencia: number }> = [];
    for (const dia of dias) {
        const delDia = turnos
            .filter(t => !t.generica && t.esperado_in != null && fechaDe(t.esperado_in) === dia)
            .sort((a, b) => compararTs(a.esperado_in as string, b.esperado_in as string) || a.id - b.id);
        const n = delDia.length;
        const todos = delDia.every(t => t.licencia);
        const previos = delDia.reduce((s, t) => s + t.minutos_licencia, 0);
        if (!todos || previos !== 0) continue;
        delDia.forEach((t, i) => {
            resultado.push({
                id: t.id,
                minutos_licencia: Math.trunc(jornada / n) + (i === 0 ? jornada % n : 0),
            });
        });
    }
    return resultado;
};

// ───────────────────────── Rama por horas ─────────────────────────

export interface ResultadoPorHoras {
    cambios: CambioTurno[];
    /** Total de minutos de solape consumidos (suma de los solapes). */
    total: number;
}

/**
 * Aplica una licencia por horas a los turnos leídos al inicio. Cada turno se evalúa con sus valores
 * originales (como el cursor del loop SQL): los updates de un turno no afectan a otro.
 */
export const aplicarPorHoras = (
    sol: SolicitudLicencia,
    turnos: TurnoLicencia[],
    turnoIds?: number[] | null,
): ResultadoPorHoras => {
    if (!tieneFechas(sol)) return { cambios: [], total: 0 };
    const { fecha_inicio: inicio, fecha_fin: fin } = sol;
    const candidatos = turnos
        .filter(t => !t.licencia && t.esperado_in != null && (turnoIds == null || turnoIds.includes(t.id)))
        .map(t => ({ t, tin: t.esperado_in as TimestampLocal, tfin: finDelTurno(t) }))
        .filter(({ tin, tfin }) => compararTs(tin, fin) < 0 && compararTs(tfin, inicio) > 0)
        .sort((a, b) => compararTs(a.tin, b.tin));

    const cambios: CambioTurno[] = [];
    let total = 0;
    for (const { t, tin, tfin } of candidatos) {
        const solape = redondearPg(diffMinutos(minTs(tfin, fin), maxTs(tin, inicio)));
        if (solape <= 0) continue;
        const cubreInicio = compararTs(inicio, tin) <= 0;
        cambios.push({
            id: t.id,
            minutos_licencia: t.minutos_licencia + solape,
            licencia: cubreInicio && compararTs(fin, tfin) >= 0,
            esperado_in: cubreInicio && compararTs(fin, tfin) < 0 ? fin : t.esperado_in,
            esperado_out: t.esperado_out != null && compararTs(inicio, tin) > 0 && compararTs(fin, t.esperado_out) >= 0
                ? inicio : t.esperado_out,
        });
        total += solape;
    }
    return { cambios, total };
};

/**
 * Franco (tipo 2) por horas: consume el solape del saldo. El franco del sábado desde las 13 (mismo día)
 * no se descuenta.
 */
export const debeConsumirFranco = (sol: SolicitudLicencia, totalMinutos: number): boolean => {
    if (totalMinutos <= 0 || sol.tipo_licencia_id !== TIPO_LICENCIA_FRANCO || !tieneFechas(sol)) return false;
    const sabadoTarde = fechaDe(sol.fecha_inicio) === fechaDe(sol.fecha_fin)
        && isoDow(sol.fecha_inicio) === SABADO
        && horaMinuto(sol.fecha_inicio) >= HORA_CORTE_SABADO;
    return !sabadoTarde;
};

// ───────────────────────── Reversión ─────────────────────────

/** Ids de los turnos que revierte una licencia por días (licencia = false, minutos_licencia = 0). */
export const turnosARevertirPorDias = (sol: SolicitudLicencia, turnos: TurnoLicencia[]): number[] => {
    if (!tieneFechas(sol)) return [];
    return turnos
        .filter(t =>
            t.licencia
            && !t.generica
            && t.esperado_in != null
            && compararTs(t.esperado_in, sol.fecha_inicio) >= 0
            && compararTs(finDelTurno(t), sol.fecha_fin) <= 0)
        .map(t => t.id);
};

/** Otra solicitud por horas del usuario (APROBADA/CONSUMIDA, no borrada, id distinto), ya filtrada por la DB. */
export interface OtraSolicitudHoras {
    id: number;
    fecha_inicio: TimestampLocal | null;
    fecha_fin: TimestampLocal | null;
}

/** Fila de planificacion_snapshot_turno del snapshot ACTIVO. hora_in/hora_out: 'HH:MM[:SS]'. */
export interface TurnoPlantilla {
    turno: string;
    dia_semana: number;
    hora_in: string;
    hora_out: string;
}

export interface ResultadoReversionHoras {
    cambios: CambioTurno[];
    /** Cantidad de turnos revertidos (valor de retorno de revertir_licencia). */
    revertidos: number;
}

/** Reversión por horas: "única" (restaura el recorte con minutos_licencia) o "compartida" (restituye desde la plantilla). */
export const revertirPorHoras = (
    sol: SolicitudLicencia,
    turnos: TurnoLicencia[],
    otras: OtraSolicitudHoras[],
    plantilla: TurnoPlantilla[],
): ResultadoReversionHoras => {
    if (!tieneFechas(sol)) return { cambios: [], revertidos: 0 };
    const { fecha_inicio: inicio, fecha_fin: fin } = sol;
    const cambios: CambioTurno[] = [];

    const candidatos = turnos.filter(t =>
        t.minutos_licencia > 0
        && !t.generica
        && t.esperado_in != null
        && compararTs(t.esperado_in, fin) <= 0
        && compararTs(finDelTurno(t), inicio) >= 0);

    for (const t of candidatos) {
        const tin = t.esperado_in as TimestampLocal;
        const tfin = finDelTurno(t);
        const compartido = otras.some(o =>
            o.id !== sol.id
            && o.fecha_inicio != null && o.fecha_fin != null
            && compararTs(o.fecha_inicio, tfin) <= 0
            && compararTs(o.fecha_fin, tin) >= 0);

        if (!compartido) {
            cambios.push({
                id: t.id,
                esperado_in: !t.licencia && compararTs(tin, fin) === 0 ? desplazar(tin, -t.minutos_licencia) : t.esperado_in,
                esperado_out: !t.licencia && t.esperado_out != null && compararTs(t.esperado_out, inicio) === 0 ? desplazar(t.esperado_out, t.minutos_licencia) : t.esperado_out,
                licencia: false,
                minutos_licencia: 0,
            });
            continue;
        }

        const dia = fechaDe(tin);
        const dow = isoDow(tin);
        const plan = plantilla.find(p => p.turno === t.turno && p.dia_semana === dow);
        const planIn = plan ? combinar(dia, plan.hora_in) : null;
        const planOut = plan ? combinar(dia, plan.hora_out) : null;

        const vIn = compararTs(tin, fin) === 0 ? (planIn ?? tin) : tin;
        const vOut = t.esperado_out != null && compararTs(t.esperado_out, inicio) === 0 ? (planOut ?? t.esperado_out) : t.esperado_out;
        const solape = Math.max(0, redondearPg(diffMinutos(minTs(vOut ?? tfin, fin), maxTs(vIn, inicio))));
        cambios.push({
            id: t.id,
            esperado_in: vIn,
            esperado_out: vOut,
            licencia: false,
            minutos_licencia: Math.max(0, t.minutos_licencia - solape),
        });
    }
    return { cambios, revertidos: cambios.length };
};

// ───────────────────────── aplicar_licencias_a_turnos ─────────────────────────

/** Ids (distintos, ascendentes) de las solicitudes que solapan alguno de los turnos del mismo usuario. */
export const solicitudesQueSolapan = (
    turnos: TurnoDeUsuario[],
    solicitudes: Array<SolicitudLicencia>,
): number[] => {
    const ids = new Set<number>();
    for (const sol of solicitudes) {
        if (!tieneFechas(sol)) continue;
        const solapa = turnos.some(t =>
            t.user_context_id === sol.usuario_id
            && t.esperado_in != null
            && compararTs(sol.fecha_inicio, finDelTurno(t)) < 0
            && compararTs(sol.fecha_fin, t.esperado_in) > 0);
        if (solapa) ids.add(sol.id);
    }
    return [...ids].sort((a, b) => a - b);
};

const desplazar = sumarMinutos;
