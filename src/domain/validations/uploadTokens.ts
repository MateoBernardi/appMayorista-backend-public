import jwt from "jsonwebtoken";
import { BadRequestError, InternalServerError } from "../../adapters/errors/AppError";

/**
 * Tokens de subida directa a Cloudflare.
 * Flujo: el backend firma la subida (devuelve uploadUrl + token), el cliente sube directo
 * a Cloudflare y después confirma con el token. El token fija del lado del servidor qué
 * objeto se va a registrar, así el cliente nunca elige keys/IDs ni confirma objetos ajenos.
 * Secret propio (no JWT_SECRET) para que un token de subida nunca valga como access token.
 */
const AUDIENCE = "upload";
const EXPIRY = "10m";

export type UploadTokenPayload =
  | { tipo: "cv"; key: string; ext: string }
  | { tipo: "imagen"; cfImageId: string }
  | { tipo: "video"; key: string; contentType: string };

const getSecret = (): string => {
  const secret = process.env.UPLOAD_TOKEN_SECRET;
  if (!secret) {
    console.error("Error: falta la variable de entorno UPLOAD_TOKEN_SECRET.");
    throw new InternalServerError("No se pudo procesar la subida en este momento.");
  }
  return secret;
};

export function signUploadToken(payload: UploadTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: EXPIRY, audience: AUDIENCE });
}

/** Verifica el token y que sea de alguno de los tipos esperados. */
export function verifyUploadToken<T extends UploadTokenPayload["tipo"]>(
  token: unknown,
  tipos: T | readonly T[]
): Extract<UploadTokenPayload, { tipo: T }> {
  const esperados: readonly string[] = Array.isArray(tipos) ? tipos : [tipos];
  if (typeof token !== "string" || !token) {
    throw new BadRequestError("La subida expiró o no es válida. Volvé a intentarlo.");
  }
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, getSecret(), { audience: AUDIENCE });
  } catch {
    throw new BadRequestError("La subida expiró o no es válida. Volvé a intentarlo.");
  }
  const tipo = decoded && typeof decoded === "object" ? (decoded as { tipo?: unknown }).tipo : undefined;
  if (typeof tipo !== "string" || !esperados.includes(tipo)) {
    throw new BadRequestError("La subida expiró o no es válida. Volvé a intentarlo.");
  }
  return decoded as Extract<UploadTokenPayload, { tipo: T }>;
}
