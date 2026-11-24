import { Request, Response, NextFunction } from 'express';
import { fetchPedidosService, updateEstado, deletePedidoService } from '../domain/services/pedidosServices';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';

export const getPedidosController = async (req: Request, res: Response, next: NextFunction) => {
  const id_cliente = req.query.id_cliente as string;
  const estado = req.query.estado as string;
  const fecha_desde = req.query.desde as string;
  const fecha_hasta = req.query.hasta as string;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 30;

  try {
    const pedidos = await fetchPedidosService(page, limit, parseInt(id_cliente), estado, fecha_desde, fecha_hasta);
    res.json(pedidos);
  } catch (error) {
    console.error("[getPedidos] error:", error);
    next(asAppError(error, "No se pudo obtener pedidos por cliente"));
  }
};

export const changeEstadoPedido = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nro_pedido, estado } = req.body;
    if (!nro_pedido || !estado) {
      throw new BadRequestError("Número de pedido y estado son requeridos");
    }
    await updateEstado(nro_pedido, estado);
    res.json({ mensaje: "pedido cambiado con exito" });
  } catch (error) {
    next(asAppError(error, "No se pudo cambiar el estado del pedido"));
  }
};

export const deletePedidoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nro_pedido = req.params.nro_pedido as string;
    if (!nro_pedido) {
      throw new BadRequestError("Número de pedido es requerido");
    }
    await deletePedidoService(parseInt(nro_pedido));
    res.json({ mensaje: "Pedido eliminado con exito" });
  } catch (error) {
    next(asAppError(error, "Intentá de nuevo más tarde."));
  }
};
