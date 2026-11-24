import jwt from "jsonwebtoken";
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedError } from "../../adapters/errors/AppError";

const ACCESS_SECRET = process.env.JWT_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const ACCESS_EXPIRY = "15m"; //Cambiar en prod
const READONLY_ACCESS_EXPIRY = "30m"; // 30 minutos para usuarios sin verificar
const REFRESH_EXPIRY_DAYS = 7;

const googleClient = new OAuth2Client();
const GOOGLE_AUDIENCES = [process.env.GOOGLE_CLIENT_ID_WEB, process.env.GOOGLE_CLIENT_ID_MOBILE].filter(Boolean) as string[];

export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string; emailVerified: boolean }> {
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_AUDIENCES });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error("Token de Google sin email");
    return { email: payload.email, emailVerified: !!payload.email_verified };
  } catch {
    throw new UnauthorizedError("Token de Google inválido.");
  }
}

export function getRefreshExpiresAt(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);
  return expiresAt;
}

export function generateAccessToken(userId: number, role: string, additionalPayload?: object) {
  const payload = { userId, role, ...additionalPayload, jti: crypto.randomBytes(16).toString('hex') };
  // Usar mayor duración para tokens readonly (usuarios sin verificar)
  const expiry = role === 'readonly' ? READONLY_ACCESS_EXPIRY : ACCESS_EXPIRY;
  const token = jwt.sign(payload, ACCESS_SECRET, { expiresIn: expiry });
  return token;
}

// Encriptar refresh token con Argon2
export async function generateRefreshToken(userContextId: number, role: string) {
  const token = crypto.randomBytes(32).toString('hex'); // Token aleatorio
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex'); // Encriptar el token
  return { token, hashedToken };
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function validateAccessToken(token: string, currentEnvironment?: string) {
  if (!token) throw new Error("Token no proporcionado");
  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as any;
    // Verificación de Entorno
    if (currentEnvironment && payload.entorno !== currentEnvironment) {
      throw new Error("ContextMismatch"); // Error específico para que el front sepa qué pasó
    }
    return payload;
  } catch (err: any) {
    if (err.message === "ContextMismatch") throw err;
    if (err.name === "TokenExpiredError") {
      throw new Error("Access token expirado");
    }
    throw new Error("Access token inválido");
  }
}
