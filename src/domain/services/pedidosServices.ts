import { getPedidos, getPedidoByNumero, deletePedido } from "../../adapters/db/pedidosRepo";
import { updateEstadoPedido } from "../../adapters/db/pedidosRepo";
import { PedidoDTO, PedidoConPagosDTO } from '../dto/PedidoDTO';
import { PagosDTO } from "../dto/PagosDTO";
import { getClienteById } from "../../adapters/db/clientesRepo";
import { getCondicionVentaById } from "../../adapters/db/pedidosRepo";
import { validateEstadoPedido } from "../validations/pedidosValidations";
import { pedidoValidator, pagosValidator } from "../validations/pedidosValidations";
import { fetchDetallePedido } from "./detallePedidosServices";
import { NotFoundError } from "../../adapters/errors/AppError";

export const datosPedido = async (pedidoData: PedidoDTO): Promise<any[]> => {
  const cliente = await getClienteById(pedidoData.id_cliente);
  if (!cliente) {
    return [{ campo: 'id_cliente', error: 'Cliente no encontrado' }];
  }

  const condicion = await getCondicionVentaById(pedidoData.id_condicion);
  if (!condicion) {
    return [{ campo: 'id_condicion', error: 'Condición de venta no encontrada' }];
  }

  const pedidoArray = Array.isArray(pedidoData) ? pedidoData : [pedidoData];
  const errors = await pedidoValidator.validateData(pedidoArray);
  return errors;
}

const estadoPedido = async (nro_pedido: number, estado: string): Promise<void> => {
  const estadoActual = await getPedidoByNumero(nro_pedido);
  if (!estadoActual) {
    throw new NotFoundError('Pedido no encontrado');
  }
  validateEstadoPedido(estado, estadoActual);
};

export const pagoValido = async (pagoData: PagosDTO): Promise<any[]> => {
  const pagoArray = Array.isArray(pagoData) ? pagoData : [pagoData];
  const errors = await pagosValidator.validateData(pagoArray);
  return errors;
}

export const fetchPedidosService = async (page: number, limit: number, cliente_id?: number, estado?: string, fecha_desde?: string, fecha_hasta?: string): Promise<PedidoConPagosDTO[]> => {
  if (cliente_id !== undefined && isNaN(cliente_id)) {
    cliente_id = undefined;
  }

  const pedidos = await getPedidos(page, limit, cliente_id, estado, fecha_desde, fecha_hasta);
  return pedidos;
};

export const updateEstado = async (nro_pedido: number, estado: string): Promise<void> => {
  await estadoPedido(nro_pedido, estado);
  await updateEstadoPedido(nro_pedido, estado);
};

export const deletePedidoService = async (nro_pedido: number): Promise<void> => {
  const pedidoDetalle = await fetchDetallePedido(nro_pedido);
  if (!pedidoDetalle || pedidoDetalle.length === 0) {
    throw new NotFoundError('Pedido no encontrado');
  }
  await deletePedido(pedidoDetalle);
};
