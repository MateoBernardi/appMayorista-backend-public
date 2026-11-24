import { Router } from 'express';
import { crearPedidoController, enviarRemitoController } from '../controllers/crearPedidoController';
import { idempotency } from '../adapters/middlewares/idempotency';

const pedidoFacturaRouter = Router();

// POST route
pedidoFacturaRouter.post('/', idempotency, crearPedidoController);
pedidoFacturaRouter.post('/remito', enviarRemitoController);

export default pedidoFacturaRouter;