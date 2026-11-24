import { Request, Response, NextFunction } from 'express';
import {
  addNovedadWeb,
  fetchNovedadesWeb,
  fetchNovedadesWebPublicadas,
  fetchNovedadWebOrThrow,
  modifyNovedadWeb,
  removeNovedadWeb,
} from '../../domain/services/web/novedadesWebServices';
import { asAppError } from '../../adapters/errors/AppError';
import { requireIdParam, requireUserContextId } from '../../utils/requestGuards';

export const listNovedadesWebController = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const novedades = await fetchNovedadesWeb();
    res.status(200).json(novedades);
  } catch (error) {
    next(asAppError(error, 'No se pudieron obtener las novedades.'));
  }
};

export const getNovedadWebByIdController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = requireIdParam(req, 'id');
    const novedad = await fetchNovedadWebOrThrow(id);
    res.status(200).json(novedad);
  } catch (error) {
    next(asAppError(error, 'No se pudo obtener la novedad.'));
  }
};

export const createNovedadWebController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { titulo, preview, cuerpo, imagen, publicada_en, estado } = req.body;
    const created_by = requireUserContextId(req);

    const novedad = await addNovedadWeb({
      titulo,
      preview,
      cuerpo,
      imagen,
      publicada_en: publicada_en ? new Date(publicada_en) : undefined,
      estado,
      created_by,
    });
    res.status(201).json(novedad);
  } catch (error) {
    next(asAppError(error, 'No se pudo crear la novedad.'));
  }
};

export const updateNovedadWebController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = requireIdParam(req, 'id');
    const { titulo, preview, cuerpo, imagen, publicada_en, estado } = req.body;

    const novedad = await modifyNovedadWeb(id, {
      titulo,
      preview,
      cuerpo,
      imagen,
      publicada_en: publicada_en ? new Date(publicada_en) : undefined,
      estado,
    });
    res.status(200).json(novedad);
  } catch (error) {
    next(asAppError(error, 'No se pudo actualizar la novedad.'));
  }
};

export const deleteNovedadWebController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = requireIdParam(req, 'id');
    const result = await removeNovedadWeb(id);
    res.status(200).json(result);
  } catch (error) {
    next(asAppError(error, 'No se pudo eliminar la novedad.'));
  }
};

export const listNovedadesWebPublicasController = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const novedades = await fetchNovedadesWebPublicadas();
    res.status(200).json(novedades);
  } catch (error) {
    next(asAppError(error, 'No se pudieron obtener las novedades.'));
  }
};
