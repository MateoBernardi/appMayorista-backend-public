import { NextFunction, Request, Response } from 'express';
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import * as solicitudesServices from '../domain/services/solicitudesServices';
import { SolicitudBitacoraDTO, SolicitudDTO } from '../domain/dto/SolicitudDTO';
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { emitToUsers } from '../adapters/realtime/socketServer';

const notifySolicitudUpdated = async (
    solicitudId: number,
    actorUserId: number,
    estado: string,
    observacion?: string
) => {
    if (estado === 'SEEN') {
        return;
    }

    const participantes = await solicitudesServices.getParticipantesDeSolicitud(solicitudId);
    const destinatarios = participantes.filter((id) => id !== actorUserId);
    if (destinatarios.length === 0) {
        return;
    }

    const data = {
        type: 'solicitud_actualizada',
        solicitud_id: solicitudId,
        nuevo_estado: estado,
        domain: 'solicitudesActividades',
        event: 'updated',
        updated_at: new Date().toISOString(),
        entity_id: String(solicitudId),
        observacion,
    };

    await sendNotificationToMultipleUsers(destinatarios, {
        title: 'Tenés un nuevo mensaje.',
        body: data.observacion || 'Hubo modificaciones en una solicitud en la que participás.',
        link: 'https://interno.italoarg.com.ar/solicitud?id=' + solicitudId + '&type=recibida',
        data,
    });

    emitToUsers(destinatarios, data);
};

export const createSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const newSolicitud: SolicitudDTO = {
            ...req.body,
            created_by: userContextId,
            tipo_actividad: req.body.tipo_actividad,
            invitados: [...(req.body.invitados ?? []), userContextId],
            fecha_inicio: req.body.fecha_inicio ? new Date(req.body.fecha_inicio) : null,
            fecha_fin: req.body.fecha_fin ? new Date(req.body.fecha_fin) : null,
        };

        const createResult = await solicitudesServices.createSolicitudService(newSolicitud);

        res.status(createResult.created ? 201 : 200).json(
            createResult.created
                ? {
                    success: true,
                    solicitudIds: createResult.solicitudIds,
                    ...(createResult.failedInvitados ? { failedInvitados: createResult.failedInvitados } : {}),
                }
                : {
                    success: false,
                    message: 'Hay compromisos que se solapan para uno o mas participantes.',
                    rangosOcupados: createResult.rangosOcupados,
                }
        );

        if (createResult.created && createResult.notifications) {
            solicitudesServices.sendSolicitudNotifications(newSolicitud, createResult.notifications);
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSolicitudesByUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 20;
        const type = req.query.type as string | undefined;

        const result = await solicitudesServices.getSolicitudesByUserService(userContextId, { page, pageSize }, type);
        res.status(200).json(result);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSolicitudesUnseenByUserController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const type = req.query.type as string | undefined;

        const unseenCount = await solicitudesServices.getSolicitudesUnseenByUserService(userContextId, type);
        res.status(200).json({ unseen: unseenCount });
    }
    catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const getSolicitudesBitacoraById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { solicitudId } = req.params;
        const userContextId = requireUserContextId(req);

        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const cursorParam = req.query.cursor;
        const cursor = cursorParam !== undefined ? Number(cursorParam) : undefined;

        const direction = req.query.direction === 'newer' ? 'newer' : undefined;

        const pagination: { limit: number; cursor?: number; direction?: 'newer' } = { limit };
        if (cursor !== undefined && Number.isFinite(cursor)) {
            pagination.cursor = cursor;
        }
        if (direction !== undefined) {
            pagination.direction = direction;
        }

        const result = await solicitudesServices.getSolicitudBitacoraByIdService(userContextId, Number(solicitudId), pagination);
        res.status(200).json(result);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const updateSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload: SolicitudBitacoraDTO = req.body;
        const userContextId = requireUserContextId(req);

        const updatePayload: SolicitudBitacoraDTO = {
            ...payload,
            usuario_id: userContextId,
        };

        const updateResult = await solicitudesServices.updateSolicitudService(updatePayload);

        if (!updateResult.updated) {
            return res.status(200).json({
                success: false,
                message: 'Hay compromisos que se solapan para uno o mas participantes.',
                rangosOcupados: updateResult.rangosOcupados,
            });
        }

        res.status(200).json({ success: true, message: 'Solicitud actualizada exitosamente.' });

        notifySolicitudUpdated(updatePayload.solicitud_id, userContextId, updatePayload.estado, updatePayload.observacion)
            .catch((err) => console.error('Error enviando notificacion de actualizacion:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const marcarBitacoraVistoController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const { solicitudId } = req.params;

        await solicitudesServices.marcarBitacoraVistoService(Number(solicitudId), userContextId);
        res.status(200).json({ success: true });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const cancelarSolicitudController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { solicitudId } = req.body;
        const userContextId = requireUserContextId(req);
        if (!solicitudId) {
            throw new NotFoundError('Solicitud no encontrada.');
        }

        await solicitudesServices.cancelarSolicitudService(solicitudId, userContextId);
        res.status(200).json({ success: true, message: 'Solicitud cancelada exitosamente.' });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const ocultarSolicitudInvitadoController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { solicitudId } = req.body;
        const userContextId = requireUserContextId(req);

        if (!solicitudId) {
            throw new NotFoundError('Solicitud no encontrada.');
        }

        await solicitudesServices.ocultarSolicitudDeInvitadoService(Number(solicitudId), userContextId);
        return res.status(200).json({ success: true, message: 'Solicitud ocultada de la bandeja de entrada.' });
    } catch (error: any) {
        return next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const reenviarSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { nuevosInvitadosIds, solicitudId } = req.body;
        if (!solicitudId) {
            throw new NotFoundError('Solicitud no encontrada.');
        }
        if (!nuevosInvitadosIds || !Array.isArray(nuevosInvitadosIds)) {
            throw new BadRequestError('Por favor, proporciona una lista de nuevos invitados.');
        }

        await solicitudesServices.reenviarSolicitudService(solicitudId, nuevosInvitadosIds);
        res.status(200).json({ success: true });

        if (nuevosInvitadosIds.length > 0) {
            await solicitudesServices.getSolicitudResumenService(solicitudId)
                .then((solicitudResumen) => {
                    const destinatarios = solicitudResumen
                        ? nuevosInvitadosIds.filter((id) => id !== solicitudResumen.created_by)
                        : nuevosInvitadosIds;
                    if (destinatarios.length === 0) {
                        return;
                    }
                    const solicitudTitulo = solicitudResumen?.titulo;
                    const data = {
                        type: 'nueva_solicitud',
                        solicitud_id: solicitudId,
                        domain: 'solicitudesActividades',
                        event: 'created',
                        updated_at: new Date().toISOString(),
                        entity_id: String(solicitudId),
                    };

                    emitToUsers(destinatarios, data);

                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Nuevo mensaje',
                        body: '"' + solicitudTitulo + '"' || '"' + solicitudResumen?.descripcion + '"',
                        link: 'https://interno.italoarg.com.ar/solicitud?id=' + solicitudId + '&type=recibida',
                        data,
                    });
                })
                .catch((err) => console.error('Error enviando notificacion de solicitud reenviada:', err));
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const buscarSolicitudesController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const q = req.query.q as string;
        if (!q || q.trim().length === 0) {
            throw new BadRequestError('El parámetro de búsqueda es requerido.');
        }

        const type = req.query.type as 'MANDATO' | 'CHAT' | 'REUNION' | undefined;

        const solicitudes = await solicitudesServices.buscarSolicitudesService(q.trim(), userContextId, type);
        res.status(200).json(solicitudes);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const invitadosSolicitud = async (req: any, res: Response, next: NextFunction) => {
    try {
        const action = req.query.action;
        const { id } = req.params;
        const invitados = req.body['invitados'];
        const userContextId = requireUserContextId(req);

        if (action !== 'add' && action !== 'remove') {
            throw new BadRequestError('action debe ser "add" o "remove".');
        }

        if (!Array.isArray(invitados) || invitados.length === 0) {
            throw new BadRequestError('invitados debe ser un array no vacío.');
        }

        const updated = await solicitudesServices.handleInvitadosSolicitud(
            userContextId,
            Number(id),
            invitados,
            action
        );

        res.json(updated);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getChatArchivosController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const solicitudIdRaw = req.query.solicitud_id as string | undefined;
        if (!solicitudIdRaw) {
            throw new BadRequestError('El parámetro solicitud_id es requerido.');
        }

        const solicitudId = Number(solicitudIdRaw);
        if (Number.isNaN(solicitudId) || solicitudId <= 0) {
            throw new BadRequestError('solicitud_id debe ser un número válido.');
        }

        const archivos = await solicitudesServices.getChatSolicitudArchivosService(solicitudId, userContextId);
        res.status(200).json(archivos);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const buscarBitacoraController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const solicitudIdRaw = req.query.solicitud_id as string | undefined;
        const solicitudId = solicitudIdRaw !== undefined ? Number(solicitudIdRaw) : undefined;
        if (solicitudId !== undefined && (Number.isNaN(solicitudId) || solicitudId <= 0)) {
            throw new BadRequestError('No se encontró la conversación.');
        }

        const q = (req.query.q as string | undefined)?.trim();
        if (!q && solicitudId === undefined) {
            throw new BadRequestError('No hubo resultados para la búsqueda.');
        }

        const MAX_LIMIT = 50;
        const DEFAULT_LIMIT = 20;
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string) || DEFAULT_LIMIT));
        const cursorRaw = req.query.cursor as string | undefined;
        const cursor = cursorRaw !== undefined ? Number(cursorRaw) : undefined;
        if (cursor !== undefined && (Number.isNaN(cursor) || cursor <= 0)) {
            throw new BadRequestError('El parámetro cursor debe ser un número positivo.');
        }

        const result = await solicitudesServices.buscarBitacoraService(userContextId, {
            limit,
            ...(q ? { q } : {}),
            ...(solicitudId !== undefined ? { solicitudId } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
        });
        res.status(200).json(result);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
