import { pool } from './pgClient';
import { VerificationTokensDTO } from '../../domain/dto/VerificationTokensDTO';
import { TokenPurpose } from '../../types/tokenPurpose';

/**
 * Crea un nuevo token de verificación
 * @param userId - ID del usuario
 * @param contact - Email o teléfono
 * @param token - Código de verificación (hasheado)
 * @param method - 'sms' o 'email'
 * @param expiresAt - Fecha de expiración
 * @param createdBy - ID del usuario_entidad que solicita el token (opcional)
 * @param purpose - Propósito del token (opcional)
 * @param entidad - Entidad destino de la validación (opcional, para asociación de cuentas)
 * @returns Token creado
 */
export const createVerificationToken = async (
    userId: number,
    contact: string,
    token: string,
    method: 'sms' | 'email',
    expiresAt: Date,
    createdBy?: number | null,
    purpose?: TokenPurpose | null,
    entidad?: { entidadId: number; entidadTipoId: number } | null,
) => {
    const query = `
        INSERT INTO verification_tokens (user_id, contact, token, method, expires_at, created_by, purpose, entidad_id, entidad_tipo_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id, contact, token) DO UPDATE
        SET created_at = CURRENT_TIMESTAMP, expires_at = $5, created_by = $6, purpose = $7, entidad_id = $8, entidad_tipo_id = $9
        RETURNING *;
    `;
    const result = await pool.query(query, [
        userId, contact, token, method, expiresAt, createdBy || null, purpose || null,
        entidad?.entidadId ?? null, entidad?.entidadTipoId ?? null,
    ]);
    return result.rows[0];
};

/**
 * Busca los tokens de verificación activos de un usuario para un propósito
 * (puede haber varios: en la asociación se manda un código por cuenta).
 * @param userId - ID del usuario
 * @param purpose - Propósito del token
 * @returns Tokens activos, el más reciente primero
 */
export const findActiveTokensByUserAndPurpose = async (
    userId: number,
    purpose: TokenPurpose,
): Promise<VerificationTokensDTO[]> => {
    const query = `
        SELECT * FROM verification_tokens
        WHERE user_id = $1
            AND purpose = $2
            AND expires_at > CURRENT_TIMESTAMP
            AND revoked IS NOT TRUE
        ORDER BY created_at DESC;
    `;
    const result = await pool.query(query, [userId, purpose]);
    return result.rows;
};

/**
 * Revoca todos los tokens activos de un usuario para un propósito
 * @param userId - ID del usuario
 * @param purpose - Propósito del token
 */
export const revokeActiveTokensByUserAndPurpose = async (userId: number, purpose: TokenPurpose) => {
    const query = `
        UPDATE verification_tokens
        SET expires_at = CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires',
        revoked = true
        WHERE user_id = $1
            AND purpose = $2
            AND revoked IS NOT TRUE;
    `;
    await pool.query(query, [userId, purpose]);
};

/**
 * Incrementa los intentos fallidos de un lote de tokens (todos los códigos activos
 * de un mismo pedido), así tener varios códigos no multiplica los intentos.
 * @param tokenIds - IDs de los tokens del lote
 * @returns Intentos fallidos más alto del lote después de incrementar
 */
export const incrementFailedAttemptsForLote = async (tokenIds: number[]): Promise<number> => {
    if (tokenIds.length === 0) return 0;
    const query = `
        UPDATE verification_tokens
        SET failed_attempts = failed_attempts + 1
        WHERE id = ANY($1::int[])
        RETURNING failed_attempts;
    `;
    const result = await pool.query(query, [tokenIds]);
    return Math.max(0, ...result.rows.map((r: { failed_attempts: number }) => r.failed_attempts));
};
