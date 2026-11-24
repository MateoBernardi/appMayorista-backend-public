import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  MAX_ADJUNTO_BYTES,
  agregarAdjunto,
  agregarEntradaInforme,
  crearInforme,
  editarEntrada,
  listarInformes,
  listarVistosEntrada,
  marcarInformeVisto,
  obtenerInforme,
  quitarAdjunto,
  urlAdjunto,
} from '../domain/services/informesServices';
import { BadRequestError, ForbiddenError, asAppError } from '../adapters/errors/AppError';
import { managementRoles } from '../types/roles';
import { requireIdParam, requireUserContextId, requireUserRole } from '../utils/requestGuards';

const FALLBACK = 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.';

/**
 * Vista de management (`?empleado=<id>`): permite leer informes que mencionan a ese empleado.
 * Devuelve el id del empleado, o `undefined` si el parámetro no vino.
 */
function empleadoConsultado(req: Request): number | undefined {
  const raw = req.query.empleado;
  if (raw === undefined) return undefined;
  const id = Number(raw);
  if (typeof raw !== 'string' || !Number.isInteger(id) || id <= 0) {
    throw new BadRequestError('El empleado no es válido.');
  }
  if (!managementRoles.includes(requireUserRole(req))) {
    throw new ForbiddenError('No tenés permiso para ver los informes de otro empleado.');
  }
  return id;
}

const subirArchivo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ADJUNTO_BYTES, files: 1 },
}).single('archivo');

export const uploadAdjuntoMiddleware = (req: Request, res: Response, next: NextFunction) => {
  subirArchivo(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const mensaje =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'El archivo no puede superar los 50 MB.'
          : 'El archivo no es válido. Enviá un único campo "archivo".';
      return next(new BadRequestError(mensaje));
    }
    next(err);
  });
};

/** POST /informes */
export const crearInformeController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const autorId = requireUserContextId(req);
    const data = await crearInforme(autorId, req.body?.cuerpo);
    res.status(201).json({ success: true, data });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** POST /informes/:id/entradas */
export const agregarEntradaController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const autorId = requireUserContextId(req);
    const entrada = await agregarEntradaInforme(
      String(req.params.id),
      autorId,
      req.body?.cuerpo,
      requireUserRole(req) === 'gerencia',
    );
    res.status(201).json({ success: true, data: entrada });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** PATCH /informes/:id/entradas/:entradaId */
export const editarEntradaController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const entradaId = requireIdParam(req, 'entradaId');
    const entrada = await editarEntrada(String(req.params.id), entradaId, personaId, req.body?.cuerpo);
    res.status(200).json({ success: true, data: entrada });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** POST /informes/:id/entradas/:entradaId/adjuntos */
export const agregarAdjuntoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const entradaId = requireIdParam(req, 'entradaId');
    const adjunto = await agregarAdjunto(
      String(req.params.id),
      entradaId,
      personaId,
      req.file,
      req.body?.nombre,
      req.body?.orden,
    );
    res.status(201).json({ success: true, data: adjunto });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** DELETE /informes/:id/entradas/:entradaId/adjuntos/:adjuntoId */
export const quitarAdjuntoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const entradaId = requireIdParam(req, 'entradaId');
    const adjuntoId = requireIdParam(req, 'adjuntoId');
    await quitarAdjunto(String(req.params.id), entradaId, adjuntoId, personaId);
    res.status(200).json({ success: true });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** GET /informes/:id/adjuntos/:adjuntoId */
export const urlAdjuntoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const adjuntoId = requireIdParam(req, 'adjuntoId');
    const data = await urlAdjunto(String(req.params.id), adjuntoId, personaId, empleadoConsultado(req));
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** GET /informes/:id/entradas */
export const getInformeController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const informe = await obtenerInforme(String(req.params.id), personaId, empleadoConsultado(req));
    res.status(200).json({ success: true, data: informe });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** PUT /informes/:id/visto (idempotente: no repite lo ya visto) */
export const marcarInformeVistoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const data = await marcarInformeVisto(String(req.params.id), personaId);
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** GET /informes/:id/entradas/:entradaId/vistos */
export const listarVistosEntradaController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const entradaId = requireIdParam(req, 'entradaId');
    const data = await listarVistosEntrada(String(req.params.id), entradaId, personaId);
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** GET /informes?antes=<ts> */
export const listInformesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const listado = await listarInformes(personaId, req.query.antes);
    res.status(200).json({ success: true, data: listado });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/** GET /informes/empleado/:empleadoId?antes=<ts> (solo management) */
export const listInformesEmpleadoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const personaId = requireUserContextId(req);
    const empleadoId = requireIdParam(req, 'empleadoId');
    const listado = await listarInformes(personaId, req.query.antes, empleadoId);
    res.status(200).json({ success: true, data: listado });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};
