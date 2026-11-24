import { Router } from 'express';
import { getNovedadesController, createNovedadController, deleteNovedadController, updateNovedadController } from '../controllers/novedadesController';
import { auth } from '../adapters/auth/authPermisos';
import { idempotency } from '../adapters/middlewares/idempotency';

const novedadesRouter = Router();

novedadesRouter.get('/', getNovedadesController);
novedadesRouter.post('/', auth(['encargado', 'gerencia', 'presidencia', 'personasRelaciones']), idempotency, createNovedadController);
novedadesRouter.delete('/:id', auth(['encargado', 'gerencia', 'presidencia', 'personasRelaciones']), deleteNovedadController);
novedadesRouter.put('/:id', auth(['encargado', 'gerencia', 'presidencia', 'personasRelaciones']), updateNovedadController);

export default novedadesRouter;
