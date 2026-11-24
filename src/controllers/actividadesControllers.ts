import { NextFunction, Request, Response } from 'express';
import { asAppError, BadRequestError, InternalServerError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import {
    cancelarActividadService,
    actualizarHorariosActividadService,
    crearActividadService,
    getHostDeActividadService,
    getParticipantesByActividadIdService,
    getActividadesByUserService,
    getActividadDetalleByIdService,
    handleArchivosActividad,
    handleInvitadosActividad
} from '../domain/services/actividadesServices';
import { ActividadDTO } from '../domain/dto/ActividadDTO';
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';

export const crearActividadController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const newActividad: ActividadDTO = {
            ...req.body,
            fecha_inicio: new Date(req.body.fecha_inicio),
            fecha_fin: req.body.fecha_fin ? new Date(req.body.fecha_fin) : null,
        };
        const userContextId = requireUserContextId(req);
        if (!newActividad.titulo || !newActividad.fecha_inicio) {
            throw new BadRequestError('Por favor, rellena todos los campos requeridos.');
        }

        const createResult = await crearActividadService(newActividad, userContextId);

        if (!createResult.created) {
            return res.status(200).json({
                success: false,
                message: 'Hay compromisos que se solapan para uno o mas participantes.',
                rangosOcupados: createResult.rangosOcupados,
            });
        }

        const nuevaActividad = createResult.actividad;
        if (!nuevaActividad) {
            throw new InternalServerError('No se pudo crear la actividad.');
        }

        res.status(201).json({
            success: true,
            actividad: nuevaActividad,
            excludedInvitados: createResult.excludedInvitados ?? [],
        });

        if (nuevaActividad.actividad_id) {
            getParticipantesByActividadIdService(nuevaActividad.actividad_id)
                .then((participantes) => {
                    const destinatarios = participantes.filter((id) => id !== userContextId);
                    if (destinatarios.length > 0) {
                        return sendNotificationToMultipleUsers(destinatarios, {
                            title: 'Nueva Actividad',
                            body: 'Se creo la actividad "' + newActividad.titulo + '"',
                            link: 'https://interno.italoarg.com.ar/actividad-detalle?actividadId=' + nuevaActividad.actividad_id,
                            data: {
                                type: 'nueva_actividad',
                                actividad_id: nuevaActividad.actividad_id,
                                domain: 'solicitudesActividades',
                                event: 'created',
                                updated_at: new Date().toISOString(),
                                entity_id: String(nuevaActividad.actividad_id),
                            },
                        });
                    }
                })
                .catch((err) => console.error('Error enviando notificacion de nueva actividad:', err));
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const cancelarActividad = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { actividad_id } = req.body;
        const userContextId = requireUserContextId(req);
        const actividadIdNumber = Number(actividad_id);

        if (!actividad_id || Number.isNaN(actividadIdNumber)) {
            throw new NotFoundError('Actividad no encontrada.');
        }

        const hostId = await getHostDeActividadService(actividadIdNumber);
        const cancelaCreador = hostId === userContextId;
        const participantesAntes = await getParticipantesByActividadIdService(actividadIdNumber);
        const eraParticipante = participantesAntes.includes(userContextId);

        await cancelarActividadService(actividadIdNumber, userContextId);
        res.status(200).json({ success: true, message: 'Actividad cancelada exitosamente' });

        Promise.resolve()
            .then(() => {
                if (!cancelaCreador && !eraParticipante) {
                    return;
                }

                const destinatarios = participantesAntes.filter((id) => id !== userContextId);
                if (destinatarios.length > 0) {
                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: cancelaCreador ? 'Actividad Cancelada' : 'Un participante no estara en la actividad',
                        body: cancelaCreador
                            ? 'Una actividad en la que participabas fue cancelada'
                            : 'Un participante no estara en la actividad',
                        link: cancelaCreador
                            ? 'https://interno.italoarg.com.ar/agenda-personal'
                            : 'https://interno.italoarg.com.ar/actividad-detalle?actividadId=' + actividadIdNumber,
                        data: {
                            type: cancelaCreador ? 'actividad_cancelada' : 'actividad_participante_baja',
                            actividad_id: actividadIdNumber,
                            domain: 'solicitudesActividades',
                            event: 'status_changed',
                            updated_at: new Date().toISOString(),
                            entity_id: String(actividadIdNumber),
                        },
                    });
                }
            })
            .catch((err) => console.error('Error enviando notificacion de actividad cancelada:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const actualizarHorariosActividad = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actividadData: ActividadDTO = {
            ...req.body,
            fecha_inicio: new Date(req.body.fecha_inicio),
            fecha_fin: req.body.fecha_fin ? new Date(req.body.fecha_fin) : undefined,
        };
        const userContextId = requireUserContextId(req);
        if (!actividadData.actividad_id) {
            throw new NotFoundError('Actividad no encontrada.');
        }
        if (!actividadData.fecha_inicio) {
            throw new BadRequestError('Por favor, establecé la fecha de inicio.');
        }

        const updateResult = await actualizarHorariosActividadService(
            actividadData.actividad_id,
            userContextId,
            actividadData.fecha_inicio,
            actividadData.fecha_fin ?? undefined,
        );

        if (!updateResult.updated) {
            return res.status(200).json({
                success: false,
                message: 'Hay compromisos que se solapan para uno o mas participantes.',
                rangosOcupados: updateResult.rangosOcupados,
            });
        }

        if (!updateResult.actividad) {
            throw new InternalServerError('No se pudo actualizar la actividad.');
        }

        res.status(200).json({
            success: true,
            message: 'Horarios actualizados exitosamente.',
            actividad: updateResult.actividad,
        });

        getParticipantesByActividadIdService(actividadData.actividad_id)
            .then((participantes) => {
                const destinatarios = participantes.filter((id) => id !== userContextId);
                if (destinatarios.length > 0) {
                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Actividad Modificada',
                        body: 'Se modificaron los horarios de una actividad en la que participás',
                        link: 'https://interno.italoarg.com.ar/actividad-detalle?actividadId=' + actividadData.actividad_id,
                        data: {
                            type: 'actividad_horario_actualizado',
                            actividad_id: actividadData.actividad_id,
                            domain: 'solicitudesActividades',
                            event: 'updated',
                            updated_at: new Date().toISOString(),
                            entity_id: String(actividadData.actividad_id),
                        },
                    });
                }
            })
            .catch((err) => console.error('Error enviando notificacion de horarios actualizados:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getActividadesByUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const fechaInicioInput =
            (req.body?.fechaInicio as string | undefined) ??
            (req.query.fechaInicio as string | undefined);
        const fechaFinInput =
            (req.body?.fechaFin as string | undefined) ??
            (req.query.fechaFin as string | undefined);

        if (!fechaInicioInput || !fechaFinInput) {
            throw new BadRequestError('fechaInicio y fechaFin son requeridas.');
        }

        const fechaInicio = new Date(fechaInicioInput);
        const fechaFin = new Date(fechaFinInput);

        if (Number.isNaN(fechaInicio.getTime()) || Number.isNaN(fechaFin.getTime())) {
            throw new BadRequestError('Formato de fechas inválido.');
        }

        const actividades = await getActividadesByUserService(userContextId, fechaInicio, fechaFin);
        res.status(200).json(actividades);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getActividadByIdController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const actividadId = Number(req.params.actividadId);
        if (!actividadId || Number.isNaN(actividadId)) {
            throw new NotFoundError('Actividad no encontrada.');
        }

        const actividad = await getActividadDetalleByIdService(actividadId, userContextId);
        if (!actividad) {
            throw new NotFoundError('Actividad no encontrada.');
        }

        return res.status(200).json(actividad);
    } catch (error: any) {
        return next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const archivoActividad = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const archivosIds: number[] = req.body['archivosIds'];
        const userContextId = requireUserContextId(req);
        const action = req.query.action as 'add' | 'remove';

        if (!Array.isArray(archivosIds) || archivosIds.length === 0) {
            throw new BadRequestError('archivosIds debe ser un array no vacío.');
        }

        const updated = await handleArchivosActividad(userContextId, Number(id), archivosIds, action);
        res.json(updated);

        getParticipantesByActividadIdService(Number(id))
            .then((participantes) => {
                const destinatarios = participantes.filter((pid) => pid !== userContextId);
                if (destinatarios.length > 0) {
                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Actividad Modificada',
                        body: action === 'add'
                            ? 'Se agregaron archivos a una actividad en la que participás'
                            : 'Se quitaron archivos de una actividad en la que participás',
                        link: 'https://interno.italoarg.com.ar/actividad-detalle?actividadId=' + id,
                        data: {
                            type: 'actividad_archivos_actualizados',
                            actividad_id: Number(id),
                            domain: 'solicitudesActividades',
                            event: 'updated',
                            updated_at: new Date().toISOString(),
                            entity_id: String(id),
                        },
                    });
                }
            })
            .catch((err) => console.error('Error enviando notificacion de archivos actualizados:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const invitadosActividad = async (req: any, res: Response, next: NextFunction) => {
    try {
        const action = req.query.action as 'add' | 'remove';
        const { id } = req.params;
        const invitados = req.body['invitados'];
        const userContextId = requireUserContextId(req);

        if (!Array.isArray(invitados) || invitados.length === 0) {
            throw new BadRequestError('invitados debe ser un array no vacío.');
        }

        const updated = await handleInvitadosActividad(
            userContextId,
            Number(id),
            invitados,
            action
        );

        res.json(updated);

        getParticipantesByActividadIdService(Number(id))
            .then((participantes) => {
                const destinatarios = participantes.filter((pid) => pid !== userContextId);
                if (destinatarios.length > 0) {
                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Actividad Modificada',
                        body: action === 'add'
                            ? 'Se agregaron invitados a una actividad en la que participás'
                            : 'Se quitaron invitados de una actividad en la que participás',
                        link: 'https://interno.italoarg.com.ar/actividad-detalle?actividadId=' + id,
                        data: {
                            type: 'actividad_invitados_actualizados',
                            actividad_id: Number(id),
                            domain: 'solicitudesActividades',
                            event: 'updated',
                            updated_at: new Date().toISOString(),
                            entity_id: String(id),
                        },
                    });
                }
            })
            .catch((err) => console.error('Error enviando notificacion de invitados actualizados:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
