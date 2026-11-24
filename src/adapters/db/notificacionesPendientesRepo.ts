import { pool } from './pgClient';

export interface NotificacionPendienteRow {
  id: number;
  userContextId: number;
  tipo: string;
  payload: { title?: string; body: string; data?: Record<string, unknown> };
  intentos: number;
}

const RECLAMO_MINUTOS = 10;

export const MAX_INTENTOS_NOTIFICACION = 5;


export const reclamarNotificaciones = async (limite: number): Promise<NotificacionPendienteRow[]> => {
  const result = await pool.query(
    `UPDATE notificaciones_pendientes n
     SET estado = 'PROCESANDO',
         intentos = n.intentos + 1,
         proximo_intento_at = now() + make_interval(mins => $2)
     WHERE n.id IN (
       SELECT id FROM notificaciones_pendientes
       WHERE estado IN ('PENDIENTE', 'PROCESANDO') AND proximo_intento_at <= now()
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING n.id, n.user_context_id AS "userContextId", n.tipo, n.payload, n.intentos`,
    [limite, RECLAMO_MINUTOS]
  );
  return result.rows.map(r => ({ ...r, id: Number(r.id) }));
};

export const marcarNotificacionesEnviadas = async (ids: number[]): Promise<void> => {
  if (ids.length === 0) return;
  await pool.query(
    `UPDATE notificaciones_pendientes SET estado = 'ENVIADA', sent_at = now(), last_error = NULL
     WHERE id = ANY($1::bigint[])`,
    [ids]
  );
};

// Reintenta con backoff exponencial (2^intentos minutos) hasta MAX_INTENTOS_NOTIFICACION;
// después queda FALLIDA para inspección manual.
export const marcarNotificacionesFallidas = async (ids: number[], error: string): Promise<void> => {
  if (ids.length === 0) return;
  await pool.query(
    `UPDATE notificaciones_pendientes
     SET estado = CASE WHEN intentos >= $2 THEN 'FALLIDA' ELSE 'PENDIENTE' END,
         proximo_intento_at = now() + make_interval(mins => power(2, intentos)::int),
         last_error = $3
     WHERE id = ANY($1::bigint[])`,
    [ids, MAX_INTENTOS_NOTIFICACION, error.slice(0, 500)]
  );
};

export const eliminarNotificacionesViejas = async (dias: number): Promise<number> => {
  const result = await pool.query(
    `DELETE FROM notificaciones_pendientes
     WHERE estado IN ('ENVIADA', 'FALLIDA') AND created_at < now() - make_interval(days => $1)`,
    [dias]
  );
  return result.rowCount ?? 0;
};
