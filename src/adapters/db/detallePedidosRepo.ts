import { pool } from './pgClient';

export const getDetallePedido = async (nro_pedido: number, client?: any) => {
  const db = client || pool;
  const query = `
    SELECT 
      pa.nro_pedido,
      pa.codigo_articulo,     
      a.descripcion AS articulo,
      pa.cantidad,
      pa.precio_unitario,
      (pa.cantidad * pa.precio_unitario) AS monto_total,
      p.fecha,
      cv.descripcion AS condicion_venta,
      pg.medio_pago
    FROM pedido_articulo pa
    JOIN articulos a ON pa.codigo_articulo = a.codigo_articulo
    JOIN pedidos p ON pa.nro_pedido = p.nro_pedido
    JOIN condiciones_venta cv ON p.id_condicion = cv.id_condicion
    LEFT JOIN pagos pg ON pa.nro_pedido = pg.nro_pedido AND pg.deleted_at IS NULL
    WHERE pa.nro_pedido = $1 AND pa.deleted_at IS NULL
    ORDER BY pa.id;
  `;
  const { rows } = await db.query(query, [nro_pedido]);
  // Calcular el monto total del pedido sumando los subtotales
  const monto_total_pedido: number = rows.reduce((acc: number, item: any) => acc + Number(item.monto_total), 0);
  // Agregar total_pedido a cada ítem del detalle
  const detalle = rows.map((item: any) => ({ ...item, total_pedido: monto_total_pedido }));
  return { detalle, monto_total_pedido };
}

export const upsertArticuloInPedido = async (idPedido: number, articulo: any, client?: any) => {
  const db = client || pool;
  const query = `
    INSERT INTO pedido_articulo (nro_pedido, codigo_articulo, cantidad, precio_unitario, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
  `;
  const { rows } = await db.query(query, [idPedido, articulo.codigo_articulo, articulo.cantidad, articulo.precio_unitario]);
  return rows[0];
};

export const addArticuloToPedido = async (nro_pedido: number, articulo: any) => {
  const db = pool;
  const query = `
    INSERT INTO pedido_articulo (nro_pedido, codigo_articulo, cantidad, precio_unitario, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
  `;
  const { rows } = await db.query(query, [nro_pedido, articulo.codigo_articulo, articulo.cantidad, articulo.precio_unitario]);
  return rows[0];
}

export const removeArticuloFromPedido = async (idPedido: number, articulo: any, client?: any) => {
  const db = client || pool;
  const query = `
    DELETE FROM pedido_articulo
    WHERE nro_pedido = $1 AND codigo_articulo = $2
    RETURNING *;
  `;
  const { rows } = await db.query(query, [idPedido, articulo.codigo_articulo]);
  return rows[0];
}

export const crearPago = async (pagoData: any, client?: any) => {
  const db = client;
  const { rows } = await db.query(
    'INSERT INTO pagos (nro_pedido, medio_pago, monto, estado_pago) VALUES ($1, $2, $3, $4) RETURNING *',
    [pagoData.nro_pedido, pagoData.medio_pago, pagoData.monto, pagoData.estado_pago]
  );
  return rows[0];
}
