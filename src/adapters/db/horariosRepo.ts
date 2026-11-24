import { pool } from './pgClient';
import { HorariosDTO, HorarioUsuarioDTO, ScanDTO, CheckScanRaw, SedeDTO, ResumenHorasUsuarioDTO } from '../../domain/dto/HorariosDTO';
import { ConflictError, NotFoundError } from '../errors/AppError';
import { PoolClient } from 'pg';
import { formatFechaHora, parseTimestampAR } from '../../utils/dateOnly';

export const getSedes = async (): Promise<SedeDTO[]> => {
  const result = await pool.query('SELECT id, nombre FROM sedes');
  return result.rows;
};

export const upsertHorarios = async (
  horariosValidados: HorariosDTO[],
  // Aplica las licencias aprobadas a los turnos (regla en licenciasTurnosServices); corre en esta transacción.
  aplicarLicenciasATurnos: (client: PoolClient, turnoIds: number[]) => Promise<void>,
): Promise<number> => {
  if (horariosValidados.length === 0) return 0;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Un día sin turnos tiene turnos sintéticos de licencia (migración 075): los turnos cargados
    // a mano los reemplazan.
    await client.query(
      `DELETE FROM planificacion_diaria g
       USING unnest($1::int[], $2::timestamp[]) AS x(uid, ts)
       WHERE g.generica AND g.user_context_id = x.uid AND DATE(g.esperado_in) = DATE(x.ts)`,
      [horariosValidados.map(h => h.userContextId), horariosValidados.map(h => h.horario_in)]
    );

    const valuePlaceholders = horariosValidados.map((_, i) => {
      const offset = i * 8;
      const licencia = `COALESCE($${offset + 7}::boolean, false)`;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, ${licencia}, COALESCE($${offset + 8}, false),
        CASE WHEN ${licencia} THEN planificacion_minutos_turno($${offset + 1}::int, $${offset + 3}::timestamp, $${offset + 4}::timestamp) ELSE 0 END)`;
    }).join(', ');

    const query = `
      INSERT INTO planificacion_diaria (
        user_context_id,
        turno,
        esperado_in,
        esperado_out,
        sede_id_in,
        sede_id_out,
        licencia,
        feriado,
        minutos_licencia
      ) VALUES ${valuePlaceholders}
      ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO UPDATE SET
        esperado_in = EXCLUDED.esperado_in,
        esperado_out = EXCLUDED.esperado_out,
        sede_id_in = EXCLUDED.sede_id_in,
        sede_id_out = EXCLUDED.sede_id_out,
        licencia = EXCLUDED.licencia,
        feriado = COALESCE(EXCLUDED.feriado, planificacion_diaria.feriado),
        -- La licencia a mano descuenta el turno entero del objetivo; al sacarla, se repone.
        minutos_licencia = CASE
          WHEN EXCLUDED.licencia AND NOT planificacion_diaria.licencia THEN planificacion_diaria.minutos_licencia + EXCLUDED.minutos_licencia
          WHEN NOT EXCLUDED.licencia AND planificacion_diaria.licencia THEN 0
          ELSE planificacion_diaria.minutos_licencia END,
        modificado_manualmente = true
      RETURNING id, minutos_licencia
    `;

    const queryParams = horariosValidados.flatMap(h => [
      h.userContextId,
      h.turno,
      h.horario_in,
      h.horario_out,
      h.sede_id_in,
      h.sede_id_out,
      h.licencia,
      h.feriado,
    ]);

    const result = await client.query(query, queryParams);

    // Licencias aprobadas que solapan los turnos: se aplican en la misma transacción (regla
    // en licenciasTurnosServices). Solo a turnos sin licencia aplicada todavía: uno que ya
    // tenía minutos_licencia no se vuelve a descontar.
    const sinLicenciaAplicada = result.rows
      .filter((r: { minutos_licencia: number }) => Number(r.minutos_licencia) === 0)
      .map((r: { id: number }) => r.id);
    if (sinLicenciaAplicada.length > 0) {
      await aplicarLicenciasATurnos(client, sinLicenciaAplicada);
    }

    await client.query('COMMIT');

    return result.rowCount || 0;

  }
  catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  finally {
    client.release();
  }
};

export const marcarFeriadoDia = async (fecha: Date, feriado: boolean, turno?: string): Promise<number> => {
  const result = turno
    ? await pool.query(
        `UPDATE planificacion_diaria
         SET feriado = $2, modificado_manualmente = true
         WHERE DATE(esperado_in) = $1::date AND turno = $3`,
        [fecha, feriado, turno]
      )
    : await pool.query(
        `UPDATE planificacion_diaria
         SET feriado = $2, modificado_manualmente = true
         WHERE DATE(esperado_in) = $1::date`,
        [fecha, feriado]
      );
  return result.rowCount || 0;
};

export const getShifts = async (diaFecha: string, filter?: string, idRolViewer?: number): Promise<HorarioUsuarioDTO[]> => {
  const dynamicFilter = buildFilterCondition(filter, 2);

  const queryParams: any[] = [diaFecha];
  let filterClause = '';

  if (dynamicFilter?.clause && dynamicFilter?.value !== null) {
    filterClause = dynamicFilter.clause;
    queryParams.push(dynamicFilter.value);
  }

  let rolClause = '';
  if (idRolViewer !== undefined) {
    queryParams.push(idRolViewer);
    rolClause = `AND viu.id_rol >= $${queryParams.length}`;
  }

  const queryText = `
      SELECT
          pd.id,
          pd.user_context_id,
          pd.turno,
          pd.esperado_in,
          pd.esperado_out,
          pd.sede_id_in,
          pd.sede_id_out,
          pd.licencia,
          pd.feriado,
          pd.acepted_at,
          pd.marcado_in_at,
          pd.marcado_out_at,
          pd.reportado_tardanza,
          pd.horario_corrido,
          viu.nombre,
          viu.apellido
      FROM planificacion_diaria pd
      INNER JOIN v_interno_users viu
          ON pd.user_context_id = viu.user_context_id
      WHERE DATE(pd.esperado_in) = DATE($1)
      ${filterClause}
      ${rolClause}
      ORDER BY pd.esperado_in ASC;
    `;

    const result = await pool.query(queryText, queryParams);
    return result.rows; 
};

const buildFilterCondition = (filter?: string, paramIndex: number = 2) => {
  if (!filter || !filter.includes(':')) {
      return { clause: '', value: null };
  }

  const [key, val] = filter.split(':');
  if (!key || !val) {
    return { clause: '', value: null };
  }
  const cleanValue = val.trim();

  switch (key.trim().toLowerCase()) {
    case 'turno':
      return { 
        clause: ` AND pd.turno = $${paramIndex}`, 
        value: cleanValue 
      };
    case 'sede':
      return { 
        clause: ` AND (pd.sede_id_in = $${paramIndex} OR pd.sede_id_out = $${paramIndex})`, 
        value: parseInt(cleanValue, 10) 
      };
    case 'usuario':
      return { 
        clause: ` AND pd.user_context_id = $${paramIndex}`, 
        value: parseInt(cleanValue, 10) 
      };
    case 'rol_nombre':
      return {
        clause: ` AND LOWER(viu.rol_nombre) = LOWER($${paramIndex})`,
        value: cleanValue
      };
    case 'feriado':
      return {
        clause: ` AND pd.feriado = $${paramIndex}`,
        value: cleanValue === '1'
      };
    default:
      return { clause: '', value: null };
  }
};

interface FeriadosRangeParams {
  fechaInicio: string;
  fechaFin: string;
  userContextId?: number | undefined;
  rolNombre?: string | undefined;
}

export const getFeriadosByRange = async ({
  fechaInicio,
  fechaFin,
  userContextId,
  rolNombre,
}: FeriadosRangeParams): Promise<HorarioUsuarioDTO[]> => {
  const result = await pool.query(
    `SELECT
        pd.id,
        pd.user_context_id,
        pd.turno,
        pd.esperado_in,
        pd.esperado_out,
        pd.sede_id_in,
        pd.sede_id_out,
        pd.licencia,
        pd.feriado,
        pd.acepted_at,
        viu.nombre,
        viu.apellido
     FROM planificacion_diaria pd
     INNER JOIN v_interno_users viu
         ON pd.user_context_id = viu.user_context_id
     WHERE pd.feriado = true
       AND DATE(pd.esperado_in) BETWEEN DATE($1) AND DATE($2)
       AND ($3::int IS NULL OR pd.user_context_id = $3)
       AND ($4::text IS NULL OR viu.rol_nombre = $4)
     ORDER BY pd.esperado_in ASC`,
    [fechaInicio, fechaFin, userContextId ?? null, rolNombre ?? null]
  );
  return result.rows;
};

interface HorasSemanalesParams {
  fechaInicio: string;
  fechaFin: string;
  userContextId?: number | undefined;
  rolNombre?: string | undefined;
  idRolViewer?: number | undefined;
}

/** Minutos de objetivo y trabajados en la semana. */
export interface HorasSemanalRow {
  userContextId: number;
  nombre: string;
  apellido: string;
  minutosObjetivo: number;
  minutosObjetivoPendiente: number | null;
  minutosTrabajados: number;
}

export const getHorasSemanalesVsObjetivo = async ({
  fechaInicio,
  fechaFin,
  userContextId,
  rolNombre,
  idRolViewer,
}: HorasSemanalesParams): Promise<HorasSemanalRow[]> => {
  const result = await pool.query(
    `SELECT
        uho.user_context_id AS "userContextId",
        vi.nombre,
        vi.apellido,
        uho.minutos_objetivo AS "minutosObjetivo",
        uho.minutos_objetivo_pendiente AS "minutosObjetivoPendiente",
        COALESCE(SUM(
          CASE WHEN pd.marcado_in_at IS NOT NULL AND pd.esperado_out IS NOT NULL
               THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (
                      COALESCE(pd.marcado_out_at, pd.esperado_out)
                      - GREATEST(pd.esperado_in, pd.marcado_in_at))) / 60.0)::int - COALESCE(lic.solape, 0))
               ELSE pd.minutos_trabajados END
        ), 0) AS "minutosTrabajados"
     FROM usuarios_horas_objetivo uho
     INNER JOIN v_interno_users vi ON vi.user_context_id = uho.user_context_id
     LEFT JOIN planificacion_diaria pd
       ON pd.user_context_id = uho.user_context_id
       AND pd.licencia = false
       AND DATE(pd.esperado_in) BETWEEN DATE($1) AND DATE($2)
     -- Licencias por horas dentro del intervalo trabajado (mismo criterio que SQL_CALCULAR_HORAS_TRABAJADAS)
     LEFT JOIN LATERAL (
       SELECT SUM(ROUND(EXTRACT(EPOCH FROM (
                LEAST(sa.fecha_fin, COALESCE(pd.marcado_out_at, pd.esperado_out))
                - GREATEST(sa.fecha_inicio, pd.esperado_in, pd.marcado_in_at))) / 60.0)::int) AS solape
       FROM solicitudes_ausencia sa
       WHERE sa.usuario_id = pd.user_context_id
         AND sa.estado IN ('APROBADA', 'CONSUMIDA')
         AND sa.deleted_at IS NULL
         AND sa.cantidad_minutos IS NOT NULL
         AND sa.fecha_inicio < COALESCE(pd.marcado_out_at, pd.esperado_out)
         AND sa.fecha_fin > GREATEST(pd.esperado_in, pd.marcado_in_at)
     ) lic ON true
     WHERE ($3::int IS NULL OR uho.user_context_id = $3)
       AND ($4::text IS NULL OR vi.rol_nombre = $4)
       AND ($5::int IS NULL OR vi.id_rol >= $5)
     GROUP BY uho.user_context_id, vi.nombre, vi.apellido, uho.minutos_objetivo, uho.minutos_objetivo_pendiente
     ORDER BY vi.apellido, vi.nombre`,
    [fechaInicio, fechaFin, userContextId ?? null, rolNombre ?? null, idRolViewer ?? null]
  );

  return result.rows.map(row => ({
    userContextId: Number(row.userContextId),
    nombre: row.nombre,
    apellido: row.apellido,
    minutosObjetivo: Number(row.minutosObjetivo),
    minutosObjetivoPendiente: row.minutosObjetivoPendiente === null ? null : Number(row.minutosObjetivoPendiente),
    minutosTrabajados: Number(row.minutosTrabajados),
  }));
};

export const getUserShiftsByUser = async (userContextId: number, fechaInicio: Date, fechaFin: Date): Promise<HorarioUsuarioDTO[]> => {
  const queryText = `
      SELECT 
          pd.id,
          pd.user_context_id,
          pd.turno,
          pd.esperado_in,
          pd.esperado_out,
          pd.sede_id_in,
          pd.sede_id_out,
          pd.licencia,
          pd.feriado,
          pd.acepted_at,
          pd.marcado_in_at,
          pd.marcado_out_at,
          pd.horario_corrido,
          viu.nombre,
          viu.apellido
      FROM planificacion_diaria pd
      INNER JOIN v_interno_users viu
          ON pd.user_context_id = viu.user_context_id
      WHERE pd.user_context_id = $1
        AND DATE(pd.esperado_in) BETWEEN DATE($2) AND DATE($3)
      ORDER BY pd.esperado_in ASC;
  `;

  const queryParams = [userContextId, fechaInicio, fechaFin];

  const result = await pool.query(queryText, queryParams);
  return result.rows;
};

export interface AceptarTurnoRow {
  id: number;
  acepted_at: string;
}

export type AceptarTurnoResult =
  | { status: 'ok'; row: AceptarTurnoRow }
  | { status: 'passed' }
  | { status: 'not_found' };

const TURNO_VIGENTE_SQL = `(esperado_in IS NULL OR esperado_in > (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))`;

export const aceptarTurno = async (planificacionId: number, userContextId: number): Promise<AceptarTurnoResult> => {
  const updated = await pool.query(
    `UPDATE planificacion_diaria
     SET acepted_at = COALESCE(acepted_at, now())
     WHERE id = $1 AND user_context_id = $2 AND ${TURNO_VIGENTE_SQL}
     RETURNING id, acepted_at`,
    [planificacionId, userContextId]
  );

  if (updated.rows[0]) {
    return { status: 'ok', row: updated.rows[0] };
  }

  const check = await pool.query(
    `SELECT ${TURNO_VIGENTE_SQL} AS vigente
     FROM planificacion_diaria
     WHERE id = $1 AND user_context_id = $2`,
    [planificacionId, userContextId]
  );

  if (check.rows.length === 0) {
    return { status: 'not_found' };
  }
  return { status: 'passed' };
};

export interface ShiftUpdateRow {
  userContextId: number;
  turno: string;
  nombre: string | null;
  apellido: string | null;
  previoIn: string | null;
  previoOut: string | null;
  nuevoIn: string | null;
  nuevoOut: string | null;
  licencia: boolean;
}

const aplicarHorarioCorrido = async (client: PoolClient, turnoId: number): Promise<void> => {
  const { rows } = await client.query<{
    id: string;
    licencia: boolean;
    marcado_in_at: string | null;
    marcado_out_at: string | null;
  }>(
    `SELECT p.id, p.licencia, p.marcado_in_at, p.marcado_out_at
     FROM planificacion_diaria p
     WHERE (p.user_context_id, DATE(p.esperado_in)) = (
       SELECT user_context_id, DATE(esperado_in) FROM planificacion_diaria WHERE id = $1
     )
     ORDER BY p.esperado_in ASC, p.id ASC
     FOR UPDATE OF p`,
    [turnoId]
  );

  const [conservado, ...eliminados] = rows;
  if (!conservado) return;

  if (rows.some(r => r.licencia)) {
    throw new ConflictError('No se puede aplicar horario corrido en un día con licencia.');
  }
  if (eliminados.some(r => r.marcado_in_at || r.marcado_out_at)) {
    throw new ConflictError('No se puede aplicar horario corrido: algún turno del día ya tiene marcado.');
  }
  if (conservado.marcado_out_at) {
    throw new ConflictError('No se puede aplicar horario corrido: el turno ya tiene la salida marcada.');
  }

  if (eliminados.length > 0) {
    await client.query('DELETE FROM planificacion_diaria WHERE id = ANY($1::bigint[])', [eliminados.map(r => r.id)]);
  }
  await client.query(
    `UPDATE planificacion_diaria
     SET esperado_out = NULL, sede_id_out = sede_id_in, horario_corrido = true, modificado_manualmente = true
     WHERE id = $1`,
    [conservado.id]
  );
};

export const updateShiftsManually = async <T = void>(
  datos: HorariosDTO,
  beforeCommit?: (turno: ShiftUpdateRow) => Promise<T>
): Promise<{ turno: ShiftUpdateRow; resultado: T | undefined } | null> => {
    const query = `
      WITH previo AS (
        SELECT p.id, p.esperado_in AS previo_in, p.esperado_out AS previo_out, vi.nombre, vi.apellido
        FROM planificacion_diaria p
        LEFT JOIN v_interno_users vi ON vi.user_context_id = p.user_context_id
        WHERE p.id = $6
        FOR UPDATE OF p
      )
      UPDATE planificacion_diaria pd
      SET
        esperado_in = CASE WHEN marcado_in_at IS NULL THEN $1::timestamp ELSE esperado_in END,
        esperado_out = CASE WHEN marcado_out_at IS NULL THEN $2::timestamp ELSE esperado_out END,
        sede_id_in = CASE WHEN marcado_in_at IS NULL THEN CAST($3 AS INTEGER) ELSE sede_id_in END,
        sede_id_out = CASE WHEN marcado_out_at IS NULL THEN CAST($4 AS INTEGER) ELSE sede_id_out END,
        licencia = CASE WHEN marcado_in_at IS NULL THEN $5 ELSE licencia END,
        -- Un turno sintético al que se le quita la licencia pasa a ser un turno real.
        generica = generica AND (CASE WHEN marcado_in_at IS NULL THEN $5 ELSE licencia END),
        -- La licencia a mano descuenta el turno entero del objetivo (se suma a lo ya recortado por
        -- licencias por horas); al sacarla, se repone.
        minutos_licencia = CASE
          WHEN NOT licencia AND (CASE WHEN marcado_in_at IS NULL THEN $5 ELSE licencia END)
            THEN minutos_licencia + planificacion_minutos_turno(
              user_context_id,
              CASE WHEN marcado_in_at IS NULL THEN $1::timestamp ELSE esperado_in END,
              CASE WHEN marcado_out_at IS NULL THEN $2::timestamp ELSE esperado_out END)
          WHEN licencia AND NOT (CASE WHEN marcado_in_at IS NULL THEN $5 ELSE licencia END) THEN 0
          ELSE minutos_licencia END,
        horario_corrido = COALESCE($7::boolean, horario_corrido),
        modificado_manualmente = true
      FROM previo
      WHERE pd.id = previo.id
      RETURNING
        pd.user_context_id AS "userContextId",
        pd.turno,
        previo.nombre,
        previo.apellido,
        previo.previo_in AS "previoIn",
        previo.previo_out AS "previoOut",
        pd.esperado_in AS "nuevoIn",
        pd.esperado_out AS "nuevoOut",
        pd.licencia;
    `;

    const params = [
      datos.horario_in,
      datos.horario_out,
      datos.sede_id_in,
      datos.sede_id_out,
      datos.licencia,
      datos.id,
      datos.horarioCorrido ?? null,
    ];

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query<ShiftUpdateRow>(query, params);
      const turno = result.rows[0];
      if (!turno) {
        await client.query('ROLLBACK');
        return null;
      }

      // El turno editado ya es real: el otro turno sintético del día sobra.
      await client.query(
        `DELETE FROM planificacion_diaria s
         USING planificacion_diaria e
         WHERE e.id = $1 AND NOT e.generica AND s.generica
           AND s.user_context_id = e.user_context_id AND DATE(s.esperado_in) = DATE(e.esperado_in)`,
        [datos.id]
      );

      if (datos.horarioCorrido === true) {
        await aplicarHorarioCorrido(client, datos.id as number);
      }

      const resultado = beforeCommit ? await beforeCommit(turno) : undefined;

      await client.query('COMMIT');
      return { turno, resultado };
    }
    catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    finally {
      client.release();
    }
};

// Minutos desde la entrada marcada durante los cuales una salida se ignora (doble escaneo / reintento).
export const SALIDA_MARGEN_MINUTOS = 15;

export const getDataToCheckScan = async (data: ScanDTO): Promise<CheckScanRaw> => {
  const query = `
    SELECT
      p.id AS "planificacionId",
      p.turno,
      p.esperado_in,
      p.esperado_out,
      d.device_identifier AS "deviceId",
      d.id AS "deviceRowId",
      CASE
        WHEN p.marcado_in_at IS NULL THEN 'IN'
        WHEN p.marcado_out_at IS NULL THEN 'OUT'
        ELSE 'DONE'
      END AS "tipo_scan",
      (p.marcado_in_at IS NOT NULL AND NOW() - p.marcado_in_at < $6::int * INTERVAL '1 minute') AS "dentroMargenSalida",
      s.codigo_qr AS "codigoQr",
      s.qr_mode AS "qrMode",
      s.qr_secret AS "qrSecret",
      ST_DWithin(
        s.ubicacion,
        ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
        s.radio_permitido_metros
      ) AS "geofence",
      json_agg(
        json_build_object(
          'inicio', sa.fecha_inicio,
          'fin', sa.fecha_fin
        )
      ) FILTER (WHERE sa.id IS NOT NULL) AS solicitudes
    FROM planificacion_diaria p
    INNER JOIN sedes s
      ON s.id = CASE
        WHEN p.marcado_in_at IS NULL THEN p.sede_id_in
        ELSE p.sede_id_out
      END
    LEFT JOIN scan_devices d
      ON p.user_context_id = d.user_context_id
    LEFT JOIN solicitudes_ausencia sa
      ON sa.usuario_id = p.user_context_id
      AND sa.estado = 'APROBADA'
      AND sa.fecha_inicio < COALESCE(p.esperado_out, (DATE(p.esperado_in) + 1)::timestamp)
      AND sa.fecha_fin > p.esperado_in
    WHERE p.user_context_id = $1
      AND p.turno = $3
      AND DATE(p.esperado_in) = $2::date
    GROUP BY
      p.id,
      d.device_identifier,
      d.id,
      s.ubicacion,
      s.radio_permitido_metros,
      s.codigo_qr,
      s.qr_mode,
      s.qr_secret;
  ` ;

  const result = await pool.query(query, [
    data.userContextId,
    data.fecha,
    data.turno,
    data.longitud,
    data.latitud,
    SALIDA_MARGEN_MINUTOS
  ]);

  if (result.rows.length === 0) {
    throw new NotFoundError('No se encontró planificación para el usuario en esa fecha y turno.');
  }

  const row = result.rows[0];

  return {
    planificacion: {
      planificacionId: row.planificacionId,
      turno: data.turno,
      esperado_in: row.esperado_in,
      esperado_out: row.esperado_out,
      deviceId: row.deviceId,
      deviceRowId: row.deviceRowId,
      tipo_scan: row.tipo_scan,
      dentroMargenSalida: row.dentroMargenSalida,
      geofence: row.geofence,
      codigoQr: row.codigoQr,
      qrMode: row.qrMode,
      qrSecret: row.qrSecret
    },
    solicitudes: row.solicitudes || []
  };
};

export interface ReporteScanRow {
  id: number;
  titulo: string;
}

/**
 * Resultado de registrar un escaneo:
 * - registrado=true: la marca quedó escrita (COMMIT hecho) en planificacion_diaria; `reporte` es el
 *   reporte generado por llegada tarde / salida anticipada, o null si no hubo.
 * - registrado=false: la marca ya estaba hecha cuando se intentó escribir (otro escaneo concurrente
 *   o un reintento ganó la carrera). No se escribió nada.
 */
export type RegisterScanResult =
  | { registrado: true; reporte: ReporteScanRow | null }
  | { registrado: false };

export const registerScan = async (scanData: ScanDTO, tipoScan: string, planificacionId: number, deviceRowId: number | null): Promise<RegisterScanResult> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const columna = tipoScan === 'IN' ? 'marcado_in_at' : 'marcado_out_at';
    const esperadoCol = tipoScan === 'IN' ? 'esperado_in' : 'esperado_out';
    const sedeCol = tipoScan === 'IN' ? 'sede_id_in' : 'sede_id_out';
    // Escritura condicional: getDataToCheckScan leyó el estado fuera de esta transacción, así que
    // dos escaneos casi simultáneos podían leer ambos "IN" y el segundo pisaba marcado_in_at (y
    // dejaba un scan duplicado). El UPDATE toma el lock de la fila y, si otro escaneo ya marcó,
    // la condición deja de cumplirse y no actualiza nada.
    const { rows, rowCount } = await client.query(
      `UPDATE planificacion_diaria SET ${columna} = NOW()
       WHERE id = $1
         AND ${columna} IS NULL
         ${tipoScan === 'OUT' ? 'AND marcado_in_at IS NOT NULL' : ''}
       RETURNING
         ${columna} AS "marcadoAt",
         ${esperadoCol} AS "esperadoAt",
         (SELECT nombre FROM sedes WHERE id = ${sedeCol}) AS "sedeNombre",
         ($2 = 'IN' AND esperado_in IS NOT NULL AND ${columna} > esperado_in) AS "llegadaTarde",
         ($2 = 'OUT' AND esperado_out IS NOT NULL AND NOT horario_corrido AND ${columna} < esperado_out) AS "salidaAnticipada"`,
      [planificacionId, tipoScan]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      return { registrado: false };
    }

    await client.query(
      `INSERT INTO scans (user_context_id, created_at, latitud, longitud, tipo_scan, device_id, planificacion_diaria_id)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6);`,
      [scanData.userContextId, scanData.latitud, scanData.longitud, tipoScan, deviceRowId, planificacionId]
    );

    const { marcadoAt, esperadoAt, sedeNombre, llegadaTarde, salidaAnticipada } = rows[0];
    let reporte: ReporteScanRow | null = null;

    if (llegadaTarde || salidaAnticipada) {
      const titulo = llegadaTarde ? 'Registro tardío' : 'Salida anticipada';
      const descripcion = `${titulo} marcado el ${formatFechaHora(parseTimestampAR(marcadoAt))}. ` +
        `Horario esperado: ${formatFechaHora(parseTimestampAR(esperadoAt))}` +
        (sedeNombre ? ` - Sede: ${sedeNombre}` : '');
      const inserted = await client.query(
        `INSERT INTO reportes (usuario_reportado_id, creador_id, titulo, descripcion, categoria, estado, fecha_incidente)
         VALUES ($1, NULL, $2, $3, 'NEGATIVO', 'ASENTADO', NOW())
         RETURNING id`,
        [scanData.userContextId, titulo, descripcion]
      );
      reporte = { id: inserted.rows[0].id, titulo };
    }

    await client.query('COMMIT');
    return { registrado: true, reporte };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const registerDevice = async (deviceId: string, userContextId: number): Promise<void> => {
  const query = `
    INSERT INTO scan_devices (device_identifier, user_context_id)
    VALUES ($1, $2)
    ON CONFLICT (device_identifier) DO NOTHING; -- Evita errores si el dispositivo ya está registrado
  `;

  const params = [deviceId, userContextId];

  await pool.query(query, params);
};

export const getSedeQrSecret = async (sedeId: number): Promise<{ qrSecret: string; qrMode: string } | null> => {
  const result = await pool.query(
    `SELECT qr_secret AS "qrSecret", qr_mode AS "qrMode" FROM sedes WHERE id = $1`,
    [sedeId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return { qrSecret: row.qrSecret, qrMode: row.qrMode };
};

// Fecha argentina de un parámetro timestamp (los Date de Node llegan con offset).
const sqlFechaAR = (param: string) => `(${param}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`;

// Turnos sin licencia de los días [$1, $2] con sus minutos trabajados partidos en el sábado 13 hs:
// `post` es lo trabajado desde ahí (hora extra) y el resto cuenta para la semana. Un turno que cruza
// las 13 aporta a ambos lados. `post` se acota a minutos_trabajados (que ya descuenta licencias).
const sqlTramosSemana = () => `
      SELECT p.user_context_id,
             p.minutos_trabajados AS total,
             LEAST(p.minutos_trabajados, ${sqlMinutosPostSabado('iv')}) AS post
      FROM planificacion_diaria p
      LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = p.user_context_id${SQL_JOIN_INTERVALO_REALIZADO}
      WHERE p.licencia = FALSE
        AND p.esperado_in IS NOT NULL
        AND DATE(p.esperado_in) BETWEEN ${sqlFechaAR('$1')} AND ${sqlFechaAR('$2')}`;

// Excedente de la semana (lunes a sábado 13 hs) sobre el objetivo, en minutos.
export const getHorasExcedentesSemanales = async (inicio: Date, fin: Date): Promise<ResumenHorasUsuarioDTO[]> => {
  const query = `
    -- Minutos trabajados de la semana: sin licencias y sin lo que cae desde el sábado 13 hs
    WITH trabajados AS (
      SELECT user_context_id, SUM(total - post) AS total
      FROM (${sqlTramosSemana()}
      ) t
      GROUP BY user_context_id
    ),
    -- Minutos de licencia aplicados a los turnos (solape de las licencias por horas): descuentan
    -- del objetivo semanal
    licencias AS (
      SELECT user_context_id, SUM(minutos_licencia) AS total
      FROM planificacion_diaria
      WHERE DATE(esperado_in) BETWEEN ${sqlFechaAR('$1')} AND ${sqlFechaAR('$2')}
        AND minutos_licencia > 0
        AND NOT ${sqlEsPostSabado('esperado_in')}
      GROUP BY user_context_id
    ),
    excedentes AS (
      SELECT uho.user_context_id,
             GREATEST(
               COALESCE(t.total, 0) - GREATEST(uho.minutos_objetivo - COALESCE(l.total, 0), 0),
               0
             ) AS minutos
      FROM usuarios_horas_objetivo uho
      LEFT JOIN trabajados t ON t.user_context_id = uho.user_context_id
      LEFT JOIN licencias l ON l.user_context_id = uho.user_context_id
    )
    SELECT user_context_id AS "userContextId", minutos AS "minutos"
    FROM excedentes
    WHERE minutos > 0
  `;

  const result = await pool.query(query, [inicio, fin]);
  // pg devuelve SUM como string: casteamos a number para el DTO
  return result.rows.map(row => ({
    userContextId: row.userContextId,
    minutos: Number(row.minutos)
  }));
};

// Minutos trabajados desde el sábado 13 hs (incluida la parte de un turno que lo cruza), sin
// contar francos/permisos (licencia = false). `inicio` y `fin` son los días a revisar (sábado y domingo).
export const getHorasExtrasPostSabado = async (inicio: Date, fin: Date): Promise<ResumenHorasUsuarioDTO[]> => {
  const query = `
    SELECT user_context_id AS "userContextId", SUM(post) AS "minutos"
    FROM (${sqlTramosSemana()}
    ) t
    GROUP BY user_context_id
    HAVING SUM(post) > 0
  `;

  const result = await pool.query(query, [inicio, fin]);
  return result.rows.map(row => ({
    userContextId: row.userContextId,
    minutos: Number(row.minutos)
  }));
};

export const acreditarHorasFrancos = async (saldos: ResumenHorasUsuarioDTO[], semana: Date): Promise<number> => {
  const jsonSaldos = JSON.stringify(saldos);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ledger = await client.query(
      `INSERT INTO resumen_semanal_ejecutado (semana) VALUES ($1::date) ON CONFLICT (semana) DO NOTHING RETURNING semana`,
      [semana]
    );

    if (ledger.rowCount === 0) {
      await client.query('ROLLBACK');
      return -1;
    }

    const result = await client.query(
      `
      WITH upsert AS (
        INSERT INTO saldos_francos (user_context_id, minutos_disponibles)
        SELECT "userContextId", minutos
        FROM jsonb_to_recordset($1::jsonb) AS x("userContextId" INT, minutos INT)
        ON CONFLICT (user_context_id) DO UPDATE
          SET minutos_disponibles = saldos_francos.minutos_disponibles + EXCLUDED.minutos_disponibles,
              updated_at = now()
        RETURNING user_context_id, minutos_disponibles, minutos_consumidos
      )
      INSERT INTO saldos_francos_movimientos
        (user_context_id, tipo_movimiento, minutos,
         minutos_disponibles_resultante, minutos_consumidos_resultante, semana_inicio)
      SELECT u.user_context_id, 'acreditacion', j.minutos,
             u.minutos_disponibles, u.minutos_consumidos, $2::date
      FROM upsert u
      JOIN jsonb_to_recordset($1::jsonb) AS j("userContextId" INT, minutos INT)
        ON j."userContextId" = u.user_context_id
      `,
      [jsonSaldos, semana]
    );

    await client.query('COMMIT');
    return result.rowCount || 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Fragmentos SQL compartidos por el cron de minutos trabajados y la proyección semanal: una sola
// definición de cómo se cuentan los minutos de un turno. Esperan el turno como `p` y su objetivo
// como `uho` (LEFT JOIN usuarios_horas_objetivo). La jornada fija del horario corrido sin salida
// (8 h / 4 h medio tiempo) la define jornada_corrido_minutos() en la DB (migración 073).

// Minutos de licencias por horas (APROBADA/CONSUMIDA) que caen dentro del intervalo `iv`.
const solapeLicenciasLateral = (alias: string, iv: string): string => `
    LEFT JOIN LATERAL (
      SELECT SUM(ROUND(EXTRACT(EPOCH FROM (LEAST(sa.fecha_fin, ${iv}.fin) - GREATEST(sa.fecha_inicio, ${iv}.inicio))) / 60.0)::int) AS solape
      FROM solicitudes_ausencia sa
      WHERE sa.usuario_id = p.user_context_id
        AND sa.estado IN ('APROBADA', 'CONSUMIDA')
        AND sa.deleted_at IS NULL
        AND sa.cantidad_minutos IS NOT NULL
        AND sa.fecha_inicio < ${iv}.fin AND sa.fecha_fin > ${iv}.inicio
    ) ${alias} ON true`;

// Intervalo trabajado según las marcas (`iv`) y licencias dentro de él (`lic`): en el medio del
// turno, o si se quedó después de la salida recortada por la licencia, no cuentan como trabajadas.
const SQL_JOIN_INTERVALO_REALIZADO = `
    CROSS JOIN LATERAL (
      SELECT GREATEST(p.esperado_in, p.marcado_in_at) AS inicio,
             COALESCE(p.marcado_out_at, p.esperado_out,
                      GREATEST(p.esperado_in, p.marcado_in_at)
                        + make_interval(mins => jornada_corrido_minutos(uho.minutos_objetivo))) AS fin
    ) iv`;

const SQL_JOINS_MINUTOS_REALIZADOS = `${SQL_JOIN_INTERVALO_REALIZADO}${solapeLicenciasLateral('lic', 'iv')}`;

// Minutos según las marcas: desde esperado_in, o desde la marca si llegó tarde (llegar antes no
// suma), hasta la salida marcada; sin salida, hasta el fin del turno; horario corrido sin salida,
// la jornada fija.
const SQL_MINUTOS_REALIZADOS = `
      GREATEST(0, CASE
        WHEN p.marcado_out_at IS NOT NULL
          THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (p.marcado_out_at - GREATEST(p.esperado_in, p.marcado_in_at))) / 60.0)::int)
        WHEN p.esperado_out IS NOT NULL
          THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (p.esperado_out - GREATEST(p.esperado_in, p.marcado_in_at))) / 60.0)::int)
        ELSE jornada_corrido_minutos(uho.minutos_objetivo)
      END - COALESCE(lic.solape, 0))`;

// Turno completo según lo planificado (`ie`), menos las licencias por horas dentro de él (`lic_esp`).
const SQL_JOINS_MINUTOS_ESPERADOS = `
    CROSS JOIN LATERAL (
      SELECT p.esperado_in AS inicio,
             COALESCE(p.esperado_out,
                      p.esperado_in + make_interval(mins => jornada_corrido_minutos(uho.minutos_objetivo))) AS fin
    ) ie${solapeLicenciasLateral('lic_esp', 'ie')}`;

const SQL_MINUTOS_ESPERADOS = `
      GREATEST(0, ROUND(EXTRACT(EPOCH FROM (ie.fin - ie.inicio)) / 60.0)::int - COALESCE(lic_esp.solape, 0))`;

// Minutos trabajados de cada turno con entrada marcada (cron nocturno).
export const SQL_CALCULAR_HORAS_TRABAJADAS = `
  UPDATE planificacion_diaria pd
  SET minutos_trabajados = c.minutos
  FROM (
    SELECT p.id,${SQL_MINUTOS_REALIZADOS} AS minutos
    FROM planificacion_diaria p
    LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = p.user_context_id${SQL_JOINS_MINUTOS_REALIZADOS}
    WHERE p.licencia = false
      AND p.marcado_in_at IS NOT NULL
      AND DATE(p.esperado_in) BETWEEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - $1::int
                                  AND (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  ) c
  WHERE pd.id = c.id
    AND pd.minutos_trabajados IS DISTINCT FROM c.minutos`;


export const calcularHorasTrabajadasRecientes = async (diasAtras = 1): Promise<number> => {
  const result = await pool.query(SQL_CALCULAR_HORAS_TRABAJADAS, [diasAtras]);
  return result.rowCount ?? 0;
};

// Sábado 13:00 de la semana (lunes a domingo) de `ts`. Lo que se trabaja desde ahí es hora extra.
const sqlSabado13 = (ts: string) =>
  `(DATE(${ts}) + (6 - EXTRACT(ISODOW FROM ${ts})::int) + time '13:00')`;

const sqlEsPostSabado = (ts: string) => `(${ts} >= ${sqlSabado13(ts)})`;

// Minutos del intervalo `iv` (inicio/fin) que caen desde el sábado 13:00.
const sqlMinutosPostSabado = (iv: string) =>
  `GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${iv}.fin - GREATEST(${iv}.inicio, ${sqlSabado13('p.esperado_in')}))) / 60.0)::int)`;

/** Empleado con objetivo para la proyección semanal (minutos). */
export interface ProyeccionUsuarioRow {
  userContextId: number;
  nombre: string;
  apellido: string;
  minutosObjetivo: number;
  minutosObjetivoPendiente: number | null;
  minutosLicencia: number;
  minutosSaldoFrancos: number;
}

/** Turno de la semana con sus minutos esperados (planificados) y realizados (según marcas). */
// Los timestamp sin zona llegan como string 'YYYY-MM-DD HH:MM:SS' (hora argentina; ver pgClient).
export interface ProyeccionTurnoRow {
  id: number;
  userContextId: number;
  fecha: string;
  turno: string;
  esperadoIn: Date | string;
  fin: Date | string;
  licencia: boolean;
  feriado: boolean;
  marcadoInAt: Date | string | null;
  marcadoOutAt: Date | string | null;
  minutosEsperados: number;
  minutosRealizados: number;
  /** Parte de los minutos que cae desde el sábado 13 hs: va a horas extras, no a la semana. */
  minutosPostSabadoEsperados: number;
  minutosPostSabadoRealizados: number;
}

export interface ProyeccionSemanaRows {
  ahora: Date | string;
  usuarios: ProyeccionUsuarioRow[];
  turnos: ProyeccionTurnoRow[];
}

/**
 * Datos para la proyección semanal: empleados con objetivo (mismos filtros que
 * getHorasSemanalesVsObjetivo), sus turnos de la semana con minutos esperados y realizados, y la
 * hora argentina actual de la DB. La clasificación de cada turno la hace el dominio.
 */
export const getTurnosSemanaProyeccion = async ({
  fechaInicio,
  fechaFin,
  userContextId,
  rolNombre,
  idRolViewer,
}: HorasSemanalesParams): Promise<ProyeccionSemanaRows> => {
  const usuarios = await pool.query(
    `SELECT
        uho.user_context_id AS "userContextId",
        vi.nombre,
        vi.apellido,
        uho.minutos_objetivo AS "minutosObjetivo",
        uho.minutos_objetivo_pendiente AS "minutosObjetivoPendiente",
        COALESCE((
          SELECT SUM(pd.minutos_licencia) FROM planificacion_diaria pd
          WHERE pd.user_context_id = uho.user_context_id
            AND DATE(pd.esperado_in) BETWEEN DATE($1) AND DATE($2)
            AND NOT ${sqlEsPostSabado('pd.esperado_in')}
        ), 0) AS "minutosLicencia",
        COALESCE(sf.minutos_disponibles - sf.minutos_consumidos, 0) AS "minutosSaldoFrancos",
        planificacion_ahora_ar() AS ahora
     FROM usuarios_horas_objetivo uho
     INNER JOIN v_interno_users vi ON vi.user_context_id = uho.user_context_id
     LEFT JOIN saldos_francos sf ON sf.user_context_id = uho.user_context_id
     WHERE ($3::int IS NULL OR uho.user_context_id = $3)
       AND ($4::text IS NULL OR vi.rol_nombre = $4)
       AND ($5::int IS NULL OR vi.id_rol >= $5)
     ORDER BY vi.apellido, vi.nombre`,
    [fechaInicio, fechaFin, userContextId ?? null, rolNombre ?? null, idRolViewer ?? null]
  );

  const ids = usuarios.rows.map(r => Number(r.userContextId));
  const turnos = ids.length === 0 ? { rows: [] } : await pool.query(
    `SELECT
        p.id,
        p.user_context_id AS "userContextId",
        to_char(DATE(p.esperado_in), 'YYYY-MM-DD') AS fecha,
        p.turno,
        p.esperado_in AS "esperadoIn",
        ie.fin,
        p.licencia,
        p.feriado,
        p.marcado_in_at AS "marcadoInAt",
        p.marcado_out_at AS "marcadoOutAt",${SQL_MINUTOS_ESPERADOS} AS "minutosEsperados",${SQL_MINUTOS_REALIZADOS} AS "minutosRealizados",
        ${sqlMinutosPostSabado('ie')} AS "minutosPostSabadoEsperados",
        ${sqlMinutosPostSabado('iv')} AS "minutosPostSabadoRealizados"
     FROM planificacion_diaria p
     LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = p.user_context_id${SQL_JOINS_MINUTOS_ESPERADOS}${SQL_JOINS_MINUTOS_REALIZADOS}
     WHERE p.user_context_id = ANY($3::int[])
       AND p.esperado_in IS NOT NULL
       AND DATE(p.esperado_in) BETWEEN DATE($1) AND DATE($2)
     ORDER BY p.esperado_in`,
    [fechaInicio, fechaFin, ids]
  );

  return {
    ahora: usuarios.rows[0]?.ahora ?? new Date(),
    usuarios: usuarios.rows.map(r => ({
      userContextId: Number(r.userContextId),
      nombre: r.nombre,
      apellido: r.apellido,
      minutosObjetivo: Number(r.minutosObjetivo),
      minutosObjetivoPendiente: r.minutosObjetivoPendiente === null ? null : Number(r.minutosObjetivoPendiente),
      minutosLicencia: Number(r.minutosLicencia),
      minutosSaldoFrancos: Number(r.minutosSaldoFrancos),
    })),
    turnos: turnos.rows.map((r: any) => ({
      id: Number(r.id),
      userContextId: Number(r.userContextId),
      fecha: r.fecha,
      turno: r.turno,
      esperadoIn: r.esperadoIn,
      fin: r.fin,
      licencia: r.licencia,
      feriado: r.feriado,
      marcadoInAt: r.marcadoInAt,
      marcadoOutAt: r.marcadoOutAt,
      minutosEsperados: Number(r.minutosEsperados),
      minutosRealizados: Number(r.minutosRealizados),
      minutosPostSabadoEsperados: Number(r.minutosPostSabadoEsperados),
      minutosPostSabadoRealizados: Number(r.minutosPostSabadoRealizados),
    })),
  };
};

export interface UsuarioSinMarcarRow {
  userContextId: number;
  nombre: string;
  apellido: string;
  rolNombre: string;
  falta: 'ENTRADA' | 'SALIDA';
}

export const SALIDA_GRACIA_MINUTOS = 30;

// Cada turno se avisa una sola vez por tipo: la entrada a la mitad del turno (hasta su fin
// efectivo, que en horario corrido es la jornada fija) y la salida al pasar la gracia. El UPDATE
// reclama el aviso en el mismo statement (aviso_*_at), así que corridas repetidas o concurrentes
// del cron no duplican mensajes. Un turno no puede cumplir ambas condiciones a la vez.
export const getUsuariosSinMarcarHoy = async (): Promise<UsuarioSinMarcarRow[]> => {
  const ahora = `(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')`;
  const result = await pool.query(
    `WITH candidatos AS (
       SELECT pd.id,
              CASE WHEN pd.marcado_in_at IS NULL THEN 'ENTRADA' ELSE 'SALIDA' END AS falta
       FROM planificacion_diaria pd
       WHERE pd.licencia = false
         AND pd.esperado_in IS NOT NULL
         AND DATE(pd.esperado_in) = ${ahora}::date
         AND (
           (pd.marcado_in_at IS NULL AND pd.aviso_entrada_at IS NULL
             AND ${ahora} >= pd.esperado_in + (planificacion_fin_turno(pd.id) - pd.esperado_in) / 2)
           OR (pd.marcado_in_at IS NOT NULL AND pd.esperado_out IS NOT NULL
             AND pd.marcado_out_at IS NULL AND pd.aviso_salida_at IS NULL
             AND pd.esperado_out + make_interval(mins => $1) < ${ahora})
         )
       FOR UPDATE OF pd SKIP LOCKED
     ),
     marcados AS (
       UPDATE planificacion_diaria pd
       SET aviso_entrada_at = CASE WHEN c.falta = 'ENTRADA' THEN ${ahora} ELSE pd.aviso_entrada_at END,
           aviso_salida_at = CASE WHEN c.falta = 'SALIDA' THEN ${ahora} ELSE pd.aviso_salida_at END
       FROM candidatos c
       WHERE pd.id = c.id
       RETURNING pd.user_context_id, c.falta
     )
     SELECT DISTINCT
        m.user_context_id AS "userContextId",
        vi.nombre,
        vi.apellido,
        vi.rol_nombre AS "rolNombre",
        m.falta AS "falta"
     FROM marcados m
     INNER JOIN v_interno_users vi ON vi.user_context_id = m.user_context_id
     ORDER BY vi.apellido, vi.nombre`,
    [SALIDA_GRACIA_MINUTOS]
  );
  return result.rows;
};

export interface ShiftTimesRow {
  userContextId: number;
  nombre: string;
  apellido: string;
  // TIMESTAMP sin tz: llegan como string (ver pgClient).
  esperadoIn: string | null;
  esperadoOut: string | null;
  marcadoInAt: string | null;
  marcadoOutAt: string | null;
}

export const getShiftTimesById = async (id: number): Promise<ShiftTimesRow | null> => {
  const result = await pool.query(
    `SELECT pd.user_context_id AS "userContextId", vi.nombre, vi.apellido,
            pd.esperado_in AS "esperadoIn", pd.esperado_out AS "esperadoOut",
            pd.marcado_in_at AS "marcadoInAt", pd.marcado_out_at AS "marcadoOutAt"
     FROM planificacion_diaria pd
     INNER JOIN v_interno_users vi ON vi.user_context_id = pd.user_context_id
     WHERE pd.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
};

export interface ScanEventRow {
  tipoScan: 'IN' | 'OUT';
  createdAt: Date;
  latitud: number;
  longitud: number;
}

export const getScansByPlanificacionId = async (planificacionId: number): Promise<ScanEventRow[]> => {
  const result = await pool.query(
    `SELECT tipo_scan AS "tipoScan", created_at AS "createdAt", latitud, longitud
     FROM scans WHERE planificacion_diaria_id = $1 ORDER BY created_at ASC`,
    [planificacionId]
  );
  return result.rows;
};

