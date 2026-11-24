import { Router } from 'express';
import * as licenciasController from '../controllers/licenciasControllers';
import { auth } from '../adapters/auth/authPermisos';
import { allRoles, managementRoles, licenciaAprobadorRoles } from '../types/roles';
import { idempotency } from '../adapters/middlewares/idempotency';

const router = Router();

// Tipos de Licencia
router.get('/tipos', licenciasController.getTiposLicencia);

// Saldos
router.get('/saldos', licenciasController.getSaldosUsuario);
router.get('/saldos/:id/francos', auth(managementRoles), licenciasController.getSaldoFrancosEmpleado);
router.get('/saldos/:id/vacaciones', auth(managementRoles), licenciasController.getSaldoVacacionesEmpleado);

// Solicitudes - General
router.get('/solicitudes', auth(managementRoles), licenciasController.getSolicitudes);
router.get('/solicitudes/unseen', auth(['presidencia', 'encargado', 'gerencia']), licenciasController.getSolicitudesUnseenByUserController);
router.get('/solicitudes/unseen/mine', licenciasController.getSolicitudesPendingByUserController);
router.get('/solicitudes/usuario', licenciasController.getSolicitudesUsuario);

// Solicitudes - Usuario
router.post('/solicitudes', idempotency, licenciasController.crearSolicitud);
router.post('/solicitudes/:id/archivo', idempotency, licenciasController.adjuntarArchivo);
router.post('/solicitudes/:id/cancelar', licenciasController.cancelarSolicitud);

// Solicitudes - Aprobación (Solo Admin/Gerencia)
// Note: Assuming the router is mounted with a base auth that allows 'usuario', 
// we add specific auth middleware here to restrict to approvers.
router.post('/solicitudes/:id/aprobar', auth(licenciaAprobadorRoles), licenciasController.aprobarSolicitud);
router.post('/solicitudes/:id/rechazar', auth(licenciaAprobadorRoles), licenciasController.rechazarSolicitud);

export default router;
