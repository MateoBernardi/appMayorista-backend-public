import { Request, Response, NextFunction } from 'express';
import { fetchAllLocalidades } from '../domain/services/clientesServices';
import { asAppError } from '../adapters/errors/AppError';

export const getLocalidades = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const localidades = await fetchAllLocalidades();
        const response = localidades.map(({ id_localidad, nombre, zona }) => ({
            id_localidad,
            nombre,
            zona
        }));
        res.json(response);
    } catch (error) {
        next(asAppError(error, "No se pudieron obtener las localidades"));
    }
};
