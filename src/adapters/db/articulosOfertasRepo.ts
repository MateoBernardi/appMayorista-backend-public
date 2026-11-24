import { ArticuloDTO } from '../../domain/dto/ArticuloDTO';
import { OfertaArticuloDTO, OfertaConArticuloDTO } from '../../domain/dto/OfertaDTO';
import { pool } from './pgClient';

export const getOfertaActivaByCodigo = async (codigo_articulo: number, client?: any): Promise<OfertaArticuloDTO | undefined> => {
  const db = client || pool;
  const { rows } = await db.query(
    'SELECT * FROM articulos_ofertas WHERE codigo_articulo = $1 AND deleted_at IS NULL',
    [codigo_articulo]
  );
  return rows[0];
};

export const getOfertasActivasByCodigos = async (codigos: number[], client?: any): Promise<OfertaArticuloDTO[]> => {
  if (codigos.length === 0) return [];
  const db = client || pool;
  const { rows } = await db.query(
    'SELECT * FROM articulos_ofertas WHERE codigo_articulo = ANY($1) AND deleted_at IS NULL',
    [codigos]
  );
  return rows;
};

// Combina un articulo con su oferta activa: los campos de precio/stock de la
// oferta reemplazan por completo a los del articulo base (nunca se mezclan).
export const mergeArticuloConOferta = (articulo: ArticuloDTO, oferta: OfertaArticuloDTO): ArticuloDTO => ({
  ...articulo,
  precio_costo: oferta.precio_costo,
  precio_venta: oferta.precio_venta,
  precio_venta_volumen: oferta.precio_venta_volumen,
  stock_actual: oferta.stock_actual,
  rentabilidad_minima: oferta.rentabilidad_minima ?? 0,
  en_oferta: true,
  oferta_id: oferta.oferta_id!,
});

export const mergeArticulosConOfertas = async (articulos: ArticuloDTO[], client?: any): Promise<ArticuloDTO[]> => {
  if (articulos.length === 0) return articulos;
  const codigos = articulos.map(a => a.codigo_articulo);
  const ofertas = await getOfertasActivasByCodigos(codigos, client);
  if (ofertas.length === 0) return articulos;
  const ofertasPorCodigo = new Map(ofertas.map(o => [o.codigo_articulo, o]));
  return articulos.map(articulo => {
    const oferta = ofertasPorCodigo.get(articulo.codigo_articulo);
    return oferta ? mergeArticuloConOferta(articulo, oferta) : articulo;
  });
};

export const decrementarStockOferta = async (oferta_id: number, cantidad: number, client?: any): Promise<void> => {
  const db = client || pool;
  await db.query(
    `UPDATE articulos_ofertas 
     SET 
       stock_actual = stock_actual - $1,
       updated_at = NOW(),
       deleted_at = CASE 
                      WHEN (stock_actual - $1) <= 0 THEN NOW() 
                      ELSE deleted_at 
                    END
     WHERE oferta_id = $2 
       AND deleted_at IS NULL`, 
    [cantidad, oferta_id]
  );
};

export const crearOferta = async (oferta: OfertaArticuloDTO, client?: any): Promise<OfertaArticuloDTO> => {
  const db = client || pool;
  const { rows } = await db.query(
    `INSERT INTO articulos_ofertas
      (codigo_articulo, precio_costo, precio_venta, precio_venta_volumen, stock_actual, rentabilidad_minima)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      oferta.codigo_articulo,
      oferta.precio_costo,
      oferta.precio_venta,
      oferta.precio_venta_volumen,
      oferta.stock_actual,
      oferta.rentabilidad_minima ?? 0,
    ]
  );
  return rows[0];
};

export const listarOfertas = async (soloActivas: boolean = false): Promise<OfertaArticuloDTO[]> => {
  const query = soloActivas
    ? 'SELECT * FROM articulos_ofertas WHERE deleted_at IS NULL ORDER BY created_at DESC'
    : 'SELECT * FROM articulos_ofertas ORDER BY created_at DESC';
  const { rows } = await pool.query(query);
  return rows;
};

export const listarOfertasConArticulo = async (soloActivas: boolean = false, rubro?: string): Promise<OfertaConArticuloDTO[]> => {
  const conditions: string[] = [];
  const params: any[] = [];
  if (soloActivas) conditions.push('ao.deleted_at IS NULL');
  if (rubro) {
    params.push(rubro);
    conditions.push(`a.rubro = $${params.length}`);
  }

  const query = `
    SELECT ao.*, a.descripcion, a.rubro, a.venta_tipo, a.precio_venta AS precio_venta_base
    FROM articulos_ofertas ao
    JOIN articulos a ON a.codigo_articulo = ao.codigo_articulo
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY ao.created_at DESC
  `;
  const { rows } = await pool.query(query, params);
  return rows;
};

export const actualizarOferta = async (
  oferta_id: number,
  data: Pick<OfertaArticuloDTO, 'precio_costo' | 'precio_venta' | 'precio_venta_volumen' | 'stock_actual' | 'rentabilidad_minima'>,
  client?: any
): Promise<OfertaArticuloDTO | undefined> => {
  const db = client || pool;
  const { rows } = await db.query(
    `UPDATE articulos_ofertas
     SET precio_costo = $1, precio_venta = $2, precio_venta_volumen = $3, stock_actual = $4, rentabilidad_minima = $5, updated_at = NOW()
     WHERE oferta_id = $6 AND deleted_at IS NULL
     RETURNING *`,
    [
      data.precio_costo,
      data.precio_venta,
      data.precio_venta_volumen,
      data.stock_actual,
      data.rentabilidad_minima ?? 0,
      oferta_id,
    ]
  );
  return rows[0];
};

export const desactivarOferta = async (oferta_id: number): Promise<OfertaArticuloDTO | undefined> => {
  const { rows } = await pool.query(
    'UPDATE articulos_ofertas SET deleted_at = NOW() WHERE oferta_id = $1 AND deleted_at IS NULL RETURNING *',
    [oferta_id]
  );
  return rows[0];
};
