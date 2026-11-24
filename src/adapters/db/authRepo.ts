export const getRefreshTokensByUserContextId = async (userContextId: number) => {
  const result = await pool.query(
    `SELECT * FROM refresh_tokens WHERE id_usuario_entidad = $1 AND revoked = FALSE AND expires_at > NOW()`,
    [userContextId]
  );
  return result.rows;
};
import { pool } from './pgClient';

export const saveRefreshToken = async (userContextId: number, token: string, expiresAt: Date) => {
  const result = await pool.query(
    `INSERT INTO refresh_tokens (id_usuario_entidad, token, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [userContextId, token, expiresAt]
  );
  return result.rows[0];
};

export const revokeRefreshToken = async (id: number) => {
  const result = await pool.query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
};

/**
 * Revocar TODOS los refresh tokens de un usuario_entidad (activos y no expirados).
 * Usado para detección de reuso de tokens (posible robo).
 */
export const revokeAllUserRefreshTokens = async (userContextId: number) => {
  const result = await pool.query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE id_usuario_entidad = $1 AND revoked = FALSE RETURNING *`,
    [userContextId]
  );
  return result.rows;
};

export const deleteRefreshTokens = async (userContextId: number) => {
  const result = await pool.query(
    `DELETE FROM refresh_tokens WHERE id_usuario_entidad = $1 RETURNING *`,
    [userContextId]
  );
  return result.rows;
};

export const findRefreshToken = async (userContextId: string) => {
  const result = await pool.query(
    `SELECT 
       rt.id,
       rt.token,
       rt.created_at,
       rt.expires_at,
       rt.revoked,
       rt.id_usuario_entidad,
       vuc.id_usuario,
       vuc.id_rol,
       vuc.rol_nombre,
       vuc.id_entidad_tipo,
       vuc.id_entidad,
       vuc.entorno AS origen,
       vuc.username,
       vuc.email,
       vuc.nombre,
       vuc.apellido
     FROM refresh_tokens rt
     INNER JOIN v_usuario_entidad_completo vuc ON rt.id_usuario_entidad = vuc.user_context_id
     WHERE rt.id_usuario_entidad = $1 AND rt.revoked = FALSE AND rt.expires_at > NOW()`,
    [userContextId]
  );
  return result.rows;
};

/**
 * Busca tokens incluyendo revocados (para detección de reuso).
 * Si un token revocado es presentado, indica posible robo.
 */
export const findRefreshTokenIncludingRevoked = async (userContextId: string) => {
  const result = await pool.query(
    `SELECT 
       rt.id,
       rt.token,
       rt.created_at,
       rt.expires_at,
       rt.revoked,
       rt.id_usuario_entidad,
       vuc.id_usuario,
       vuc.id_rol,
       vuc.rol_nombre,
       vuc.id_entidad_tipo,
       vuc.id_entidad,
       vuc.entorno AS origen,
       vuc.username,
       vuc.email,
       vuc.nombre,
       vuc.apellido
     FROM refresh_tokens rt
     INNER JOIN v_usuario_entidad_completo vuc ON rt.id_usuario_entidad = vuc.user_context_id
     WHERE rt.id_usuario_entidad = $1 AND rt.expires_at > NOW()`,
    [userContextId]
  );
  return result.rows;
};

/**
 * Busca un token por su hash SHA-256 incluyendo revocados.
 * Usado para detección de reuso (posible robo de token).
 */
export const findRefreshTokenByHash = async (hash: string) => {
  const result = await pool.query(
    `SELECT 
       rt.id,
       rt.token,
       rt.created_at,
       rt.expires_at,
       rt.revoked,
       rt.id_usuario_entidad,
       vuc.id_usuario,
       vuc.id_rol,
       vuc.rol_nombre,
       vuc.id_entidad_tipo,
       vuc.id_entidad,
       vuc.entorno AS origen,
       vuc.user_context_id,
       vuc.username,
       vuc.email,
       vuc.nombre,
       vuc.apellido
     FROM refresh_tokens rt
     INNER JOIN v_usuario_entidad_completo vuc ON rt.id_usuario_entidad = vuc.user_context_id
     WHERE rt.token = $1 AND rt.expires_at > NOW()`,
    [hash]
  );
  return result.rows[0] ?? null;
};

/**
 * Elimina todos los refresh tokens de la base de datos
 * Esta función se ejecuta diariamente mediante un cron job
 */
export const clearAllRefreshTokens = async (): Promise<number> => {
  const result = await pool.query(`DELETE FROM refresh_tokens where revoked = TRUE OR expires_at < NOW()`);
  return result.rowCount || 0;
};