import { Router } from 'express';
import {
    cancelarActividad,
    actualizarHorariosActividad,
    crearActividadController,
    getActividadesByUser,
    getActividadByIdController,
    archivoActividad,
    invitadosActividad
} from '../controllers/actividadesControllers';
import { idempotency } from '../adapters/middlewares/idempotency';

const actividadesRouter = Router();

actividadesRouter.post('/actividades/participantes', getActividadesByUser);
actividadesRouter.get('/actividades/:actividadId', getActividadByIdController);
actividadesRouter.put('/actividades/cancelar', cancelarActividad);
actividadesRouter.put('/actividades/crear', idempotency, crearActividadController);
actividadesRouter.put('/actividades/actualizar-horarios', actualizarHorariosActividad);
actividadesRouter.patch('/actividades/:id/archivos', archivoActividad);
actividadesRouter.patch('/actividades/:id/invitados', invitadosActividad);

export default actividadesRouter;
