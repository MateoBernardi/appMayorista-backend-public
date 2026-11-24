import { Request, Response, NextFunction } from 'express';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';
import {
  actualizarOfertaService,
  crearOfertaService,
  desactivarOfertaService,
  listarOfertasService,
} from '../domain/services/articulosOfertasServices';

export const crearOfertaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oferta = await crearOfertaService(req.body);
    res.status(201).json(oferta);
  } catch (err) {
    next(asAppError(err, 'No se pudo crear la oferta'));
  }
};

export const actualizarOfertaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oferta_id = parseInt(req.params.oferta_id as string, 10);
    if (!oferta_id) {
      throw new BadRequestError('oferta_id inválido');
    }
    const oferta = await actualizarOfertaService(oferta_id, req.body);
    res.json(oferta);
  } catch (err) {
    next(asAppError(err, 'No se pudo actualizar la oferta'));
  }
};

export const listarOfertasController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const soloActivas = req.query.activas === 'true';
    const rubro = req.query.rubro as string | undefined;
    const ofertas = await listarOfertasService(soloActivas, rubro);
    res.json(ofertas);
  } catch (err) {
    next(asAppError(err, 'No se pudieron obtener las ofertas'));
  }
};

export const desactivarOfertaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oferta_id = parseInt(req.params.oferta_id as string, 10);
    if (!oferta_id) {
      throw new BadRequestError('oferta_id inválido');
    }
    const oferta = await desactivarOfertaService(oferta_id);
    res.json(oferta);
  } catch (err) {
    next(asAppError(err, 'No se pudo desactivar la oferta'));
  }
};
