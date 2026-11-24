import { Router } from 'express';
import { getDetallePedido, getRemitoPDF, generarFacturasTXTController, updateArticuloInPedidoController, getRemitosConsolidadosLogistica } from '../controllers/detallePedidosControllers';

const pedidoArticuloRouter = Router();

// GET routes
pedidoArticuloRouter.post('/facturas', generarFacturasTXTController);
pedidoArticuloRouter.get('/:nro_pedido', getDetallePedido);
pedidoArticuloRouter.get('/:nro_pedido/remito/:id_cliente', getRemitoPDF);
pedidoArticuloRouter.post('/logistica/pdf-consolidado', getRemitosConsolidadosLogistica);

// PATCH route
pedidoArticuloRouter.put('/:nro_pedido/:action', updateArticuloInPedidoController);

export default pedidoArticuloRouter;
