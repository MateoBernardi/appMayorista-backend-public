import { pool } from './pgClient';
import { createPedido } from './pedidosRepo';
import { decrementarStockEfectivo } from './articulosEfectivoRepo';
import { getDetallePedido, upsertArticuloInPedido, removeArticuloFromPedido } from './detallePedidosRepo';
import { crearPago } from './detallePedidosRepo';

export const crearPedidoTransaccional = async (
  pedidoData: any,
  articulosPedido: any[],
  pagoData: any
) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedido = await createPedido(pedidoData, client);
    const nro_pedido = pedido.nro_pedido;
    
    if (!nro_pedido) {
      throw new Error('No se pudo crear el pedido: nro_pedido no disponible');
    }
    
    for (const articulo of articulosPedido) {
        if (articulo.cantidad === 0) {
          await removeArticuloFromPedido(nro_pedido, articulo, client);
        } else {
          await decrementarStockEfectivo(articulo.codigo_articulo, articulo.cantidad, client);
          await upsertArticuloInPedido(nro_pedido, articulo, client);
        }
    }
    const detalle = await getDetallePedido(nro_pedido, client);
    const pago = armarPago(pedido, detalle, pagoData);
    const pagoResult = await crearPago(pago, client);
    await client.query('COMMIT');
    return { pedido, detalle, pagoResult };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function armarPago(pedido: any, detalle: any, pagoData: any) {
  return {
    nro_pedido: pedido.nro_pedido,
    monto: detalle.monto_total_pedido,
    medio_pago: pagoData.medio_pago,
    referencia: pagoData.referencia,
    estado_pago: pagoData.estado_pago
  };
}
