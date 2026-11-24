import { Router } from 'express';
import {
  createNovedadWebController,
  deleteNovedadWebController,
  getNovedadWebByIdController,
  listNovedadesWebController,
  updateNovedadWebController,
} from '../controllers/web/novedadesWebController';
import { idempotency } from '../adapters/middlewares/idempotency';

const novedadesWebRouter = Router();

novedadesWebRouter.get('/', listNovedadesWebController);
novedadesWebRouter.get('/:id', getNovedadWebByIdController);
novedadesWebRouter.post('/', idempotency, createNovedadWebController);
novedadesWebRouter.put('/:id', updateNovedadWebController);
novedadesWebRouter.delete('/:id', deleteNovedadWebController);

export default novedadesWebRouter;
