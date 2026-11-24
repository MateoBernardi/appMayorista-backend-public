import { hashRefreshToken, validateAccessToken } from "../../domain/validations/authValidations";
import { findRefreshTokenByHash, revokeAllUserRefreshTokens } from "../db/authRepo";

export function auth(requiredRoles: string | string[]) {
  return async (req: any, res: any, next: any) => {
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    try {
      let payload: any;
      // Extraer el entorno
      const currentEnvironment = req.headers["x-entorno"];
      // AccessToken: buscar en header con prefijo Bearer obligatorio
      const authHeader = req.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No autorizado." });
      }
      const accessToken = authHeader.slice(7);
      if (!accessToken) {
        return res.status(401).json({ error: "No autorizado." });
      }
      try {
        payload = validateAccessToken(accessToken, currentEnvironment);
      } catch (err: any) {
        // Si el error es específicamente por cambio de entorno, devolvemos 412
        if (err.message === "ContextMismatch") {
          return res.status(412).json({ 
            error: "Conflicto de entorno.", 
            message: "Por favor iniciá sesión nuevamente." 
          });
        }
        return res.status(401).json({ error: "Acceso inválido o expirado" });
      }
      // Validación de roles
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ 
          error: "Acceso denegado",
        });
      }
      req.user = payload;
      next();
    } catch (err: any) {
      return res.status(401).json({ error: "Sesión inválida o expirada" });
    }
  };
}

// Middleware específico para endpoints de refresh que permite refreshToken
export function authRefresh(requiredRoles: string | string[]) {
  return async (req: any, res: any, next: any) => {
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    try {
      let payload: any;
      // Siempre leer refreshToken del body
      const refreshToken: string = req.body?.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({ error: "Sesión requerida" });
      }
      try {
        // Hashear el token recibido y buscar en BD incluyendo revocados (para detectar reuso)
        const hash = hashRefreshToken(refreshToken);
        const dbToken = await findRefreshTokenByHash(hash);

        if (!dbToken) {
          return res.status(401).json({ error: "Token de actualización inválido" });
        }

        // DETECCIÓN DE REUSO: si el token ya fue revocado, posible robo → invalidar toda la familia
        if (dbToken.revoked) {
          await revokeAllUserRefreshTokens(dbToken.id_usuario_entidad);
          console.warn(`[SECURITY] Token reuse detected. All tokens revoked for user_context_id: ${dbToken.id_usuario_entidad}`);
          return res.status(401).json({ error: "Sesión comprometida. Iniciá sesión nuevamente." });
        }

        // Poblar req.user con datos frescos de la BD
        payload = {
          role: dbToken.rol_nombre,
          userContextId: dbToken.user_context_id,
          entidadId: dbToken.id_entidad,
          entidadTipoId: dbToken.id_entidad_tipo,
          entorno: dbToken.origen
        };
        req.dbToken = dbToken;
      } catch (err: any) {
        return res.status(401).json({ error: "Token de actualización inválido o expirado" });
      }
      // Validación de roles
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "Acceso denegado" });
      }
      req.user = payload;
      next();
    } catch (err: any) {
      return res.status(401).json({ error: "Error en validación de token de actualización" });
    }
  };
}