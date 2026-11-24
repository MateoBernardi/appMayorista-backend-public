import { Request, Response, NextFunction } from 'express';
import { asAppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../adapters/errors/AppError';
import { requireUserContextId, requireUserRole } from '../utils/requestGuards';
import * as reportesService from '../domain/services/reportesServices';
import { sendNotificationToUser } from '../domain/services/devicesService';
import { managementRoles } from '../types/roles';
import { EstadoReporte } from '../domain/dto/ReporteDTO';

const FILTERABLE_ESTADOS: EstadoReporte[] = ['PENDIENTE', 'DISPUTA', 'ASENTADO'];

function parseEstadoFilter(value: unknown): EstadoReporte | undefined {
    return typeof value === 'string' && (FILTERABLE_ESTADOS as string[]).includes(value)
        ? (value as EstadoReporte)
        : undefined;
}

export const getReportesByUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const requesterContextId = requireUserContextId(req);
        const requesterRole = requireUserRole(req);

        // Param estandarizado: user_context_id. Se mantiene usuarioId por compatibilidad temporal.
        const queryContextId = req.query.user_context_id ?? req.query.usuarioId;
        const userContextId = queryContextId ? Number(queryContextId) : requesterContextId;

        if (!userContextId || Number.isNaN(userContextId)) {
            throw new UnauthorizedError('No autorizado.');
        }

        const isManagement = managementRoles.includes(requesterRole);
        const isSelf = requesterContextId === userContextId;

        if (!isManagement && !isSelf) {
            throw new ForbiddenError('Acceso denegado.');
        }

        const reportes = await reportesService.getReportesByUser(userContextId);
        res.json(reportes);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getReportesPendingByUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const requesterContextId = requireUserContextId(req);
        requireUserRole(req);

       const reportesCount = await reportesService.getReportesPendingByUser(requesterContextId);
        res.json({ pendingReportes: reportesCount });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getReportesPendingForManager = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const requesterContextId = requireUserContextId(req);

        const reportesCount = await reportesService.getReportesPendingForManager(requesterContextId);
        res.json({ pendingReportes: reportesCount });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const createReporte = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { usuario_reportado_id, titulo, descripcion, categoria, fecha_incidente } = req.body;

        const creador_id = requireUserContextId(req);

        const reporte = await reportesService.createReporte({
            usuario_reportado_id: Number(usuario_reportado_id),
            creador_id,
            titulo,
            descripcion,
            categoria,
            fecha_incidente
        });

        res.status(201).json(reporte);

        // Enviar notificación en segundo plano (fire-and-forget)
        sendNotificationToUser(Number(usuario_reportado_id), {
            title: '⚠️ Nuevo Reporte',
            body: `Se te ha generado un reporte: ${titulo || 'Sin título'}`,
            link: 'https://interno.italoarg.com.ar/mis-reportes',
            data: {
                type: 'nuevo_reporte',
                reporte_id: reporte.id,
                usuario_reportado_id: reporte.usuario_reportado_id,
                domain: 'reportes',
                event: 'created',
                updated_at: new Date().toISOString(),
                entity_id: String(reporte.id)
            },
            priority: 'high'
        }).catch(err => console.error('Error enviando notificación de nuevo reporte:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const updateReporte = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { estado, observacion } = req.body;
        const usuarioId = requireUserContextId(req);
        const userRole = requireUserRole(req);

        if (!id) {
            throw new NotFoundError('Reporte no encontrado.');
        }

        const reporte = await reportesService.updateReporte(Number(id), usuarioId, userRole, {
            estado,
            observacion
        });

        res.json(reporte);

        // Enviar notificación en segundo plano (fire-and-forget)
        if (reporte && (estado || observacion)) {
            const respondedByReportedUser = usuarioId === reporte.usuario_reportado_id;
            const observacionSnippet = typeof observacion === 'string' && observacion.trim().length > 0
                ? (observacion.trim().length > 120 ? `${observacion.trim().slice(0, 117)}...` : observacion.trim())
                : undefined;

            // Si quien actuó es el usuario reportado, hay que avisarle al creador (no al propio actor);
            // si actuó gestión, se avisa al reportado como antes.
            const recipientId = respondedByReportedUser ? reporte.creador_id : reporte.usuario_reportado_id;

            if (recipientId) {
                const title = respondedByReportedUser
                    ? (estado === 'DISPUTA' ? '⚠️ Reporte en disputa' : '↩️ Respuesta a tu reporte')
                    : '📋 Reporte Actualizado';
                const body = respondedByReportedUser
                    ? (observacionSnippet ? `Respondió: "${observacionSnippet}"` : `El empleado actualizó el reporte (estado: ${estado ?? reporte.estado}).`)
                    : (observacionSnippet ? `Estado: ${estado}. "${observacionSnippet}"` : `El estado de tu reporte cambió a: ${estado}`);

                sendNotificationToUser(recipientId, {
                    title,
                    body,
                    link: 'https://interno.italoarg.com.ar/mis-reportes',
                    data: {
                        type: 'reporte_actualizado',
                        reporte_id: Number(id),
                        usuario_reportado_id: reporte.usuario_reportado_id,
                        estado,
                        domain: 'reportes',
                        event: 'status_changed',
                        updated_at: new Date().toISOString(),
                        entity_id: String(id)
                    },
                    priority: 'high'
                }).catch(err => console.error('Error enviando notificación de reporte actualizado:', err));
            }
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getReportesRanking = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const estado = parseEstadoFilter(req.query.estado);
        const ranking = await reportesService.getReportesRanking(estado);
        res.json(ranking);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getReportesManaged = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const requesterContextId = requireUserContextId(req);
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 20;
        const estado = parseEstadoFilter(req.query.estado);
        const rol = typeof req.query.rol === 'string' && req.query.rol.trim() !== '' ? req.query.rol.trim() : undefined;

        const result = await reportesService.getReportesManaged(requesterContextId, { page, pageSize, estado, rol });
        res.json(result);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getTopEmployeeByReportes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const topEmployee = await reportesService.getTopEmployeeByReportes();
        res.json(topEmployee);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getUpgradedEmployeeByReportes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const upgradedEmployees = await reportesService.getUpgradedEmployeeByReportes();
        res.json(upgradedEmployees);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
