
import { randomInt } from 'crypto';

/**
 * Genera un token aleatorio de números (criptográficamente seguro)
 * @param length - Longitud del token (default 6)
 * @returns Token numérico aleatorio
 */
export const generateRandomToken = (length: number = 6): string => {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length);
    return randomInt(min, max).toString();
};

/**
 * Genera un token criptográfico aleatorio (64 caracteres)
 * @returns Token aleatorio en hexadecimal
 */
export const generateCryptoToken = (): string => {
    return require('crypto').randomBytes(32).toString('hex');
};
