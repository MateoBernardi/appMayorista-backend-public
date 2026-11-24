import { crearPedidoTransaccional } from "../../adapters/db/crearPedidoRepo";
import { validarArticulosParaPedido } from "./detallePedidosServices";
import { PedidoDTO } from "../dto/PedidoDTO";
import { PagosDTO } from "../dto/PagosDTO";
import { Pedido_ArticuloDTO } from "../dto/DetallePedidosDTO";
import { datosPedido, pagoValido } from "./pedidosServices";
import { getDetallePedido } from "../../adapters/db/detallePedidosRepo";
import { sendRemitoMail } from "../../adapters/comunications/sendMail";
import { BadRequestError, NotFoundError } from "../../adapters/errors/AppError";

import {
  ClienteInfo,
  RemitoInfo,
  generarComprobantesPDF,
  formatearFechaRemito,
  PedidoInput
} from "../../adapters/inputs_outputs/generarRemito";

export const fetchCreatePedido = async (
  pedidoData: PedidoDTO,
  articulosPedido: Pedido_ArticuloDTO[],
  pagoData: PagosDTO
) => {
  if (!datosPedido(pedidoData)) {
    throw new BadRequestError(`Campo ${datosPedido(pedidoData)} inválido`);
  }

  if (!Array.isArray(articulosPedido)) {
    throw new BadRequestError('articulosPedido debe ser un array');
  }
  await validarArticulosParaPedido(articulosPedido);

  if (!pagoValido(pagoData)) {
    throw new BadRequestError(`Campo ${pagoValido(pagoData)} inválido`);
  }

  return await crearPedidoTransaccional(pedidoData, articulosPedido, pagoData);
};

export const enviarRemitoCorreoService = async (nro_pedido: number, clienteInfo: ClienteInfo) => {
  if (nro_pedido === undefined || nro_pedido === null || isNaN(nro_pedido)) {
    throw new BadRequestError('Nro de pedido inválido');
  }

  const { detalle } = await getDetallePedido(nro_pedido);
  if (!detalle || detalle.length === 0) {
    throw new NotFoundError('No se encontraron detalles para ese pedido');
  }

  const pedidoInput: PedidoInput = {
    cliente: clienteInfo,
    remito: generateRemitoInfo(nro_pedido, detalle[0].fecha),
    detalle
  };

  const remito = generarComprobantesPDF([pedidoInput]);

  await sendRemitoMail(clienteInfo.email, 'Remito - Italo Argentina', remito);

  return remito;
};

function generateRemitoInfo(nro_pedido: number, fecha?: Date | string): RemitoInfo {
  return {
    numero: nro_pedido.toString(),
    fecha: formatearFechaRemito(fecha),
  };
}