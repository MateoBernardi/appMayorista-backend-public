import { Router } from 'express';
import * as reportesController from '../controllers/reportesControllers';
import { auth } from '../adapters/auth/authPermisos';
import { idempotency } from '../adapters/middlewares/idempotency';
import { managementRoles, supervisorRoles } from '../types/roles';

const router = Router();

// Rutas protegidas para roles de gestión
router.get('/stats', auth(managementRoles), reportesController.getReportesRanking);
router.get('/top-employee', auth(managementRoles), reportesController.getTopEmployeeByReportes);
router.get('/upgraded-employee', auth(managementRoles), reportesController.getUpgradedEmployeeByReportes);
router.get('/managed', auth(managementRoles), reportesController.getReportesManaged);

// Ruta para crear reportes, accesible solo para supervisores y roles superiores
router.post('/', auth(supervisorRoles), idempotency, reportesController.createReporte);

// Rutas disponibles para todos los roles autenticados
router.get('/', reportesController.getReportesByUser);
router.get('/pending', reportesController.getReportesPendingByUser);
router.get('/pending/managed', auth(managementRoles), reportesController.getReportesPendingForManager);
router.put('/:id', reportesController.updateReporte);

export default router;
