import { NextFunction, Request, Response } from 'express';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import { confirmarPlanificacionService, getInfoPlanificacionService, previsualizarPlanificacionService } from '../domain/services/planificacionServices';

const FALLBACK = 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.';

export const previsualizarPlanificacionController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const preview = await previsualizarPlanificacionService(userContextId);
        res.status(200).json(preview);
    } catch (error) {
        next(asAppError(error, FALLBACK));
    }
};

export const confirmarPlanificacionController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const previewId = Number(req.body?.previewId);
        if (!Number.isInteger(previewId) || previewId <= 0) {
            throw new BadRequestError('Por favor, indicá el preview a confirmar.');
        }

        const { snapshotId, altas, modificaciones, bajas, omitidos } =
            await confirmarPlanificacionService(previewId, userContextId);

        res.status(200).json({
            message: 'Planificación actualizada correctamente.',
            snapshotId,
            altas,
            modificaciones,
            bajas,
            omitidos,
        });
    } catch (error) {
        next(asAppError(error, FALLBACK));
    }
};

export const getInfoPlanificacionController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);
        res.status(200).json(await getInfoPlanificacionService());
    } catch (error) {
        next(asAppError(error, FALLBACK));
    }
};
