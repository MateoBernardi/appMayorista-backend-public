import type { PoolClient } from 'pg';
import {
    SolicitudLicencia, TurnoLicencia, TurnoDeUsuario, OtraSolicitudHoras, TurnoPlantilla, CambioTurno,
} from '../../domain/services/licenciasTurnosReglas';

/**
 * Acceso a datos de las licencias sobre turnos. Todas las funciones reciben el client de la
 * transacción en curso; las reglas viven en domain/services/licenciasTurnosReglas.ts.
 */

const COLUMNAS_SOLICITUD = `sa.id, sa.usuario_id, sa.tipo_licencia_id, sa.fecha_inicio, sa.fecha_fin, sa.cantidad_minutos`;

const aSolicitud = (r: any): SolicitudLicencia => ({
    id: r.id,
    usuario_id: r.usuario_id,
    tipo_licencia_id: r.tipo_licencia_id,
    fecha_inicio: r.fecha_inicio,
    fecha_fin: r.fecha_fin,
    cantidad_minutos: r.cantidad_minutos == null ? null : Number(r.cantidad_minutos),
});

const aTurno = (r: any): TurnoLicencia => ({
    id: Number(r.id),
    turno: r.turno,
    esperado_in: r.esperado_in,
    esperado_out: r.esperado_out,
    licencia: r.licencia,
    minutos_licencia: Number(r.minutos_licencia),
    generica: r.generica,
    minutos_objetivo: r.minutos_objetivo == null ? null : Number(r.minutos_objetivo),
});

/** Solicitud APROBADA y no borrada (la que se puede aplicar a los turnos). */
export async function getSolicitudAprobada(client: PoolClient, solicitudId: number): Promise<SolicitudLicencia | null> {
    const { rows } = await client.query(
        `SELECT ${COLUMNAS_SOLICITUD} FROM solicitudes_ausencia sa
         WHERE sa.id = $1 AND sa.estado = 'APROBADA' AND sa.deleted_at IS NULL`,
        [solicitudId],
    );
    return rows[0] ? aSolicitud(rows[0]) : null;
}

/** Solicitud en cualquier estado (para revertir). */
export async function getSolicitudPorId(client: PoolClient, solicitudId: number): Promise<SolicitudLicencia | null> {
    const { rows } = await client.query(`SELECT ${COLUMNAS_SOLICITUD} FROM solicitudes_ausencia sa WHERE sa.id = $1`, [solicitudId]);
    return rows[0] ? aSolicitud(rows[0]) : null;
}

export interface FiltroTurnos {
    /** esperado_in >= desde (fecha 'YYYY-MM-DD'). */
    desde: string;
    /** esperado_in < hasta (fecha 'YYYY-MM-DD'). */
    hasta: string;
    /** Solo estos ids (null/undefined: todos). */
    ids?: number[] | null;
    /** licencia = false y esperado_in no nulo (rama por horas de aplicar). */
    soloSinLicencia?: boolean;
    /** minutos_licencia > 0 y no genéricos (rama por horas de revertir). */
    soloConMinutos?: boolean;
    /** FOR UPDATE OF pd. */
    bloquear?: boolean;
}

/** Turnos del usuario con el objetivo semanal (LEFT JOIN usuarios_horas_objetivo), dentro de la ventana. */
export async function getTurnosUsuario(client: PoolClient, usuarioId: number, f: FiltroTurnos): Promise<TurnoLicencia[]> {
    const { rows } = await client.query(
        `SELECT pd.id, pd.turno, pd.esperado_in, pd.esperado_out, pd.licencia, pd.minutos_licencia, pd.generica,
                uho.minutos_objetivo
         FROM planificacion_diaria pd
         LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = pd.user_context_id
         WHERE pd.user_context_id = $1
           AND pd.esperado_in >= $2::date AND pd.esperado_in < $3::date
           AND ($4::bigint[] IS NULL OR pd.id = ANY ($4::bigint[]))
           AND (NOT $5::boolean OR (pd.licencia = false AND pd.esperado_in IS NOT NULL))
           AND (NOT $6::boolean OR (pd.minutos_licencia > 0 AND NOT pd.generica))
         ORDER BY pd.esperado_in, pd.id
         ${f.bloquear ? 'FOR UPDATE OF pd' : ''}`,
        [usuarioId, f.desde, f.hasta, f.ids ?? null, f.soloSinLicencia ?? false, f.soloConMinutos ?? false],
    );
    return rows.map(aTurno);
}

/** Otras solicitudes por horas del usuario (APROBADA/CONSUMIDA, no borradas) distintas de `solicitudId`. */
export async function getOtrasSolicitudesHoras(client: PoolClient, usuarioId: number, solicitudId: number): Promise<OtraSolicitudHoras[]> {
    const { rows } = await client.query(
        `SELECT sa.id, sa.fecha_inicio, sa.fecha_fin FROM solicitudes_ausencia sa
         WHERE sa.usuario_id = $1 AND sa.id <> $2
           AND sa.estado IN ('APROBADA', 'CONSUMIDA') AND sa.deleted_at IS NULL
           AND sa.cantidad_minutos IS NOT NULL`,
        [usuarioId, solicitudId],
    );
    return rows;
}

/** Turnos de la plantilla del snapshot ACTIVO del usuario. */
export async function getPlantillaActiva(client: PoolClient, usuarioId: number): Promise<TurnoPlantilla[]> {
    const { rows } = await client.query(
        `SELECT st.turno, st.dia_semana, st.hora_in, st.hora_out
         FROM planificacion_snapshot_turno st
         JOIN planificacion_snapshot s ON s.id = st.snapshot_id AND s.estado = 'ACTIVO'
         WHERE st.user_context_id = $1`,
        [usuarioId],
    );
    return rows.map((r: any) => ({ turno: r.turno, dia_semana: Number(r.dia_semana), hora_in: String(r.hora_in), hora_out: String(r.hora_out) }));
}

export async function marcarTurnosConLicencia(client: PoolClient, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await client.query(`UPDATE planificacion_diaria SET licencia = true WHERE id = ANY ($1::bigint[])`, [ids]);
}

export async function setMinutosLicencia(client: PoolClient, filas: Array<{ id: number; minutos_licencia: number }>): Promise<void> {
    if (filas.length === 0) return;
    await client.query(
        `UPDATE planificacion_diaria pd SET minutos_licencia = x.minutos
         FROM unnest($1::bigint[], $2::int[]) AS x(id, minutos)
         WHERE pd.id = x.id`,
        [filas.map(f => f.id), filas.map(f => f.minutos_licencia)],
    );
}

/** Revierte la rama por días: licencia = false y minutos_licencia = 0. */
export async function limpiarLicenciaTurnos(client: PoolClient, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await client.query(
        `UPDATE planificacion_diaria SET licencia = false, minutos_licencia = 0 WHERE id = ANY ($1::bigint[])`,
        [ids],
    );
}

/** Escribe horario, licencia y minutos_licencia de un turno. */
export async function actualizarTurnoLicencia(client: PoolClient, c: CambioTurno): Promise<void> {
    await client.query(
        `UPDATE planificacion_diaria
         SET esperado_in = $2::timestamp, esperado_out = $3::timestamp, licencia = $4::boolean, minutos_licencia = $5::int
         WHERE id = $1`,
        [c.id, c.esperado_in, c.esperado_out, c.licencia, c.minutos_licencia],
    );
}

/** Consume del saldo de francos `minutos` (upsert) y deja el movimiento 'consumo' en el ledger. */
export async function consumirFranco(client: PoolClient, usuarioId: number, minutos: number, solicitudId: number): Promise<void> {
    const { rows } = await client.query(
        `INSERT INTO saldos_francos (user_context_id, minutos_disponibles, minutos_consumidos, updated_at)
         VALUES ($1, 0, $2, now())
         ON CONFLICT (user_context_id) DO UPDATE
           SET minutos_consumidos = saldos_francos.minutos_consumidos + EXCLUDED.minutos_consumidos,
               updated_at         = now()
         RETURNING minutos_disponibles, minutos_consumidos`,
        [usuarioId, minutos],
    );
    const saldo = rows[0];
    await client.query(
        `INSERT INTO saldos_francos_movimientos
           (user_context_id, tipo_movimiento, minutos,
            minutos_disponibles_resultante, minutos_consumidos_resultante, solicitud_ausencia_id)
         VALUES ($1, 'consumo', $2, $3, $4, $5)`,
        [usuarioId, minutos, saldo.minutos_disponibles, saldo.minutos_consumidos, solicitudId],
    );
}

/** Turnos (con su dueño y objetivo) por id, para calcular qué solicitudes los solapan. */
export async function getTurnosPorIds(client: PoolClient, turnoIds: number[]): Promise<TurnoDeUsuario[]> {
    const { rows } = await client.query(
        `SELECT pd.id, pd.user_context_id, pd.turno, pd.esperado_in, pd.esperado_out, pd.licencia, pd.minutos_licencia,
                pd.generica, uho.minutos_objetivo
         FROM planificacion_diaria pd
         LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = pd.user_context_id
         WHERE pd.id = ANY ($1::bigint[])`,
        [turnoIds],
    );
    return rows.map((r: any) => ({ ...aTurno(r), user_context_id: r.user_context_id }));
}

/** Solicitudes APROBADAS no borradas de esos usuarios que terminan después de `desde` (candidatas a solapar). */
export async function getSolicitudesAprobadasDeUsuarios(
    client: PoolClient,
    usuarioIds: number[],
    desde: string,
): Promise<SolicitudLicencia[]> {
    const { rows } = await client.query(
        `SELECT ${COLUMNAS_SOLICITUD} FROM solicitudes_ausencia sa
         WHERE sa.usuario_id = ANY ($1::int[]) AND sa.estado = 'APROBADA' AND sa.deleted_at IS NULL
           AND sa.fecha_inicio IS NOT NULL AND sa.fecha_fin > $2::timestamp
         ORDER BY sa.id`,
        [usuarioIds, desde],
    );
    return rows.map(aSolicitud);
}
