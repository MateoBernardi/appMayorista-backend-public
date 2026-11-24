import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limiter general para toda la aplicación
 * Limita a 600 requests por minuto por IP
 */
export const globalSafetyNetLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 600,
  message: 'Demasiadas solicitudes desde esta IP, por favor intente nuevamente más tarde.',
  standardHeaders: true, // Retorna info de rate limit en los headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita los headers `X-RateLimit-*`
});

/**
 * Rate limiter estricto para rutas de autenticación
 * Limita a 10 intentos por minuto por IP para prevenir ataques de fuerza bruta
 */
export const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 10,
  message: 'Demasiados intentos de inicio de sesión, por favor intente nuevamente más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para rutas públicas
 * Limita a 200 requests por minuto por IP
 */
export const publicLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 200,
  message: 'Demasiadas solicitudes, por favor intente nuevamente más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para la subida pública de CVs (POST /public/cvs/upload-url)
 * Limita a 1 subida por hora por IP
 */
export const cvUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 2,
  message: 'Alcanzaste el límite de envíos de CV, por favor intente nuevamente más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para la confirmación de CVs subidos (POST /public/cvs)
 * Limita a 5 confirmaciones por hora por IP (permite reintentar si falla la red)
 */
export const cvConfirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: 'Alcanzaste el límite de envíos de CV, por favor intente nuevamente más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

const MENSAJE_RECUPERACION = 'Demasiados intentos de recuperación de contraseña, por favor intente nuevamente más tarde.';

// Key por email del body (normalizado), para que rotar IPs no permita atacar una misma cuenta.
// Sin email en el body, cae en la IP (ipKeyGenerator agrupa IPv6 por subred).
const emailKeyGenerator = (req: Request): string => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
};

/**
 * Rate limiters para pedir un código de recuperación (PUT /usuarios/forgot-password)
 * 3 pedidos cada 15 min por IP y 3 por hora por email
 */
export const passwordRecoveryRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3,
  message: MENSAJE_RECUPERACION,
  standardHeaders: true,
  legacyHeaders: false,
});

export const passwordRecoveryRequestEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3,
  keyGenerator: emailKeyGenerator,
  message: MENSAJE_RECUPERACION,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiters para validar el código de recuperación (PUT /usuarios/forgot-password/token)
 * 10 validaciones cada 15 min por IP y 10 por hora por email
 */
export const passwordRecoveryValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: MENSAJE_RECUPERACION,
  standardHeaders: true,
  legacyHeaders: false,
});

export const passwordRecoveryValidateEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  keyGenerator: emailKeyGenerator,
  message: MENSAJE_RECUPERACION,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para pedir códigos de asociación de cuenta (POST /asociar)
 * Cada pedido manda mails: 3 cada 15 min por IP
 */
export const associationRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3,
  message: 'Demasiados pedidos de código, por favor intente nuevamente más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});
