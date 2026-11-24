import { Request, Response, NextFunction } from 'express';
import { registerVisita, fetchVisitasByCliente, editVisita, removeVisita } from '../domain/services/visitasServices';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';

export const createVisitaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id_cliente, resultado, observacion_visita, proxima_visita } = req.body;

    if (!id_cliente || !resultado) {
      throw new BadRequestError('id_cliente y resultado son requeridos');
    }

    const id_visita = await registerVisita(
      Number(id_cliente),
      resultado,
      observacion_visita ?? null,
      proxima_visita ?? null
    );
    res.status(201).json({ id_visita });
  } catch (error) {
    next(asAppError(error, 'No se pudo registrar la visita'));
  }
};

export const getVisitasController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id_cliente } = req.params;

    if (!id_cliente) {
      throw new BadRequestError('id_cliente es requerido');
    }

    const visitas = await fetchVisitasByCliente(Number(id_cliente));
    res.json(visitas);
  } catch (error) {
    next(asAppError(error, 'No se pudieron obtener las visitas'));
  }
};

export const updateVisitaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id_visita } = req.params;

    if (!id_visita) {
      throw new BadRequestError('id_visita es requerido');
    }

    const { resultado, observacion_visita, proxima_visita } = req.body;
    const fields: Record<string, any> = {};
    if ('resultado' in req.body) fields.resultado = resultado;
    if ('observacion_visita' in req.body) fields.observacion_visita = observacion_visita;
    if ('proxima_visita' in req.body) fields.proxima_visita = proxima_visita;

    const updated = await editVisita(Number(id_visita), fields);
    res.json(updated);
  } catch (error: any) {
    next(asAppError(error, 'No se pudo actualizar la visita'));
  }
};

export const deleteVisitaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id_visita } = req.params;

    if (!id_visita) {
      throw new BadRequestError('id_visita es requerido');
    }

    const deleted = await removeVisita(Number(id_visita));
    res.json(deleted);
  } catch (error: any) {
    next(asAppError(error, 'No se pudo eliminar la visita'));
  }
};
