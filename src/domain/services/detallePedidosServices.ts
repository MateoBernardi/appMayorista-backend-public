import { getStockEfectivo } from "../../adapters/db/articulosEfectivoRepo";
import { addArticuloToPedido, getDetallePedido, removeArticuloFromPedido, upsertArticuloInPedido } from "../../adapters/db/detallePedidosRepo";
import { validarArticuloExiste, validarEstadoPedido, validarPrecioMinimo, validarStock, validarFraccion } from "../validations/detallePedidosValidations";
import { ArticuloDTO } from "../dto/ArticuloDTO";
import { Pedido_ArticuloDTO } from "../dto/DetallePedidosDTO";
import { detallePedidoValidator } from "../validations/detallePedidosValidations";
import { BadRequestError, NotFoundError } from "../../adapters/errors/AppError";


/**
 * Valida y arma el arreglo de artículos para un pedido
 * Lanza error si algún artículo no cumple las validaciones
 */
export const validarArticulosParaPedido = async (articulos: any[]) => {
  for (const articuloPedido of articulos) {
    const errores = detallePedidoValidator.validateData(articuloPedido);
    if (errores.length > 0) {
      throw new BadRequestError('Dato inválido en campo: ' + JSON.stringify(errores));
    }

    const { codigo_articulo, cantidad, precio_venta } = articuloPedido;

    const resultadoBusqueda = await import('../../adapters/db/articulosRepo').then(m => m.getArticulosBySearch(String(codigo_articulo), 'M', 'codigo_articulo'));
    const articulosEncontrados = resultadoBusqueda.articulos;

    if (!articulosEncontrados || articulosEncontrados.length === 0) {
      throw new NotFoundError(`Artículo con código ${codigo_articulo} no encontrado`);
    }

    validarArticuloExiste(articulosEncontrados);
    const articulo: ArticuloDTO = articulosEncontrados[0]!;

    validarFraccion(articulo, cantidad);

    const stockData = await getStockEfectivo(codigo_articulo);
    validarStock(stockData, cantidad, articulo.en_oferta);

    validarPrecioMinimo(articulo, precio_venta);
  }
  return articulos;
};

export const updateArticuloInPedidoService = async (nro_pedido: number, articulo: any, action: string) => {
  switch (action) {
    case 'add':
      if(await validarArticulosParaPedido([articulo]))
        await addArticuloToPedido(nro_pedido, articulo);
      break;
    case 'remove':
      await removeArticuloFromPedido(nro_pedido, articulo);
      break;
    case 'update':
      if(await validarArticulosParaPedido([articulo]))
        await upsertArticuloInPedido(nro_pedido, articulo);
      break;
    default:
      throw new BadRequestError('Acción no válida');
  }
};


export const fetchDetallePedido = async (nro_pedido: number): Promise<Pedido_ArticuloDTO[] | null> => {
  const result = await getDetallePedido(nro_pedido);
  return result.detalle;
};
