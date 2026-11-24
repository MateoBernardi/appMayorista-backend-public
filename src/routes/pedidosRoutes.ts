import { Router } from "express";
import { getPedidosController } from "../controllers/pedidosControllers";
import { changeEstadoPedido, deletePedidoController } from "../controllers/pedidosControllers";

const pedidosRouter = Router();

// GET routes
pedidosRouter.get("/", getPedidosController);

// PUT routes
pedidosRouter.put("/change/estado", changeEstadoPedido);
pedidosRouter.put("/:nro_pedido", deletePedidoController);

export default pedidosRouter;
