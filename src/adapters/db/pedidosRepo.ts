import { Pedido_ArticuloDTO } from '../../domain/dto/DetallePedidosDTO';
import { PedidoDTO, PedidoConClienteDTO, PedidoConPagosDTO } from '../../domain/dto/PedidoDTO';
import { pool } from '../db/pgClient';
import { decrementarStockEfectivo } from './articulosEfectivoRepo';

export const getPedidos = async (page: number, limit: number, cliente_id?: number, estado?: string, fecha_desde?: string, fecha_hasta?: string): Promise<PedidoConPagosDTO[]> => {
  const offset = (page - 1) * limit;
  const { clause, values: filterValues, nextIndex } = buildPedidosFilter(cliente_id, estado, fecha_desde, fecha_hasta);

  const query = `
    SELECT
      p.nro_pedido,
      p.fecha,
      p.estado,
      c.descripcion AS cliente,
      c.id_cliente,
      c.cuit,
      c.id_localidad,
      l.nombre AS localidad,
      l.codigo_postal AS codigo_postal,
      l.zona,
      c.id_condicion_iva,
      civ.descripcion AS condicion_iva,
      pg.medio_pago,
      pg.estado_pago
    FROM pedidos p
    JOIN clientes c ON p.id_cliente = c.id_cliente
    LEFT JOIN localidades l ON c.id_localidad = l.id_localidad
    LEFT JOIN condiciones_iva civ ON c.id_condicion_iva = civ.id_condicion
    LEFT JOIN pagos pg ON p.nro_pedido = pg.nro_pedido AND pg.deleted_at IS NULL
    WHERE p.deleted_at IS NULL ${clause}
    ORDER BY p.fecha DESC
    LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
  `;
  const { rows } = await pool.query(query, [...filterValues, limit, offset]);

  const totalPagesCountQuery = `
    SELECT COUNT(*) AS total
    FROM pedidos p
    JOIN clientes c ON p.id_cliente = c.id_cliente
    LEFT JOIN localidades l ON c.id_localidad = l.id_localidad
    LEFT JOIN condiciones_iva civ ON c.id_condicion_iva = civ.id_condicion
    LEFT JOIN pagos pg ON p.nro_pedido = pg.nro_pedido AND pg.deleted_at IS NULL
    WHERE p.deleted_at IS NULL ${clause}
  `;
  const totalPagesCountResult = await pool.query(totalPagesCountQuery, filterValues);
  const total = parseInt(totalPagesCountResult.rows[0].total, 10);

  rows.forEach(row => {
    row.total = total;
    row.page = page;
    row.limit = limit;
  });
  return rows;
};

export const getPedidosByIds = async (nro_pedidos: number[]): Promise<PedidoConClienteDTO[] | null> => {
  const placeholders = nro_pedidos.map((_, i) => `$${i + 1}`).join(',');

  const query = `
    SELECT
      p.nro_pedido,
      p.fecha,
      p.estado,
      c.descripcion AS cliente,
      c.id_cliente,
      c.cuit,
      c.id_localidad,
      l.nombre AS localidad,
      l.codigo_postal AS codigo_postal,
      l.zona,
      c.id_condicion_iva,
      civ.descripcion AS condicion_iva,
      pg.medio_pago,
      pg.estado_pago
    FROM pedidos p
    JOIN clientes c ON p.id_cliente = c.id_cliente
    LEFT JOIN localidades l ON c.id_localidad = l.id_localidad
    LEFT JOIN condiciones_iva civ ON c.id_condicion_iva = civ.id_condicion
    LEFT JOIN pagos pg ON p.nro_pedido = pg.nro_pedido AND pg.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.nro_pedido IN (${placeholders})
  `;
  const { rows } = await pool.query(query, nro_pedidos);
  return rows.length > 0 ? rows : null;
};


function buildPedidosFilter(cliente_id?: number, estado?: string, fecha_desde?: string, fecha_hasta?: string): { clause: string; values: any[]; nextIndex: number } {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (cliente_id !== undefined) {
    conditions.push(`c.id_cliente = $${idx++}`);
    values.push(cliente_id);
  }
  if (estado !== undefined) {
    conditions.push(`p.estado = $${idx++}`);
    values.push(estado);
  }
  if (fecha_desde !== undefined) {
    conditions.push(`p.fecha >= $${idx++}`);
    values.push(fecha_desde);
  }
  if (fecha_hasta !== undefined) {
    conditions.push(`p.fecha <= $${idx++}`);
    values.push(fecha_hasta);
  }

  return {
    clause: conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '',
    values,
    nextIndex: idx,
  };
}

/**
 * Obtiene el estado de un pedido por su número.
 */
export const getPedidoByNumero = async (nro_pedido: number): Promise<string | null> => {
  const query = 'SELECT estado FROM pedidos WHERE nro_pedido = $1 AND deleted_at IS NULL';
  const { rows } = await pool.query(query, [nro_pedido]);
  return rows[0]?.estado || null;
}

// Modificar para agregar los artículos del pedido
export const createPedido = async (pedidoData: PedidoDTO, client?: any): Promise<PedidoDTO> => {
  const db = client;
  const query = `
    INSERT INTO pedidos (id_cliente, estado, id_condicion)
    VALUES ($1, 'pendiente', $2)
    RETURNING nro_pedido, fecha, estado, id_condicion;
  `;
  const { rows } = await db.query(query, [
    pedidoData.id_cliente,
    pedidoData.id_condicion
  ]);
  return rows[0];
}

//actualizarEstado
export const updateEstadoPedido = async (nro_pedido: number, estado: string): Promise<PedidoDTO | undefined> => {
  const query = `
    UPDATE pedidos
    SET estado = $1
    WHERE nro_pedido = $2
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [estado, nro_pedido]);
  return rows[0];
}

export const getCondicionVentaById = async (id_condicion: number): Promise<any | null> => {
  const query = 'SELECT * FROM condiciones_venta WHERE id_condicion = $1';
  const { rows } = await pool.query(query, [id_condicion]);
  return rows[0] || null;
};

export const deletePedido = async (pedidoDetalle: Pedido_ArticuloDTO[]): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const nro_pedido = pedidoDetalle[0]?.nro_pedido;

    // Devolver el stock de cada línea a donde corresponda (oferta activa o
    // articulo base), simétrico a cómo se descontó al crear el pedido.
    for (const item of pedidoDetalle) {
      await decrementarStockEfectivo(String(item.codigo_articulo), -item.cantidad, client);
    }

    const deletePedidoArticuloQuery = `
      UPDATE pedido_articulo
      SET deleted_at = NOW()
      WHERE nro_pedido = $1 AND deleted_at IS NULL;
    `;
    await client.query(deletePedidoArticuloQuery, [nro_pedido]);

    const deletePagosQuery = `
      UPDATE pagos
      SET deleted_at = NOW()
      WHERE nro_pedido = $1 AND deleted_at IS NULL;
    `;
    await client.query(deletePagosQuery, [nro_pedido]);

    const deletePedidoQuery = `
      UPDATE pedidos
      SET deleted_at = NOW()
      WHERE nro_pedido = $1 AND deleted_at IS NULL;
    `;
    await client.query(deletePedidoQuery, [nro_pedido]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
