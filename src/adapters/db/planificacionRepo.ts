import type { PoolClient } from 'pg';
import { pool } from './pgClient';
import type {
  FilaDiff, ObjetivoSnapshot, ObjetivoUsuario, SnapshotTurno, SolicitudAprobada, TurnoDiario,
  TurnoSemanaNuevo, TurnoSinteticoNuevo, UsuarioInfo,
} from '../../domain/services/planificacionReglas';
import type { FechaLocal, TimestampLocal } from '../../domain/services/fechaLocal';

/**
 * Acceso a datos de la planificación por snapshot (ADR-008 / ADR-010). Todas las funciones
 * reciben el client de la transacción en curso; las reglas viven en planificacionReglas.ts.
 * Los timestamp/date llegan como string (pgClient.ts).
 */

/** Mismo lock que usaban las funciones SQL: serializa publicar y generar la semana. */
const LOCK_PLANIFICACION = 7305101;

const FMT_TS = `'YYYY-MM-DD HH24:MI:SS'`;

/* ------------------------------------------------------------------ */
/* Reloj y lock                                                        */
/* ------------------------------------------------------------------ */

/** "Ahora" en hora de Argentina (planificacion_ahora_ar), el único reloj válido para las reglas. */
export async function ahoraAr(client: PoolClient): Promise<TimestampLocal> {
  const { rows } = await client.query(`SELECT to_char(planificacion_ahora_ar(), ${FMT_TS}) AS ahora`);
  return rows[0].ahora;
}

export async function lockPlanificacion(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_PLANIFICACION]);
}

/* ------------------------------------------------------------------ */
/* Snapshot: creación del preview                                      */
/* ------------------------------------------------------------------ */

/** Vence los previews viejos y los del propio usuario. */
export async function expirarPreviews(client: PoolClient, usuario: number): Promise<void> {
  await client.query(
    `UPDATE planificacion_snapshot SET estado = 'EXPIRADO'
     WHERE estado = 'PREVIEW' AND (expira_at < now() OR creado_por = $1)`,
    [usuario],
  );
}

/** Inserta el snapshot en PREVIEW con vencimiento a 30 minutos (reloj de la DB). */
export async function insertarSnapshotPreview(
  client: PoolClient,
  creadoPor: number,
  hash: string,
): Promise<{ id: number; expiraAt: string }> {
  const { rows } = await client.query(
    `INSERT INTO planificacion_snapshot (creado_por, expira_at, hash, estado)
     VALUES ($1, now() + interval '30 minutes', $2, 'PREVIEW')
     RETURNING id, expira_at`,
    [creadoPor, hash],
  );
  const expira = rows[0].expira_at;
  return { id: Number(rows[0].id), expiraAt: expira instanceof Date ? expira.toISOString() : String(expira) };
}

export async function insertarSnapshotTurnos(client: PoolClient, snapshotId: number, turnos: SnapshotTurno[]): Promise<void> {
  if (turnos.length === 0) return;
  await client.query(
    `INSERT INTO planificacion_snapshot_turno (snapshot_id, user_context_id, dia_semana, turno, hora_in, hora_out, sede_id)
     SELECT $1, t.uid, t.dia, t.turno::turno_enum, t.hin::time, t.hout::time, t.sede
     FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::int[]) AS t(uid, dia, turno, hin, hout, sede)`,
    [
      snapshotId,
      turnos.map((t) => t.userContextId),
      turnos.map((t) => t.diaSemana),
      turnos.map((t) => t.turno),
      turnos.map((t) => t.horaIn),
      turnos.map((t) => t.horaOut),
      turnos.map((t) => t.sedeId),
    ],
  );
}

export async function insertarSnapshotObjetivos(client: PoolClient, snapshotId: number, objetivos: ObjetivoSnapshot[]): Promise<void> {
  if (objetivos.length === 0) return;
  await client.query(
    `INSERT INTO planificacion_snapshot_objetivo (snapshot_id, user_context_id, minutos_objetivo)
     SELECT $1, o.uid, o.minutos FROM unnest($2::int[], $3::int[]) AS o(uid, minutos)`,
    [snapshotId, objetivos.map((o) => o.userContextId), objetivos.map((o) => o.minutosObjetivo)],
  );
}

export async function guardarDiff(client: PoolClient, snapshotId: number, diff: unknown): Promise<void> {
  await client.query('UPDATE planificacion_snapshot SET diff = $2::jsonb WHERE id = $1', [snapshotId, JSON.stringify(diff)]);
}

export async function existeActivoConHash(client: PoolClient, hash: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM planificacion_snapshot WHERE estado = 'ACTIVO' AND hash = $1) AS existe`,
    [hash],
  );
  return rows[0].existe;
}

/* ------------------------------------------------------------------ */
/* Snapshot: confirmación y estados                                    */
/* ------------------------------------------------------------------ */

export interface SnapshotBloqueado {
  id: number;
  estado: string;
  creadoPor: number;
  /** expira_at < now() según la DB (false si no tiene vencimiento). */
  vencido: boolean;
}

export async function getSnapshotParaActualizar(client: PoolClient, snapshotId: number): Promise<SnapshotBloqueado | null> {
  const { rows } = await client.query(
    `SELECT id, estado, creado_por, COALESCE(expira_at < now(), false) AS vencido
     FROM planificacion_snapshot WHERE id = $1 FOR UPDATE`,
    [snapshotId],
  );
  const r = rows[0];
  return r ? { id: Number(r.id), estado: r.estado, creadoPor: r.creado_por, vencido: r.vencido } : null;
}

export async function marcarExpirado(client: PoolClient, snapshotId: number): Promise<void> {
  await client.query(`UPDATE planificacion_snapshot SET estado = 'EXPIRADO' WHERE id = $1`, [snapshotId]);
}

export async function marcarActivoReemplazado(client: PoolClient): Promise<void> {
  await client.query(`UPDATE planificacion_snapshot SET estado = 'REEMPLAZADO' WHERE estado = 'ACTIVO'`);
}

export async function activarSnapshot(client: PoolClient, snapshotId: number): Promise<void> {
  await client.query(
    `UPDATE planificacion_snapshot SET estado = 'ACTIVO', aplicado_at = now(), expira_at = NULL WHERE id = $1`,
    [snapshotId],
  );
}

export async function getSnapshotActivoId(client: PoolClient): Promise<number | null> {
  const { rows } = await client.query(`SELECT id FROM planificacion_snapshot WHERE estado = 'ACTIVO'`);
  return rows[0] ? Number(rows[0].id) : null;
}

/* ------------------------------------------------------------------ */
/* Lecturas para las reglas                                            */
/* ------------------------------------------------------------------ */

const aSnapshotTurno = (r: any): SnapshotTurno => ({
  userContextId: r.user_context_id,
  diaSemana: Number(r.dia_semana),
  turno: r.turno,
  horaIn: r.hora_in,
  horaOut: r.hora_out,
  sedeId: r.sede_id,
});

const COLUMNAS_SNAPSHOT_TURNO = `st.user_context_id, st.dia_semana, st.turno::text AS turno,
  to_char(st.hora_in, 'HH24:MI') AS hora_in, to_char(st.hora_out, 'HH24:MI') AS hora_out, st.sede_id`;

export async function getTurnosSnapshot(client: PoolClient, snapshotId: number): Promise<SnapshotTurno[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS_SNAPSHOT_TURNO} FROM planificacion_snapshot_turno st
     WHERE st.snapshot_id = $1 ORDER BY st.user_context_id, st.dia_semana, st.turno`,
    [snapshotId],
  );
  return rows.map(aSnapshotTurno);
}

/** Cantidad de turnos del snapshot ACTIVO (guarda anti-borrado). */
export async function contarTurnosSnapshotActivo(client: PoolClient): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM planificacion_snapshot_turno st
     JOIN planificacion_snapshot s ON s.id = st.snapshot_id AND s.estado = 'ACTIVO'`,
  );
  return rows[0].n;
}

/** user_context_id con turnos en el snapshot ACTIVO. */
export async function getUsuariosSnapshotActivo(client: PoolClient): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT st.user_context_id FROM planificacion_snapshot_turno st
     JOIN planificacion_snapshot s ON s.id = st.snapshot_id AND s.estado = 'ACTIVO'`,
  );
  return rows.map((r) => r.user_context_id);
}

/** Usuarios de v_interno_users entre los ids pedidos (los inexistentes o dados de baja no vienen). */
export async function getUsuarios(client: PoolClient, ids: number[]): Promise<UsuarioInfo[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT vi.user_context_id, vi.nombre::text AS nombre, vi.apellido::text AS apellido, vi.rol_nombre::text AS rol_nombre
     FROM v_interno_users vi WHERE vi.user_context_id = ANY($1::int[])`,
    [ids],
  );
  return rows.map((r) => ({ userContextId: r.user_context_id, nombre: r.nombre, apellido: r.apellido, rolNombre: r.rol_nombre }));
}

export async function getSedesActivas(client: PoolClient): Promise<number[]> {
  const { rows } = await client.query('SELECT id FROM sedes WHERE activo');
  return rows.map((r) => r.id);
}

/** planificacion_diaria de los usuarios con esperado_in entre las fechas (inclusive). */
export async function getTurnosDiarios(
  client: PoolClient,
  userIds: number[],
  desde: FechaLocal,
  hasta: FechaLocal,
): Promise<TurnoDiario[]> {
  if (userIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT pd.id, pd.user_context_id, pd.turno::text AS turno, pd.esperado_in, pd.esperado_out,
            pd.sede_id_in, pd.sede_id_out, pd.licencia, pd.minutos_licencia, pd.horario_corrido,
            pd.marcado_in_at, pd.marcado_out_at, pd.generica, pd.feriado
     FROM planificacion_diaria pd
     WHERE pd.user_context_id = ANY($1::int[]) AND DATE(pd.esperado_in) BETWEEN $2::date AND $3::date`,
    [userIds, desde, hasta],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    userContextId: r.user_context_id,
    turno: r.turno,
    esperadoIn: r.esperado_in,
    esperadoOut: r.esperado_out ?? null,
    sedeIdIn: r.sede_id_in ?? null,
    sedeIdOut: r.sede_id_out ?? null,
    licencia: r.licencia,
    minutosLicencia: Number(r.minutos_licencia ?? 0),
    horarioCorrido: r.horario_corrido,
    marcadoInAt: r.marcado_in_at ?? null,
    marcadoOutAt: r.marcado_out_at ?? null,
    generica: r.generica,
    feriado: r.feriado,
  }));
}

/** Solicitudes APROBADAS y no borradas de los usuarios que tocan el rango de fechas. */
export async function getSolicitudesAprobadas(
  client: PoolClient,
  userIds: number[],
  desde: FechaLocal,
  hasta: FechaLocal,
): Promise<SolicitudAprobada[]> {
  if (userIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT sa.usuario_id, sa.fecha_inicio, sa.fecha_fin, sa.cantidad_minutos
     FROM solicitudes_ausencia sa
     WHERE sa.usuario_id = ANY($1::int[]) AND sa.estado = 'APROBADA' AND sa.deleted_at IS NULL
       AND sa.fecha_inicio < ($3::date + 1) AND sa.fecha_fin > $2::date`,
    [userIds, desde, hasta],
  );
  return rows.map((r) => ({
    usuarioId: r.usuario_id,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    cantidadMinutos: r.cantidad_minutos == null ? null : Number(r.cantidad_minutos),
  }));
}

/** usuarios_horas_objetivo (vigente y pendiente). */
export async function getObjetivosUsuarios(client: PoolClient, userIds: number[]): Promise<ObjetivoUsuario[]> {
  if (userIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT user_context_id, minutos_objetivo, minutos_objetivo_pendiente
     FROM usuarios_horas_objetivo WHERE user_context_id = ANY($1::int[])`,
    [userIds],
  );
  return rows.map((r) => ({
    userContextId: r.user_context_id,
    minutosObjetivo: r.minutos_objetivo == null ? null : Number(r.minutos_objetivo),
    minutosObjetivoPendiente: r.minutos_objetivo_pendiente == null ? null : Number(r.minutos_objetivo_pendiente),
  }));
}

export async function getObjetivosSnapshot(client: PoolClient, snapshotId: number): Promise<ObjetivoSnapshot[]> {
  const { rows } = await client.query(
    'SELECT user_context_id, minutos_objetivo FROM planificacion_snapshot_objetivo WHERE snapshot_id = $1',
    [snapshotId],
  );
  return rows.map((r) => ({ userContextId: r.user_context_id, minutosObjetivo: Number(r.minutos_objetivo) }));
}

/* ------------------------------------------------------------------ */
/* Escrituras de snapshot_aplicar (en este orden)                      */
/* ------------------------------------------------------------------ */

/** Borra las bajas que no tienen marcado. */
export async function eliminarBajasSinMarcado(client: PoolClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await client.query(
    `DELETE FROM planificacion_diaria
     WHERE id = ANY($1::bigint[]) AND marcado_in_at IS NULL AND marcado_out_at IS NULL`,
    [ids],
  );
}

/** Aplica las modificaciones y devuelve los ids actualizados. */
export async function actualizarModificaciones(client: PoolClient, filas: FilaDiff[]): Promise<number[]> {
  if (filas.length === 0) return [];
  const { rows } = await client.query(
    `UPDATE planificacion_diaria pd
     SET esperado_in = d.new_in, esperado_out = d.new_out,
         sede_id_in = d.new_sede, sede_id_out = d.new_sede,
         modificado_manualmente = false, horario_corrido = false
     FROM unnest($1::bigint[], $2::timestamp[], $3::timestamp[], $4::int[]) AS d(old_id, new_in, new_out, new_sede)
     WHERE pd.id = d.old_id
     RETURNING pd.id`,
    [
      filas.map((f) => f.oldId),
      filas.map((f) => f.newIn),
      filas.map((f) => f.newOut),
      filas.map((f) => f.newSede),
    ],
  );
  return rows.map((r) => Number(r.id));
}

/** Los turnos sintéticos de un día sin turnos dejan paso a los reales. */
export async function eliminarGenericasDeDias(
  client: PoolClient,
  dias: Array<{ userContextId: number; fecha: FechaLocal }>,
): Promise<void> {
  if (dias.length === 0) return;
  await client.query(
    `DELETE FROM planificacion_diaria g
     USING unnest($1::int[], $2::date[]) AS x(uid, fecha)
     WHERE g.generica AND g.user_context_id = x.uid AND DATE(g.esperado_in) = x.fecha`,
    [dias.map((d) => d.userContextId), dias.map((d) => d.fecha)],
  );
}

/** Inserta las altas heredando el feriado del mismo día y turno. Devuelve los ids realmente insertados. */
export async function insertarAltas(client: PoolClient, filas: FilaDiff[]): Promise<number[]> {
  if (filas.length === 0) return [];
  const { rows } = await client.query(
    `INSERT INTO planificacion_diaria
       (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out, licencia, feriado)
     SELECT d.uid, d.turno::turno_enum, d.new_in, d.new_out, d.new_sede, d.new_sede, false,
            COALESCE((SELECT bool_or(p2.feriado) FROM planificacion_diaria p2
                      WHERE DATE(p2.esperado_in) = d.fecha AND p2.turno = d.turno::turno_enum), false)
     FROM unnest($1::int[], $2::text[], $3::date[], $4::timestamp[], $5::timestamp[], $6::int[])
          AS d(uid, turno, fecha, new_in, new_out, new_sede)
     ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING
     RETURNING id`,
    [
      filas.map((f) => f.userContextId),
      filas.map((f) => f.turno),
      filas.map((f) => f.fecha),
      filas.map((f) => f.newIn),
      filas.map((f) => f.newOut),
      filas.map((f) => f.newSede),
    ],
  );
  return rows.map((r) => Number(r.id));
}

/** Días lunes-sábado sin turno real de usuarios con objetivo (insumo de turnosDiasVacios). */
export async function getUsuariosConObjetivo(
  client: PoolClient,
): Promise<Array<{ userContextId: number; rolNombre: string; minutosObjetivo: number | null }>> {
  const { rows } = await client.query(
    `SELECT uho.user_context_id, vi.rol_nombre::text AS rol_nombre, uho.minutos_objetivo
     FROM usuarios_horas_objetivo uho
     JOIN v_interno_users vi ON vi.user_context_id = uho.user_context_id`,
  );
  return rows.map((r) => ({
    userContextId: r.user_context_id,
    rolNombre: r.rol_nombre,
    minutosObjetivo: r.minutos_objetivo == null ? null : Number(r.minutos_objetivo),
  }));
}

/** planificacion_diaria de TODOS los usuarios en el rango (cualquier turno, genéricos incluidos). */
export async function getTurnosExistentesDelRango(
  client: PoolClient,
  desde: FechaLocal,
  hasta: FechaLocal,
): Promise<Array<Pick<TurnoDiario, 'userContextId' | 'turno' | 'esperadoIn' | 'generica' | 'feriado'>>> {
  const { rows } = await client.query(
    `SELECT user_context_id, turno::text AS turno, esperado_in, generica, feriado
     FROM planificacion_diaria WHERE DATE(esperado_in) BETWEEN $1::date AND $2::date`,
    [desde, hasta],
  );
  return rows.map((r) => ({
    userContextId: r.user_context_id, turno: r.turno, esperadoIn: r.esperado_in, generica: r.generica, feriado: r.feriado,
  }));
}

/** Inserta los turnos sintéticos con licencia de los días vacíos. Devuelve cuántos se insertaron. */
export async function insertarSinteticos(client: PoolClient, filas: TurnoSinteticoNuevo[]): Promise<number> {
  if (filas.length === 0) return 0;
  const res = await client.query(
    `INSERT INTO planificacion_diaria
       (user_context_id, turno, esperado_in, esperado_out, licencia, minutos_licencia, generica, feriado)
     SELECT s.uid, s.turno::turno_enum, s.esp_in, s.esp_out, true, s.minutos, true, s.feriado
     FROM unnest($1::int[], $2::text[], $3::timestamp[], $4::timestamp[], $5::int[], $6::boolean[])
          AS s(uid, turno, esp_in, esp_out, minutos, feriado)
     ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING`,
    [
      filas.map((f) => f.userContextId),
      filas.map((f) => f.turno),
      filas.map((f) => f.esperadoIn),
      filas.map((f) => f.esperadoOut),
      filas.map((f) => f.minutosLicencia),
      filas.map((f) => f.feriado),
    ],
  );
  return res.rowCount ?? 0;
}

/**
 * Objetivo: usuario nuevo -> vigente de inmediato; existente -> queda pendiente hasta la próxima
 * generación semanal (NULL si coincide con el vigente).
 */
export async function upsertObjetivosDesdeSnapshot(client: PoolClient, snapshotId: number): Promise<void> {
  await client.query(
    `INSERT INTO usuarios_horas_objetivo (user_context_id, minutos_objetivo)
     SELECT so.user_context_id, so.minutos_objetivo
     FROM planificacion_snapshot_objetivo so WHERE so.snapshot_id = $1
     ON CONFLICT (user_context_id) DO UPDATE
     SET minutos_objetivo_pendiente = CASE
             WHEN EXCLUDED.minutos_objetivo = usuarios_horas_objetivo.minutos_objetivo THEN NULL
             ELSE EXCLUDED.minutos_objetivo END,
         updated_at = now()`,
    [snapshotId],
  );
}

/** Un aviso por usuario afectado; el dedupe_key evita duplicados si se reintenta. */
export async function encolarNotificaciones(client: PoolClient, snapshotId: number, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO notificaciones_pendientes (user_context_id, tipo, payload, dedupe_key)
     SELECT u, 'turnos_actualizados_masivo',
            jsonb_build_object(
              'title', 'Horarios actualizados',
              'body', 'Tu planificación de turnos fue actualizada.',
              'data', jsonb_build_object('type', 'turnos_actualizados_masivo', 'domain', 'horarios', 'event', 'updated')),
            'snapshot:' || $1::bigint || ':' || u
     FROM unnest($2::int[]) AS u
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [snapshotId, userIds],
  );
}

/* ------------------------------------------------------------------ */
/* Generación semanal                                                  */
/* ------------------------------------------------------------------ */

/** Días (usuario + fecha) de la semana que ya están en horario corrido. */
export async function getDiasConCorrido(
  client: PoolClient,
  userIds: number[],
  lunes: FechaLocal,
  sabado: FechaLocal,
): Promise<Array<{ userContextId: number; fecha: FechaLocal }>> {
  if (userIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT c.user_context_id, DATE(c.esperado_in) AS fecha
     FROM planificacion_diaria c
     WHERE c.horario_corrido AND c.user_context_id = ANY($1::int[])
       AND DATE(c.esperado_in) BETWEEN $2::date AND $3::date`,
    [userIds, lunes, sabado],
  );
  return rows.map((r) => ({ userContextId: r.user_context_id, fecha: r.fecha }));
}

/** Inserta los turnos de la semana (idempotente) y devuelve los ids realmente insertados. */
export async function insertarTurnosSemana(client: PoolClient, filas: TurnoSemanaNuevo[]): Promise<number[]> {
  if (filas.length === 0) return [];
  const { rows } = await client.query(
    `INSERT INTO planificacion_diaria (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out)
     SELECT t.uid, t.turno::turno_enum, t.esp_in, t.esp_out, t.sede_in, t.sede_out
     FROM unnest($1::int[], $2::text[], $3::timestamp[], $4::timestamp[], $5::int[], $6::int[])
          AS t(uid, turno, esp_in, esp_out, sede_in, sede_out)
     ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING
     RETURNING id`,
    [
      filas.map((f) => f.userContextId),
      filas.map((f) => f.turno),
      filas.map((f) => f.esperadoIn),
      filas.map((f) => f.esperadoOut),
      filas.map((f) => f.sedeIdIn),
      filas.map((f) => f.sedeIdOut),
    ],
  );
  return rows.map((r) => Number(r.id));
}

/** Pasa a vigente el objetivo pendiente. Devuelve cuántos usuarios cambiaron. */
export async function promoverObjetivosPendientes(client: PoolClient): Promise<number> {
  const res = await client.query(
    `UPDATE usuarios_horas_objetivo
     SET minutos_objetivo = minutos_objetivo_pendiente, minutos_objetivo_pendiente = NULL, updated_at = now()
     WHERE minutos_objetivo_pendiente IS NOT NULL`,
  );
  return res.rowCount ?? 0;
}

/* ------------------------------------------------------------------ */
/* Info de la última publicación                                       */
/* ------------------------------------------------------------------ */

export interface UltimaPublicacionRow {
  snapshotId: number;
  aplicadoAt: Date | null;
  nombre: string | null;
  apellido: string | null;
}

export const getUltimaPublicacionPlanificacion = async (): Promise<UltimaPublicacionRow | null> => {
  const result = await pool.query(
    `SELECT s.id AS "snapshotId", s.aplicado_at AS "aplicadoAt", vi.nombre, vi.apellido
     FROM planificacion_snapshot s
     LEFT JOIN v_interno_users vi ON vi.user_context_id = s.creado_por
     WHERE s.estado = 'ACTIVO'
     LIMIT 1`
  );
  const row = result.rows[0];
  return row ? { ...row, snapshotId: Number(row.snapshotId) } : null;
};
