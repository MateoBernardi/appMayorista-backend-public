import { NextFunction, Request, Response } from "express";
import { getUsuarioEntidadByContextId } from "../adapters/db/usuariosRepo";
import { asAppError, NotFoundError } from "../adapters/errors/AppError";
import { requireUserContextId } from "../utils/requestGuards";

const setNoCacheHeaders = (res: Response) => {
  // Evita cache en navegador/CDN para no mezclar contexto de usuarios.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("Vary", "Authorization, Cookie, x-app-entorno, x-entorno");
};

export const usuarioContextoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userContextId = requireUserContextId(req);

    const usuarioEntidad = await getUsuarioEntidadByContextId(Number(userContextId));
    if (!usuarioEntidad) {
      throw new NotFoundError("Usuario no encontrado.");
    }

    setNoCacheHeaders(res);

    const { user_context_id, username, email, nombre, apellido, rol_nombre, entidad_tipo_nombre } = usuarioEntidad;
    return res.json({ user_context_id, username, email, nombre, apellido, rol_nombre, entidad_tipo_nombre });
  } catch (error) {
    next(asAppError(error, "No se pudo completar. Intentá de nuevo en unos minutos."));
  }
};
