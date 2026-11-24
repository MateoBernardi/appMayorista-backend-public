import { Router } from 'express';
import { idempotency } from '../adapters/middlewares/idempotency';
import { auth } from '../adapters/auth/authPermisos';
import { managementRoles } from '../types/roles';
import {
  agregarAdjuntoController,
  agregarEntradaController,
  crearInformeController,
  editarEntradaController,
  getInformeController,
  listInformesController,
  listInformesEmpleadoController,
  listarVistosEntradaController,
  marcarInformeVistoController,
  quitarAdjuntoController,
  uploadAdjuntoMiddleware,
  urlAdjuntoController,
} from '../controllers/informesControllers';

// La autenticación (allRoles, sin kiosco) se aplica al montar el router en app.ts.
const informesRouter = Router();

informesRouter.get('/', listInformesController);
informesRouter.get('/empleado/:empleadoId', auth(managementRoles), listInformesEmpleadoController);
informesRouter.post('/', idempotency, crearInformeController);
informesRouter.get('/:id/entradas', getInformeController);
informesRouter.put('/:id/visto', marcarInformeVistoController);
informesRouter.get('/:id/entradas/:entradaId/vistos', listarVistosEntradaController);
informesRouter.post('/:id/entradas', idempotency, agregarEntradaController);
informesRouter.patch('/:id/entradas/:entradaId', editarEntradaController);
informesRouter.post(
  '/:id/entradas/:entradaId/adjuntos',
  idempotency,
  uploadAdjuntoMiddleware,
  agregarAdjuntoController,
);
informesRouter.delete('/:id/entradas/:entradaId/adjuntos/:adjuntoId', quitarAdjuntoController);
informesRouter.get('/:id/adjuntos/:adjuntoId', urlAdjuntoController);

export default informesRouter;
