import { Router } from 'express';
import {
    createSolicitud,
    reenviarSolicitud,
    cancelarSolicitudController,
    ocultarSolicitudInvitadoController,
    getSolicitudesBitacoraById,
    updateSolicitud,
    invitadosSolicitud,
    buscarSolicitudesController,
    getChatArchivosController,
    buscarBitacoraController,
    getSolicitudesUnseenByUserController,
    getSolicitudesByUser,
    marcarBitacoraVistoController
} from '../controllers/solicitudesControllers';
import { idempotency } from '../adapters/middlewares/idempotency';

const solicitudesRouter = Router();

solicitudesRouter.post('/solicitudes', idempotency, createSolicitud);
solicitudesRouter.get('/solicitudes/unseen', getSolicitudesUnseenByUserController);
solicitudesRouter.get('/solicitudes/buscar', buscarSolicitudesController);
solicitudesRouter.get('/solicitudes/chat/archivos', getChatArchivosController);
solicitudesRouter.put('/solicitudes/update', idempotency, updateSolicitud);
solicitudesRouter.post('/solicitudes/:solicitudId/visto', marcarBitacoraVistoController);
solicitudesRouter.post('/solicitudes/reenviar', idempotency, reenviarSolicitud);
solicitudesRouter.post('/solicitudes/cancelar', cancelarSolicitudController);
solicitudesRouter.post('/solicitudes/ocultar-invitado', ocultarSolicitudInvitadoController);
solicitudesRouter.get('/solicitudes/bitacora/buscar', buscarBitacoraController);
solicitudesRouter.get('/solicitudes/bitacora/:solicitudId', getSolicitudesBitacoraById);
solicitudesRouter.get('/solicitudes/', getSolicitudesByUser);
solicitudesRouter.patch('/solicitudes/:id/invitados', invitadosSolicitud);

export default solicitudesRouter;
