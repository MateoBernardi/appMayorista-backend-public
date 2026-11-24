import { Router } from 'express';
import { auth } from '../adapters/auth/authPermisos';
import { idempotency } from '../adapters/middlewares/idempotency';
import { getShiftsController, getShiftsByUserController, updateShiftController, scanController, getSedesController, getExtraHorasController, liquidarHorasController, getMovimientosController, aceptarTurnoController, getFeriadosController, getHorasSemanalesController, getSaldosVacacionesController, getHorasSemanaProyeccionController, kioskSecretController, marcarFeriadoDiaController, getScanHistoryController, createShiftController } from '../controllers/horariosControllers';
import { previsualizarPlanificacionController, confirmarPlanificacionController, getInfoPlanificacionController } from '../controllers/planificacionControllers';
import { allRoles, kioskRoles } from '../types/roles';

const horariosRouter = Router();

horariosRouter.get('/', auth(['gerencia', 'encargado']), getShiftsController);
horariosRouter.get('/feriados', auth(['gerencia', 'encargado', 'estudio-contable']), getFeriadosController);
horariosRouter.get('/vacaciones', auth(['gerencia', 'encargado']), getSaldosVacacionesController);
horariosRouter.get('/sedes', auth([...allRoles, ...kioskRoles]), getSedesController);
horariosRouter.get('/user', auth(allRoles), getShiftsByUserController);
horariosRouter.get('/:id/scans', auth(['gerencia', 'encargado']), getScanHistoryController);
horariosRouter.get('/planificacion/info', auth(['gerencia', 'encargado']), getInfoPlanificacionController);
horariosRouter.post('/planificacion/preview', auth(['gerencia', 'encargado']), previsualizarPlanificacionController);
horariosRouter.post('/planificacion/confirmar', auth(['gerencia', 'encargado']), idempotency, confirmarPlanificacionController);
horariosRouter.post('/turno', auth(['gerencia', 'encargado']), createShiftController);
horariosRouter.patch('/update-shift', auth(['gerencia', 'encargado']), updateShiftController);
horariosRouter.patch('/dia/feriado', auth(['gerencia', 'encargado']), marcarFeriadoDiaController);
horariosRouter.put('/scan', auth(allRoles), idempotency, scanController);
horariosRouter.get('/extra', auth(['gerencia', 'encargado', 'estudio-contable']), getExtraHorasController);
horariosRouter.post('/liquidar/:id', auth(['gerencia', 'encargado', 'estudio-contable']), liquidarHorasController);
horariosRouter.get('/movimientos', auth(['gerencia', 'encargado', 'estudio-contable']), getMovimientosController);
horariosRouter.get('/objetivos/semanal', auth(['gerencia', 'encargado', 'estudio-contable']), getHorasSemanalesController);
// Mismos roles que ven "Horas cumplidas" en la app.
horariosRouter.get('/semana/proyeccion', auth(['gerencia', 'encargado', 'personasRelaciones', 'contable', 'estudio-contable']), getHorasSemanaProyeccionController);
horariosRouter.post('/aceptar', auth(allRoles), aceptarTurnoController);
horariosRouter.get('/kiosk-secret', auth(kioskRoles), kioskSecretController);

export default horariosRouter;
