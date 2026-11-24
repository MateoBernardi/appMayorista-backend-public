import { NextFunction, Request, Response } from 'express';
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import * as licenciasService from '../domain/services/licenciasServices';
import { CreateSolicitudDTO, AprobarSolicitudDTO, RechazarSolicitudDTO, SolicitudFilterDTO, EstadoSolicitud } from '../domain/dto/LicenciaDTO';
import { sendNotificationToMultipleUsers, sendNotificationToUser } from '../domain/services/devicesService';
import { emitToUser, emitToUsers } from '../adapters/realtime/socketServer';

export const getTiposLicencia = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tipos = await licenciasService.getTiposLicencia();
        res.json(tipos);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSaldosUsuario = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const saldos = await licenciasService.getSaldosUsuario(userContextId);
        res.json(saldos);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

const parseEmpleadoId = (req: Request): number => {
    requireUserContextId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new BadRequestError('El id del empleado es inválido.');
    }
    return id;
};

export const getSaldoFrancosEmpleado = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseEmpleadoId(req);
        res.status(200).json(await licenciasService.getSaldoFrancosEmpleado(id));
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSaldoVacacionesEmpleado = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseEmpleadoId(req);
        res.status(200).json(await licenciasService.getSaldoVacacionesEmpleado(id));
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSolicitudes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const getQueryValue = (value: unknown): string | undefined => {
            if (Array.isArray(value)) {
                return typeof value[0] === 'string' ? value[0] : undefined;
            }
            return typeof value === 'string' ? value : undefined;
        };

        const usuarioIdParam = getQueryValue(req.query.usuario_id);
        const excludeUsuarioIdParam = getQueryValue(req.query.exclude_usuario_id);
        const estadoParam = getQueryValue(req.query.estado);
        const tipoLicenciaIdParam = getQueryValue(req.query.tipo_licencia_id);
        const fechaDesdeParam = getQueryValue(req.query.fecha_desde);
        const fechaHastaParam = getQueryValue(req.query.fecha_hasta);

        let usuarioId: number | undefined;
        if (usuarioIdParam) {
            const parsed = Number(usuarioIdParam);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new BadRequestError('usuario_id inválido.');
            }
            usuarioId = parsed;
        }

        let excludeUsuarioId: number | undefined;
        if (excludeUsuarioIdParam) {
            const parsed = Number(excludeUsuarioIdParam);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new BadRequestError('exclude_usuario_id inválido.');
            }
            excludeUsuarioId = parsed;
        }

        let tipoLicenciaId: number | undefined;
        if (tipoLicenciaIdParam) {
            const parsed = Number(tipoLicenciaIdParam);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new BadRequestError('tipo_licencia_id inválido.');
            }
            tipoLicenciaId = parsed;
        }

        let estado: EstadoSolicitud | undefined;
        if (estadoParam) {
            if (!Object.values(EstadoSolicitud).includes(estadoParam as EstadoSolicitud)) {
                throw new BadRequestError('estado inválido.');
            }
            estado = estadoParam as EstadoSolicitud;
        }

        let fechaDesde: Date | undefined;
        if (fechaDesdeParam) {
            const parsed = new Date(fechaDesdeParam);
            if (Number.isNaN(parsed.getTime())) {
                throw new BadRequestError('fecha_desde inválida.');
            }
            fechaDesde = parsed;
        }

        let fechaHasta: Date | undefined;
        if (fechaHastaParam) {
            const parsed = new Date(fechaHastaParam);
            if (Number.isNaN(parsed.getTime())) {
                throw new BadRequestError('fecha_hasta inválida.');
            }
            fechaHasta = parsed;
        }

        const data: SolicitudFilterDTO = {};
        if (usuarioId !== undefined) data.usuario_id = usuarioId;
        if (excludeUsuarioId !== undefined) data.exclude_usuario_id = excludeUsuarioId;
        if (estado !== undefined) data.estado = estado;
        if (tipoLicenciaId !== undefined) data.tipo_licencia_id = tipoLicenciaId;
        if (fechaDesde !== undefined) data.fecha_desde = fechaDesde;
        if (fechaHasta !== undefined) data.fecha_hasta = fechaHasta;

        const solicitudes = await licenciasService.getSolicitudes(data, userContextId);
        res.json(solicitudes);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSolicitudesUsuario = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const solicitudes = await licenciasService.getSolicitudesUsuario(userContextId);
        res.json(solicitudes);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSolicitudesUnseenByUserController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const unseenCount = await licenciasService.getSolicitudesUnseenByUser(userContextId);
        res.json({ unseenCount });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const getSolicitudesPendingByUserController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const pendingCount = await licenciasService.getSolicitudesPendingByUser(userContextId);
        res.json({ pendingCount });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const crearSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const { tipo_licencia_id, fecha_inicio, cantidad_dias, cantidad_horas, observacion, archivosIds } = req.body;

        if (!tipo_licencia_id || !fecha_inicio) {
            throw new BadRequestError('Seleccione tipo de licencia y fecha de inicio.');
        }

        if (typeof fecha_inicio !== 'string' || fecha_inicio.trim().length === 0) {
            throw new BadRequestError('La fecha de inicio es obligatoria.');
        }

        if (cantidad_dias == null && cantidad_horas == null) {
            throw new BadRequestError('Debe indicar la cantidad de días o la cantidad de horas.');
        }

        if (cantidad_dias != null && cantidad_horas != null) {
            throw new BadRequestError('Debe indicar solo la cantidad de días o la cantidad de horas, no ambos.');
        }

        if (cantidad_dias != null && (typeof cantidad_dias !== 'number' || cantidad_dias <= 0)) {
            throw new BadRequestError('La cantidad de días debe ser un número positivo.');
        }

        if (cantidad_horas != null && (typeof cantidad_horas !== 'number' || cantidad_horas <= 0)) {
            throw new BadRequestError('La cantidad de horas debe ser un número positivo.');
        }

        const data: CreateSolicitudDTO = {
            tipo_licencia_id,
            fecha_inicio: new Date(fecha_inicio),
            cantidad_dias: cantidad_dias ?? undefined,
            cantidad_horas: cantidad_horas ?? undefined,
            observacion: observacion ?? undefined,
            archivosIds: archivosIds ?? undefined
        };

        const solicitud = await licenciasService.crearSolicitud(userContextId, data);
        res.status(201).json(solicitud);

        Promise.resolve()
            .then(async () => {
                const destinatarios = await licenciasService.getDestinatariosNotificacionNuevaLicencia(
                    userContextId,
                    req.user?.role
                );

                if (destinatarios.length === 0) {
                    return;
                }

                const data = {
                    type: 'licencia_solicitud_creada',
                    solicitud_id: solicitud.id,
                    domain: 'licencias',
                    event: 'created',
                    updated_at: new Date().toISOString(),
                    entity_id: String(solicitud.id)
                };

                emitToUsers(destinatarios, data);

                return sendNotificationToMultipleUsers(destinatarios, {
                    title: '📝 Nueva Solicitud de Licencia',
                    body: 'Se creó una nueva solicitud de licencia pendiente de revisión.',
                    link: 'https://interno.italoarg.com.ar/solicitud-licencia?id=' + solicitud.id + '&type=recibida',
                    data,
                    priority: 'high'
                });
            })
            .catch((notifError) => {
                console.error('Error enviando notificación de nueva licencia:', notifError);
            });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const adjuntarArchivo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const solicitudId = parseInt(req.params.id as string || '0');
        const archivoId = req.body.archivo_id;

        if (!archivoId) {
            throw new NotFoundError('Archivo no encontrado.');
        }
        if (isNaN(solicitudId) || solicitudId === 0) {
            throw new NotFoundError('Solicitud no encontrada.');
        }

        await licenciasService.adjuntarArchivo(solicitudId, userContextId, archivoId, req.user?.role);
        res.json({ message: 'Archivo adjuntado correctamente.' });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const cancelarSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const solicitudId = parseInt(req.params.id as string || '0');
        if (isNaN(solicitudId) || solicitudId === 0) {
            throw new NotFoundError('Solicitud no encontrada.');
        }

        await licenciasService.cancelarSolicitud(solicitudId, userContextId);

        res.json({ message: 'Solicitud cancelada correctamente.' });

        Promise.resolve()
            .then(async () => {
                const destinatarios = await licenciasService.getDestinatariosNotificacionNuevaLicencia(
                    userContextId,
                    req.user?.role
                );

                if (destinatarios.length === 0) {
                    return;
                }

                const data = {
                    type: 'licencia_solicitud_cancelada',
                    solicitud_id: solicitudId,
                    domain: 'licencias',
                    event: 'status_changed',
                    updated_at: new Date().toISOString(),
                    entity_id: String(solicitudId)
                };

                emitToUsers(destinatarios, data);

                return sendNotificationToMultipleUsers(destinatarios, {
                    title: '🚫 Solicitud de Licencia Cancelada',
                    body: 'Una solicitud de licencia fue cancelada por el empleado.',
                    link: 'https://interno.italoarg.com.ar/solicitud-licencia?id=' + solicitudId + '&type=recibida',
                    data,
                    priority: 'high'
                });
            })
            .catch((notifError) => {
                console.error('Error enviando notificación de cancelación de licencia:', notifError);
            });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const aprobarSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const aprobadorId = (req as any).user.userContextId;
        const solicitudId = parseInt(req.params.id as string || '0');

        if (isNaN(solicitudId) || solicitudId === 0) {
            throw new NotFoundError('Solicitud no encontrada.');
        }

        const data: AprobarSolicitudDTO = {
            solicitud_id: solicitudId,
            aprobador_id: aprobadorId,
            observacion: req.body.observacion,
        };

        await licenciasService.aprobarSolicitud(data);

        // Enviar notificación al creador de la solicitud
        try {
            const usuarioId = await licenciasService.getUsuarioIdDeSolicitud(solicitudId);

            if (usuarioId) {
                const data = {
                    type: 'licencia_aprobada',
                    solicitudId,
                    domain: 'licencias',
                    event: 'status_changed',
                    updated_at: new Date().toISOString(),
                    entity_id: String(solicitudId)
                };

                emitToUser(usuarioId, data);

                await sendNotificationToUser(usuarioId, {
                    title: '✅ Licencia Aprobada',
                    body: 'Tu solicitud de licencia ha sido aprobada.',
                    link: 'https://interno.italoarg.com.ar/solicitud-licencia?id=' + solicitudId + '&type=enviada',
                    data,
                    priority: 'high'
                });
            }
        } catch (notifError) {
            console.error('Error enviando notificación:', notifError);
        }

        res.json({ message: 'Solicitud aprobada correctamente.' });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const rechazarSolicitud = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const aprobadorId = (req as any).user.userContextId; // Changed from .id to .userId
        const solicitudId = parseInt(req.params.id as string || '0');
        const data: RechazarSolicitudDTO = {
            solicitud_id: solicitudId,
            aprobador_id: aprobadorId,
            observacion: req.body.observacion
        };
        await licenciasService.rechazarSolicitud(data);

        // Enviar notificación al creador de la solicitud
        try {
            const usuarioId = await licenciasService.getUsuarioIdDeSolicitud(solicitudId);

            if (usuarioId) {
                const data = {
                    type: 'licencia_rechazada',
                    solicitud_id: solicitudId,
                    domain: 'licencias',
                    event: 'status_changed',
                    updated_at: new Date().toISOString(),
                    entity_id: String(solicitudId)
                };

                emitToUser(usuarioId, data);

                await sendNotificationToUser(usuarioId, {
                    title: '❌ Licencia Rechazada',
                    body: `Tu solicitud de licencia ha sido rechazada${req.body.observacion ? ': ' + req.body.observacion : ''}.`,
                    link: 'https://interno.italoarg.com.ar/solicitud-licencia?id=' + solicitudId + '&type=enviada',
                    data,
                    priority: 'high'
                });
            }
        } catch (notifError) {
            console.error('Error enviando notificación:', notifError);
        }

        res.json({ message: 'Solicitud rechazada correctamente' });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
