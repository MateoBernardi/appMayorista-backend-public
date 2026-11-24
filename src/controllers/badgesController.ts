import { Request, Response, NextFunction } from 'express';
import { requireUserContextId, requireUserRole } from '../utils/requestGuards';
import { asAppError } from '../adapters/errors/AppError';
import { managementRoles } from '../types/roles';
import * as solicitudesServices from '../domain/services/solicitudesServices';
import * as archivosServices from '../domain/services/archivosServices';
import * as licenciasServices from '../domain/services/licenciasServices';
import * as reportesServices from '../domain/services/reportesServices';

// Endpoint de agregación: junta los contadores "sin ver / pendientes" de cada
// módulo en una sola respuesta para que el cliente haga un solo request en
// vez de cuatro. No es un JOIN — cada módulo tiene su propia noción de
// "pendiente" (lectura real vs. estado no-final) sobre tablas no relacionadas,
// así que esto es un fan-out en paralelo con aislamiento de errores por
// módulo: si uno falla, los demás igual se devuelven.
async function settle<T>(promise: Promise<T>): Promise<{ value: T | null; error?: string }> {
    try {
        return { value: await promise };
    } catch (error: any) {
        return { value: null, error: error?.message || 'Error desconocido' };
    }
}

export const getPrefetchBadges = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const userRole = requireUserRole(req);
        const isManagement = managementRoles.includes(userRole);

        // `solicitudes` excluye los chats (mismo criterio que GET /solicitudes/unseen sin `type`);
        // `chats` es GET /solicitudes/unseen?type=CHAT. El cliente los muestra en sub-tabs distintas.
        const [solicitudes, chats, documentos, licenciasMine, licenciasManaged, reportesMine, reportesManaged] = await Promise.all([
            settle(solicitudesServices.getSolicitudesUnseenByUserService(userContextId)),
            settle(solicitudesServices.getSolicitudesUnseenByUserService(userContextId, 'CHAT')),
            settle(archivosServices.fetchArchivosUnseenByUserService(userContextId, userRole)),
            settle(licenciasServices.getSolicitudesPendingByUser(userContextId)),
            isManagement ? settle(licenciasServices.getSolicitudesUnseenByUser(userContextId)) : Promise.resolve<{ value: number | null; error?: string }>({ value: null }),
            settle(reportesServices.getReportesPendingByUser(userContextId)),
            isManagement ? settle(reportesServices.getReportesPendingForManager(userContextId)) : Promise.resolve<{ value: number | null; error?: string }>({ value: null }),
        ]);

        const errors = [solicitudes, chats, documentos, licenciasMine, licenciasManaged, reportesMine, reportesManaged]
            .map((r) => r.error)
            .filter((e): e is string => !!e);

        res.json({
            solicitudes: solicitudes.value,
            chats: chats.value,
            documentos: documentos.value,
            licencias: { mine: licenciasMine.value, managed: licenciasManaged.value },
            reportes: { mine: reportesMine.value, managed: reportesManaged.value },
            errors,
        });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
