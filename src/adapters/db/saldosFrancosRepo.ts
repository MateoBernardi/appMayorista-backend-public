import { pool } from './pgClient';
import { AppError, NotFoundError, UnprocessableEntityError } from '../errors/AppError';
import { formatMinutos } from '../../utils/duracion';

export interface SaldoFrancoRaw {
  minutos_disponibles: number;
  minutos_consumidos: number;
}

/**
 * Saldo de francos de un usuario en minutos. Devuelve 0/0 si no tiene fila en
 * saldos_francos todavía.
 */
export const getSaldoFrancoByUsuario = async (
  userContextId: number
): Promise<SaldoFrancoRaw> => {
  const result = await pool.query(
    `SELECT minutos_disponibles, minutos_consumidos
     FROM saldos_francos
     WHERE user_context_id = $1`,
    [userContextId]
  );
  if (result.rows.length === 0) {
    return { minutos_disponibles: 0, minutos_consumidos: 0 };
  }
  const row = result.rows[0];
  return {
    minutos_disponibles: Number(row.minutos_disponibles),
    minutos_consumidos: Number(row.minutos_consumidos),
  };
};

/**
 * Objetivo semanal por usuario en minutos, desde usuarios_horas_objetivo. Usuarios sin
 * fila no aparecen en el Map; el llamador decide el default (jornada completa en los
 * consumidores actuales).
 */
export const getObjetivoMinutosPorUsuarios = async (
  userContextIds: number[]
): Promise<Map<number, number>> => {
  if (userContextIds.length === 0) return new Map();

  const result = await pool.query(
    `SELECT user_context_id, minutos_objetivo
     FROM usuarios_horas_objetivo
     WHERE user_context_id = ANY($1::int[])`,
    [userContextIds]
  );

  const map = new Map<number, number>();
  for (const row of result.rows) {
    map.set(row.user_context_id as number, Number(row.minutos_objetivo));
  }
  return map;
};

/** Saldo de horas extra por usuario, en minutos. */
export interface ExtraHorasItem {
  userContextId: number;
  nombre: string;
  apellido: string;
  minutos: number;
}

interface ExtraHorasSaldoParams {
  userContextId?: number | undefined;
  rolNombre?: string | undefined;
}

/**
 * Saldo actual de horas extra por usuario: minutos_disponibles − minutos_consumidos,
 * SIN clampear (puede ser negativo). Solo devuelve usuarios con fila en saldos_francos.
 */
export const getExtraHorasSaldoActual = async ({
  userContextId,
  rolNombre,
}: ExtraHorasSaldoParams): Promise<ExtraHorasItem[]> => {
  const result = await pool.query(
    `SELECT viu.user_context_id AS "userContextId", viu.nombre, viu.apellido,
            (sf.minutos_disponibles - sf.minutos_consumidos) AS minutos
     FROM saldos_francos sf
     JOIN v_interno_users viu ON viu.user_context_id = sf.user_context_id
     WHERE ($1::int IS NULL OR sf.user_context_id = $1)
       AND ($2::text IS NULL OR viu.rol_nombre = $2)`,
    [userContextId ?? null, rolNombre ?? null]
  );

  return result.rows.map(row => ({
    userContextId: Number(row.userContextId),
    nombre: row.nombre,
    apellido: row.apellido,
    minutos: Number(row.minutos),
  }));
};

/**
 * Neto (minutos) consumido por una solicitud de franco: consumos menos reintegros. Un franco
 * por horas puede consumir en varios movimientos (al aprobarse y al generarse turnos nuevos).
 * null si no tiene movimientos. Usado al cancelar para reintegrar exactamente lo consumido, no
 * lo recalculado desde la solicitud.
 */
export const getConsumoFrancoBySolicitud = async (
  solicitudId: number
): Promise<number | null> => {
  const result = await pool.query(
    `SELECT SUM(CASE WHEN tipo_movimiento = 'consumo' THEN minutos ELSE -minutos END) AS neto
     FROM saldos_francos_movimientos
     WHERE solicitud_ausencia_id = $1 AND tipo_movimiento IN ('consumo', 'reintegro')`,
    [solicitudId]
  );
  const neto = result.rows[0]?.neto;
  if (neto == null) return null;
  return Number(neto);
};

/** Fila de movimiento del ledger de un usuario, en minutos. */
export interface MovimientoItem {
  id: number;
  tipoMovimiento: string;
  minutos: number;
  minutosDisponiblesResultante: number | null;
  minutosConsumidosResultante: number | null;
  createdAt: Date;
}

/**
 * Movimientos del ledger de un usuario en un rango [desde, hasta), más recientes primero.
 * En minutos; los snapshots de saldo pueden ser null (movimientos antiguos o excepcionales
 * sin snapshot registrado).
 */
export const getMovimientosByUsuario = async (
  userContextId: number,
  desde: Date,
  hasta: Date
): Promise<MovimientoItem[]> => {
  const result = await pool.query(
    `SELECT id, tipo_movimiento, minutos, minutos_disponibles_resultante, minutos_consumidos_resultante, created_at
     FROM saldos_francos_movimientos
     WHERE user_context_id = $1 AND created_at >= $2 AND created_at < $3
     ORDER BY created_at DESC`,
    [userContextId, desde, hasta]
  );

  return result.rows.map(row => ({
    id: Number(row.id),
    tipoMovimiento: row.tipo_movimiento,
    minutos: Number(row.minutos),
    minutosDisponiblesResultante:
      row.minutos_disponibles_resultante === null ? null : Number(row.minutos_disponibles_resultante),
    minutosConsumidosResultante:
      row.minutos_consumidos_resultante === null ? null : Number(row.minutos_consumidos_resultante),
    createdAt: row.created_at,
  }));
};

/**
 * Liquida (paga) horas de franco: incrementa SOLO minutos_consumidos (minutos_disponibles
 * queda intacto) y registra un movimiento 'liquidacion' en la misma transacción. `minutos`
 * es magnitud positiva. Lanza AppError(404) si el usuario no tiene fila en saldos_francos,
 * y AppError(422) si `minutos` supera el saldo disponible actual (defensa en profundidad,
 * el frontend ya limita esto en la UI).
 */
export const liquidarHorasFranco = async (
  userContextId: number,
  minutos: number
): Promise<SaldoFrancoRaw> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const select = await client.query(
      `SELECT minutos_disponibles, minutos_consumidos
       FROM saldos_francos
       WHERE user_context_id = $1
       FOR UPDATE`,
      [userContextId]
    );

    if (select.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('El usuario no tiene saldo de francos.');
    }

    const actual = select.rows[0];
    const disponible = Number(actual.minutos_disponibles) - Number(actual.minutos_consumidos);

    if (minutos > disponible) {
      await client.query('ROLLBACK');
      throw new UnprocessableEntityError(`No se puede liquidar más horas que el saldo disponible (${formatMinutos(disponible)}).`);
    }

    const update = await client.query(
      `UPDATE saldos_francos
       SET minutos_consumidos = minutos_consumidos + $2,
           updated_at         = now()
       WHERE user_context_id = $1
       RETURNING minutos_disponibles, minutos_consumidos`,
      [userContextId, minutos]
    );

    const row = update.rows[0];

    await client.query(
      `INSERT INTO saldos_francos_movimientos
         (user_context_id, tipo_movimiento, minutos,
          minutos_disponibles_resultante, minutos_consumidos_resultante)
       VALUES ($1, 'liquidacion', $2, $3, $4)`,
      [userContextId, minutos, row.minutos_disponibles, row.minutos_consumidos]
    );

    await client.query('COMMIT');

    return {
      minutos_disponibles: Number(row.minutos_disponibles),
      minutos_consumidos: Number(row.minutos_consumidos),
    };
  } catch (error) {
    if (!(error instanceof AppError)) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
};
