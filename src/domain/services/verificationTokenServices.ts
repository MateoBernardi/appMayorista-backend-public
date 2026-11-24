import { createVerificationToken, findActiveTokensByUserAndPurpose, incrementFailedAttemptsForLote, revokeActiveTokensByUserAndPurpose } from '../../adapters/db/verificationTokensRepo';
import { VerificationTokensDTO } from '../dto/VerificationTokensDTO';
import { sendVerificationMail } from '../../adapters/comunications/sendMail';
import { generateRandomToken } from '../../utils/tokenGenerator';
import { TokenPurpose } from '../../types/tokenPurpose';

import argon2 from 'argon2';

// Configuración Argon2id 
const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 2 ** 14,     // 19 MiB (16384 KB)
  timeCost: 2,             // 2 iteraciones
  parallelism: 1,          // 1 grado de paralelismo
};

/**
 * Genera y envía un token de verificación
 * @param userId - ID del usuario
 * @param contact - Email o teléfono
 * @param method - 'sms' o 'email'
 * @param createdBy - ID del usuario_entidad que solicita el token (opcional)
 * @param purpose - Propósito del token (opcional, default: ACCOUNT_ASSOCIATION)
 * @param entidad - Entidad destino (opcional; en la asociación, la cuenta a la que se envió el código)
 * @returns Token creado
 */
export const sendVerificationToken = async (
    userId: number,
    contact: string,
    method: 'sms' | 'email',
    createdBy?: number | null,
    purpose: TokenPurpose = TokenPurpose.ACCOUNT_ASSOCIATION,
    entidad?: { entidadId: number; entidadTipoId: number } | null,
) => {
    // Generar token aleatorio de 6 dígitos
    const token = generateRandomToken(6);

    const hashedToken = await argon2.hash(token, ARGON2_CONFIG);
    
    // Calcular expiración: 30 minutos en UTC
    // new Date() siempre es UTC internamente, solo se muestra en hora local
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    
    // Crear el token en BD
    const verificationToken = await createVerificationToken(
        userId,
        contact,
        hashedToken,
        method,
        expiresAt,
        createdBy,
        purpose,
        entidad,
    );
    
    if (method === 'email') {
        await sendVerificationMail(contact, token);
    }

    return {
        id: verificationToken.id,
        expires_at: verificationToken.expires_at,
        method,
        token: token  // Retornar el token en texto plano solo para VALIDATE_IDENTITY
    };
};

const MAX_INTENTOS = 3;

export type ResultadoValidacionToken =
    | { success: true; message: string; token: VerificationTokensDTO }
    | { success: false; message: string; attemptsLeft: number };

/**
 * Revoca los códigos activos de un usuario para un propósito (al pedir uno nuevo,
 * los anteriores dejan de valer).
 */
export const revocarTokensActivos = (userId: number, purpose: TokenPurpose) =>
    revokeActiveTokensByUserAndPurpose(userId, purpose);

/**
 * Valida un código contra todos los tokens activos del usuario para ese propósito
 * (en la asociación hay uno por cuenta). Los intentos fallidos se cuentan por lote:
 * se incrementan en todos y al 3.º fallo se revoca el lote, así tener varios
 * códigos no multiplica los intentos. Si coincide, se revoca todo el lote.
 * @param userId - ID del usuario
 * @param token - Código ingresado por el usuario
 * @param purpose - Propósito esperado (un código de otro propósito nunca valida)
 * @returns El token que coincidió (con su entidad) o el motivo del rechazo
 */
export const validateVerificationToken = async (
    userId: number,
    token: string,
    purpose: TokenPurpose
): Promise<ResultadoValidacionToken> => {
    const activos = await findActiveTokensByUserAndPurpose(userId, purpose);

    if (activos.length === 0) {
        return { success: false, message: 'Token inválido.', attemptsLeft: 0 };
    }

    // Verificar intentos disponibles ANTES de validar
    const intentosPrevios = Math.max(...activos.map((t) => t.failed_attempts));
    if (intentosPrevios >= MAX_INTENTOS) {
        await revokeActiveTokensByUserAndPurpose(userId, purpose);
        return { success: false, message: 'Se agotaron los intentos. Solicitá un nuevo token.', attemptsLeft: 0 };
    }

    for (const candidato of activos) {
        if (await argon2.verify(candidato.token, String(token))) {
            // Token válido: revocar el lote para evitar reutilización
            await revokeActiveTokensByUserAndPurpose(userId, purpose);
            return { success: true, message: 'Token validado correctamente.', token: candidato };
        }
    }

    // Registrar intento fallido en todo el lote
    const intentos = await incrementFailedAttemptsForLote(activos.map((t) => t.id));
    if (intentos >= MAX_INTENTOS) {
        await revokeActiveTokensByUserAndPurpose(userId, purpose);
    }
    return {
        success: false,
        message: 'Token inválido.',
        attemptsLeft: Math.max(0, MAX_INTENTOS - intentos)
    };
};
