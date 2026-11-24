import { Router } from 'express';
import {
  actualizarOfertaController,
  crearOfertaController,
  desactivarOfertaController,
  listarOfertasController,
} from '../controllers/articulosOfertasController';

const articulosOfertasRouter = Router();

articulosOfertasRouter.post('/', crearOfertaController);
articulosOfertasRouter.get('/', listarOfertasController);
articulosOfertasRouter.put('/:oferta_id', actualizarOfertaController);
articulosOfertasRouter.delete('/:oferta_id', desactivarOfertaController);

export default articulosOfertasRouter;
