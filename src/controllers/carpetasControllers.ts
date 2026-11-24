import { NextFunction, Request, Response } from 'express';
import { asAppError } from '../adapters/errors/AppError';
import { addCarpeta, editCarpeta, getCarpetaPermisos, listVisibleCarpetas, patchPermisosCarpeta, removeCarpeta, resolveCarpetaNotificationRecipients } from '../domain/services/carpetasServices';
import { CarpetasView, CrearCarpetaDTO, EditarCarpetaDTO } from '../domain/dto/CarpetaDTO';
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { requireIdParam, requireUserContextId, requireUserRole } from '../utils/requestGuards';

const parseNumberArray = (value: any): number[] => {
  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry) => Number(entry)).filter((entry) => !Number.isNaN(entry));
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => !Number.isNaN(entry));
  }

  return [];
};

const parseStringArray = (value: any): string[] => {
  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry) => String(entry));
    } catch {
      return [String(value)];
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return [];
};

export const getVisibleCarpetasController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);

    const rawView = String(req.query.view ?? 'tree').toLowerCase();
    const view: CarpetasView = rawView === 'list' ? 'list' : 'tree';

    const includeSinCarpeta = String(req.query.includeSinCarpeta ?? 'false').toLowerCase() === 'true';

    const payload = await listVisibleCarpetas(userContextId, userRole, view, includeSinCarpeta);
    res.status(200).json(payload);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const createCarpetaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);

    const { nombre, id_carpeta_padre, allowed_roles, usuarios_id } = req.body;

    const payload: CrearCarpetaDTO = {
      nombre,
      id_carpeta_padre: id_carpeta_padre ? Number(id_carpeta_padre) : null,
      id_usuario: userContextId,
      allowed_roles: parseStringArray(allowed_roles),
      usuarios_id: parseNumberArray(usuarios_id),
    };

    const carpeta = await addCarpeta(payload, userRole);
    res.status(201).json(carpeta);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const updateCarpetaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);
    const id = requireIdParam(req, 'id');

    const { nombre, allowed_roles, usuarios_id } = req.body;
    const payload: EditarCarpetaDTO = {};

    if (nombre !== undefined) {
      payload.nombre = nombre;
    }

    if (allowed_roles !== undefined) {
      payload.allowed_roles = parseStringArray(allowed_roles);
    }

    if (usuarios_id !== undefined) {
      payload.usuarios_id = parseNumberArray(usuarios_id);
    }

    const result = await editCarpeta(id, payload, userContextId, userRole);
    if (result.warnings) {
      res.status(207).json(result);
      return;
    }

    res.status(200).json(result.carpeta);

    // Enviar notificación en segundo plano (fire-and-forget)
    Promise.resolve()
      .then(async () => {
        const destinatarios = await resolveCarpetaNotificationRecipients(id, userContextId);
        if (destinatarios.length === 0) {
          return;
        }

        return sendNotificationToMultipleUsers(destinatarios, {
          title: 'Carpeta Actualizada',
          body: `Se actualizaron los datos de la carpeta "${result.carpeta.nombre}."`,
          link: 'https://interno.italoarg.com.ar/documentos',
          data: {
            type: 'carpeta_actualizada',
            carpeta_id: id,
            domain: 'documentos',
            event: 'updated',
            updated_at: new Date().toISOString(),
            entity_id: String(id)
          }
        });
      })
      .catch((err) => console.error('Error enviando notificación de carpeta actualizada:', err));
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const deleteCarpetaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);
    const id = requireIdParam(req, 'id');

    const result = await removeCarpeta(id, userContextId, userRole);
    res.status(200).json(result);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getCarpetaPermisosController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const id = requireIdParam(req, 'id');

    const permisos = await getCarpetaPermisos(id);
    res.status(200).json(permisos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const patchCarpetaPermisosController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);
    const id = requireIdParam(req, 'id');

    const allowed_roles = req.body?.allowed_roles !== undefined
      ? parseStringArray(req.body.allowed_roles)
      : undefined;
    const ids = req.body?.ids !== undefined
      ? parseNumberArray(req.body.ids)
      : undefined;

    if (allowed_roles === undefined && ids === undefined) {
      res.status(400).json({ message: 'Debés enviar allowed_roles o ids para remover permisos.' });
      return;
    }

    if ((allowed_roles?.length ?? 0) === 0 && (ids?.length ?? 0) === 0) {
      res.status(400).json({ message: 'Debés enviar al menos un rol o usuario para remover permisos.' });
      return;
    }

    const payload: { allowed_roles?: string[]; ids?: number[] } = {};
    if (allowed_roles !== undefined) {
      payload.allowed_roles = allowed_roles;
    }
    if (ids !== undefined) {
      payload.ids = ids;
    }

    const permisos = await patchPermisosCarpeta(id, payload, userContextId, userRole);
    res.status(200).json(permisos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};
