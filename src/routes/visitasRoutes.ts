import { Router } from 'express';
import {
  createVisitaController,
  getVisitasController,
  updateVisitaController,
  deleteVisitaController,
} from '../controllers/visitasControllers';

const visitasRouter = Router();

visitasRouter.post('/', createVisitaController);
visitasRouter.get('/cliente/:id_cliente', getVisitasController);
visitasRouter.patch('/:id_visita', updateVisitaController);
visitasRouter.delete('/:id_visita', deleteVisitaController);

export default visitasRouter;
