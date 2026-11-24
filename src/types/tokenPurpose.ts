/**
 * Tipos de propósito para tokens de verificación
 * Corresponde al tipo ENUM token_purpose en la base de datos
 */
export enum TokenPurpose {
    VALIDATE_IDENTITY = 'VALIDATE_IDENTITY',      // Validación presencial en oficina
    PASSWORD_RESET = 'PASSWORD_RESET',            // Recuperación de clave
    EMAIL_CHANGE = 'EMAIL_CHANGE',                // Cambio de correo oficial
    ACCOUNT_ASSOCIATION = 'ACCOUNT_ASSOCIATION',  // Vincular una nueva cuenta/entidad
    SENSITIVE_ACTION = 'SENSITIVE_ACTION'         // Autorizar una operación de alto riesgo
}

/**
 * Type guard para validar TokenPurpose
 */
export function isValidTokenPurpose(value: string): value is TokenPurpose {
    return Object.values(TokenPurpose).includes(value as TokenPurpose);
}
