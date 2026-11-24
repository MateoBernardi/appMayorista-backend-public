import { fetchNovedades, addNovedad, removeNovedad, modifyNovedad } from "../domain/services/novedadesServices";
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import { Request, Response, NextFunction } from "express";
import { NovedadDTO } from "../domain/dto/NovedadDTO";
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { getAllUserIdsExcept } from '../domain/services/usuariosServices';

export const getNovedadesController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const novedades: NovedadDTO[] = await fetchNovedades();
        res.status(200).json(novedades);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const createNovedadController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { titulo, descripcion, id_etiqueta, prioridad } = req.body;
        const userContextId = requireUserContextId(req);

        const nuevaNovedad: NovedadDTO = await addNovedad(titulo, descripcion, id_etiqueta, prioridad, userContextId);

        if (!nuevaNovedad) {
            throw new BadRequestError('No se pudo crear la novedad. Verificá los datos ingresados.');
        }

        res.status(201).json(nuevaNovedad);

        // Enviar notificación en segundo plano (fire-and-forget)
        getAllUserIdsExcept(userContextId)
            .then(userIds => {
                if (userIds.length > 0) {
                    return sendNotificationToMultipleUsers(userIds, {
                        title: '📢 Nueva Novedad',
                        body: titulo || 'Se publicó una nueva novedad',
                        link: 'https://interno.italoarg.com.ar',
                        data: { type: 'nueva_novedad', novedad_id: nuevaNovedad.id },
                        priority: prioridad === 'alta' ? 'high' : 'default'
                    });
                }
            })
            .catch(err => console.error('Error enviando notificación de nueva novedad:', err));
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const deleteNovedadController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const id = parseInt(req.params.id as string ?? "0", 10);
        if (isNaN(id) || id === 0) {
            throw new NotFoundError('Novedad no encontrada.');
        }

        const result = await removeNovedad(id);
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const updateNovedadController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const id = parseInt(req.params.id as string ?? "0", 10);
        const { titulo, descripcion, id_etiqueta, prioridad, created_by } = req.body;
        const userContextId = requireUserContextId(req);

        if (isNaN(id) || id === 0) {
            throw new NotFoundError('Novedad no encontrada.');
        }

        const updatedNovedad: NovedadDTO = await modifyNovedad(id, titulo, descripcion, id_etiqueta, prioridad, created_by);

        res.status(200).json(updatedNovedad);
    }   catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}
