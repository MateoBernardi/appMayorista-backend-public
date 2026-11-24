import { ArticuloDTO, ArticuloPaginadoDTO, ArticuloPublicDTO, ArticuloPaginadoPublicoDTO, ArticuloBusquedaPublicaDTO } from '../../domain/dto/ArticuloDTO';
import { pool } from './pgClient';
import { mergeArticulosConOfertas } from './articulosOfertasRepo';

/**
 * Obtiene artículos paginados por página (paginación clásica).
 * @param rubro Rubro de los artículos a filtrar.
 * @param page Número de página (empieza en 1).
 * @param limit Cantidad máxima de artículos por página.
 * @param filter Filtro opcional para la búsqueda.
 */
export const getAllArticulos = async (rubro: string, page: number = 1, limit: number = 30, filter?: string, soloOfertas?: boolean): Promise<ArticuloPaginadoDTO> => {
  const offset = (page - 1) * limit;
  const orderBy = defineArticulosFilter(filter) || 'codigo_articulo ASC';
  const ofertasClause = soloOfertas
    ? 'AND codigo_articulo IN (SELECT codigo_articulo FROM articulos_ofertas WHERE deleted_at IS NULL)'
    : '';

  const query = `
    SELECT descripcion, codigo_articulo, stock_actual, precio_costo, precio_venta, precio_venta_volumen, cant_unidades_caja, venta_tipo
    FROM articulos
    WHERE deleted_at IS NULL AND rubro = $1 ${ofertasClause}
    ORDER BY ${orderBy}
    LIMIT $2 OFFSET $3
  `;
  const result = await pool.query(query, [rubro, limit, offset]);
  const articulos: ArticuloDTO[] = await mergeArticulosConOfertas(result.rows);

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM articulos WHERE deleted_at IS NULL AND rubro = $1 ${ofertasClause}`,
    [rubro]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  return {
    articulos,
    page,
    totalPages: Math.ceil(total / limit),
    total
  };
};

function defineArticulosFilter(filter: string | undefined): string {
  if (!filter) return '';
  switch (filter.toLowerCase()) {
    case 'menor_stock':
      return 'stock_actual';
    case 'mayor_stock':
      return 'stock_actual DESC';
    case 'menor_precio':
      return 'precio_venta';
    case 'mayor_precio':
      return 'precio_venta DESC';
    default:
      return '';
  }
}

export const modifyArticulo = async (articuloAModificar: ArticuloDTO): Promise<ArticuloDTO> => {
  const query = `
    UPDATE articulos
    SET descripcion = $1,
        cod_barra_articulo = $2,
        cod_barra_caja = $3,
        cant_unidades_caja = $4,
        precio_costo = $5,
        precio_venta = $6,
        precio_venta_volumen = $7,
        stock_actual = $8,
        rentabilidad_minima = $9,
        rubro = $10,
        venta_tipo = $11,
        updated_at = NOW()
    WHERE codigo_articulo = $12
    RETURNING *;
  `;
  const values = [
    articuloAModificar.descripcion,
    articuloAModificar.cod_barra_articulo,
    articuloAModificar.cod_barra_caja,
    articuloAModificar.cant_unidades_caja,
    articuloAModificar.precio_costo,
    articuloAModificar.precio_venta,
    articuloAModificar.precio_venta_volumen,
    articuloAModificar.stock_actual,
    articuloAModificar.rentabilidad_minima,
    articuloAModificar.rubro,
    articuloAModificar.venta_tipo,
    articuloAModificar.codigo_articulo
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

export const getArticulosPublic = async (
  rubro: string,
  seccionImagen: string,
  page: number = 1,
  limit: number = 15
): Promise<ArticuloPaginadoPublicoDTO> => {
  const offset = (page - 1) * limit;
  
  // Si el rubro es 'I', permitir stock = 0, sino solo stock > 0
  const stockCondition = rubro === 'I' ? 'a.stock_actual >= 0' : 'a.stock_actual > 0';
  
  const query = `
    SELECT a.descripcion, a.codigo_articulo, a.stock_actual,
           i.url as image_url
    FROM articulos a
    INNER JOIN articulo_imagen ai ON ai.articulo_id = a.codigo_articulo AND ai.deleted_at IS NULL
    INNER JOIN images i ON i.id = ai.image_id AND i.deleted_at IS NULL AND i.section = $2
    WHERE ${stockCondition} AND a.deleted_at IS NULL AND a.rubro = $1
    ORDER BY a.codigo_articulo ASC, ai.orden ASC, i.id ASC
    LIMIT $3 OFFSET $4
  `;
  const result = await pool.query(query, [rubro, seccionImagen, limit, offset]);

  // Obtener el total de artículos para calcular páginas
  const countQuery = `
    SELECT COUNT(DISTINCT a.codigo_articulo) as total
    FROM articulos a
    INNER JOIN articulo_imagen ai ON ai.articulo_id = a.codigo_articulo AND ai.deleted_at IS NULL
    INNER JOIN images i ON i.id = ai.image_id AND i.deleted_at IS NULL AND i.section = $2
    WHERE ${stockCondition} AND a.deleted_at IS NULL AND a.rubro = $1
  `;
  const countResult = await pool.query(countQuery, [rubro, seccionImagen]);
  const total = parseInt(countResult.rows[0].total, 10);

  // Mapear a ArticuloPublicDTO
  const articulosMap = new Map();
  for (const row of result.rows) {
    if (!articulosMap.has(row.codigo_articulo)) {
      articulosMap.set(row.codigo_articulo, {
        codigo_articulo: row.codigo_articulo,
        descripcion: row.descripcion,
        imagenes: [],
        stock_actual: row.stock_actual
      });
    }
    if (row.image_url) {
      articulosMap.get(row.codigo_articulo).imagenes.push(row.image_url);
    }
  }

  return {
    articulos: Array.from(articulosMap.values()),
    page,
    totalPages: Math.ceil(total / limit),
    total
  };
};

export const getArticuloCostoYRentabilidad = async (codigo_articulo: string, client?: any): Promise<{precio_costo: number; rentabilidad_minima: number} | undefined> => {
  const db = client;
  const query = 'SELECT precio_costo, rentabilidad_minima FROM articulos WHERE codigo_articulo = $1 AND rubro IN (\'M\', \'A\')';
  const { rows } = await db.query(query, [codigo_articulo]);
  return rows[0];
}

export type ArticuloSearchField = 'descripcion' | 'codigo_articulo';
// Cambiar a que si contiene letras => el campo es descripcion, si no es por código
export const getArticulosBySearch = async (
  word: string,
  rubro: string,
  campo: ArticuloSearchField,
  page: number = 1,
  limit: number = 30
): Promise<ArticuloPaginadoDTO> => {
  if (!['descripcion', 'codigo_articulo'].includes(campo)) {
    throw new Error('Campo de búsqueda inválido');
  }
  const offset = (page - 1) * limit;

  let query = '';
  let countQuery = '';
  let params: any[] = [];
  let countParams: any[] = [];

  if (campo === 'descripcion') {
    // Divide la búsqueda en palabras
    const palabras = word.trim().split(/\s+/).filter(Boolean);

    // Validar que existan palabras para evitar consultas vacías u errores de sintaxis
    if (palabras.length === 0) return { articulos: [], page, totalPages: 0, total: 0 };

    // Construye la condición: CADA palabra debe cumplir AL MENOS uno de los tres métodos
    const condicionesPorPalabra = palabras.map((_, i) => {
      const ilikeParam = `$${i + 3}`;                         // Índices para %palabra%
      const rawParam = `$${i + 3 + palabras.length}`;           // Índices para palabra limpia

      return `(
        descripcion ILIKE ${ilikeParam}
        OR to_tsvector('spanish', descripcion) @@ plainto_tsquery('spanish', ${rawParam})
        OR descripcion % ${rawParam}
      )`;
    }).join(' AND '); // <-- Aquí obligamos a que se cumplan todas las palabras

    const limitIdx = 3 + 2 * palabras.length;
    const offsetIdx = limitIdx + 1;

    // Consulta combinada ajustada
    query = `
      SELECT descripcion, codigo_articulo, stock_actual, precio_costo, precio_venta, precio_venta_volumen, cant_unidades_caja, rentabilidad_minima, venta_tipo,
        (CASE WHEN to_tsvector('spanish', descripcion) @@ plainto_tsquery('spanish', $1) THEN 1 ELSE 0 END) AS fulltext_match,
        GREATEST(${palabras.map((_, i) => `similarity(descripcion, $${i + 3 + palabras.length})`).join(', ')}) AS sim
      FROM articulos
      WHERE deleted_at IS NULL AND rubro = $2 AND (${condicionesPorPalabra})
      ORDER BY fulltext_match DESC, sim DESC, descripcion ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    // Mantenemos exactamente tu misma estructura de parámetros para no romper nada abajo
    params = [word, rubro, ...palabras.map(p => `%${p}%`), ...palabras, limit, offset];

    countQuery = `
      SELECT COUNT(*) FROM articulos
      WHERE deleted_at IS NULL AND rubro = $2 AND $1::text IS NOT NULL AND (${condicionesPorPalabra})
    `;
    countParams = params.slice(0, limitIdx - 1);

  } else if (campo === 'codigo_articulo') {
    // Búsqueda exacta por código usando el índice B-tree
    query = `
      SELECT descripcion, codigo_articulo, stock_actual, precio_venta, precio_venta_volumen, cant_unidades_caja, rentabilidad_minima, venta_tipo
      FROM articulos
      WHERE deleted_at IS NULL AND CAST(codigo_articulo AS TEXT) ILIKE $1 AND rubro = $2
      ORDER BY descripcion ASC
      LIMIT $3 OFFSET $4
    `;
    params = [`%${word}%`, rubro, limit, offset];

    countQuery = `
      SELECT COUNT(*) FROM articulos
      WHERE deleted_at IS NULL AND CAST(codigo_articulo AS TEXT) ILIKE $1 AND rubro = $2
    `;
    countParams = [`%${word}%`, rubro];
  }

  const [result, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, countParams),
  ]);
  const articulos = await mergeArticulosConOfertas(result.rows);
  const total = parseInt(countResult.rows[0].count, 10);

  return { articulos, page, totalPages: Math.ceil(total / limit), total };
};

// Busca artículos públicos por palabra clave y rubro, devolviendo imágenes sin paginación
export const getArticulosPublicBySearch = async (
  word: string,
  rubro: string,
  seccionImagen: string,
): Promise<ArticuloBusquedaPublicaDTO> => {

  // Divide la búsqueda en palabras
  const palabras = word.trim().split(/\s+/).filter(Boolean);
  // Genera condiciones ILIKE y pg_trgm para cada palabra
  const ilikeConds = palabras.map((_, i) => `a.descripcion ILIKE $${i + 4}`).join(' AND ');
  const trgmConds = palabras.map((_, i) => `a.descripcion % $${i + 4 + palabras.length}`).join(' AND ');

  // Consulta combinada
  const query = `
    SELECT a.descripcion, a.codigo_articulo, a.stock_actual,
           i.url as image_url
    FROM articulos a
    INNER JOIN articulo_imagen ai ON ai.articulo_id = a.codigo_articulo AND ai.deleted_at IS NULL
    INNER JOIN images i ON i.id = ai.image_id AND i.deleted_at IS NULL AND i.section = $3
    WHERE a.deleted_at IS NULL AND a.rubro = $2 AND (
      to_tsvector('spanish', a.descripcion) @@ plainto_tsquery('spanish', $1)
      OR ${ilikeConds}
      OR ${trgmConds}
    )
    ORDER BY a.codigo_articulo ASC, ai.orden ASC, i.id ASC
  `;
  const params = [word, rubro, seccionImagen, ...palabras.map(p => `%${p}%`), ...palabras];

  const result = await pool.query(query, params);

  // Mapear a ArticuloPublicDTO (igual que getArticulosPublic)
  const articulosMap = new Map();
  for (const row of result.rows) {
    if (!articulosMap.has(row.codigo_articulo)) {
      articulosMap.set(row.codigo_articulo, {
        codigo_articulo: row.codigo_articulo,
        descripcion: row.descripcion,
        imagenes: [],
        stock_actual: row.stock_actual
      });
    }
    if (row.image_url) {
      articulosMap.get(row.codigo_articulo).imagenes.push(row.image_url);
    }
  }

  return {
    articulos: Array.from(articulosMap.values())
  };
}

// Upsert: inserta o actualiza un artículo según el código
export const updateArticulosListRepo = async (articulos: ArticuloDTO[]): Promise<number> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await clearArticulosM(client);

    const valuePlaceholders = articulos.map((_, i) =>
      `($${i * 12 + 1}, $${i * 12 + 2}, $${i * 12 + 3}, $${i * 12 + 4}, $${i * 12 + 5}, $${i * 12 + 6}, $${i * 12 + 7}, $${i * 12 + 8}, $${i * 12 + 9}, $${i * 12 + 10}, $${i * 12 + 11}, $${i * 12 + 12})`
    ).join(', ');

    const query = `
      INSERT INTO articulos (codigo_articulo, descripcion, cod_barra_articulo, cod_barra_caja, cant_unidades_caja, precio_costo, precio_venta, precio_venta_volumen, stock_actual, rentabilidad_minima, rubro, venta_tipo)
      VALUES ${valuePlaceholders}
      ON CONFLICT (codigo_articulo) DO UPDATE SET
        descripcion = EXCLUDED.descripcion,
        cod_barra_articulo = EXCLUDED.cod_barra_articulo,
        cod_barra_caja = EXCLUDED.cod_barra_caja,
        cant_unidades_caja = EXCLUDED.cant_unidades_caja,
        precio_costo = EXCLUDED.precio_costo,
        precio_venta = EXCLUDED.precio_venta,
        precio_venta_volumen = EXCLUDED.precio_venta_volumen,
        stock_actual = EXCLUDED.stock_actual,
        rentabilidad_minima = EXCLUDED.rentabilidad_minima,
        rubro = EXCLUDED.rubro,
        venta_tipo = EXCLUDED.venta_tipo,
        deleted_at = NULL,
        updated_at = NOW()
    `;

    const values: any[] = [];
    articulos.forEach(articulo => {
      values.push(
        articulo.codigo_articulo,
        articulo.descripcion,
        articulo.cod_barra_articulo ?? 0,
        articulo.cod_barra_caja ?? 0,
        articulo.cant_unidades_caja,
        articulo.precio_costo,
        articulo.precio_venta,
        articulo.precio_venta_volumen,
        articulo.stock_actual,
        articulo.rentabilidad_minima ?? 0,
        articulo.rubro,
        articulo.venta_tipo || null
      );
    });

    const result = await client.query(query, values);
    await client.query('COMMIT');
    return result.rowCount || 0;
  }
  catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  finally {
    client.release();
  }
}

export const deleteArticulosBulk = async (codigos: number[]): Promise<void> => {
  if (codigos.length === 0) return;
  await pool.query(
    'UPDATE articulos SET deleted_at = NOW() WHERE codigo_articulo = ANY($1) AND deleted_at IS NULL;',
    [codigos]
  );
}

export const clearArticulosM = async (client?: any): Promise<void> => {
  const db = client || pool;
  await db.query('UPDATE articulos SET deleted_at = NOW() WHERE rubro = \'M\' AND deleted_at IS NULL;');
}

export const getStockArticulo = async (codigo: string): Promise<{stock_actual: number} | undefined> => {
  const query = 'SELECT stock_actual FROM articulos WHERE codigo_articulo = $1 AND rubro IN (\'M\', \'A\')';
  const { rows } = await pool.query(query, [codigo]);
  return rows[0];
}

export const updateArticuloStock = async (codigo: string, cantidad: number, client?: any): Promise<ArticuloDTO> => {
  const db = client || pool;
  const selectQuery = await getStockArticulo(codigo);
  if (!selectQuery) {
    throw new Error('Artículo no encontrado');
  }
  const stockActual = selectQuery.stock_actual;
  const nuevoStock = stockActual - cantidad;
  const updateQuery = `
    UPDATE articulos
    SET stock_actual = $1, updated_at = NOW()
    WHERE codigo_articulo = $2
    RETURNING *;
  `;
  const { rows } = await db.query(updateQuery, [nuevoStock, codigo]);
  return rows[0];
}

export const getArticulosSinStock = async (): Promise<ArticuloDTO[]> => {
  const query = 'SELECT * FROM articulos WHERE stock_actual = 0 AND rubro IN (\'M\', \'A\')';
  const { rows } = await pool.query(query);
  return rows;
};

export const getArticulosSobranteMayorista = async (): Promise<ArticuloDTO[]> => {
  const query = `
    SELECT codigo_articulo, descripcion, cod_barra_articulo, cod_barra_caja,
           cant_unidades_caja, precio_costo, precio_venta, precio_venta_volumen,
           stock_actual, rentabilidad_minima, rubro, venta_tipo, updated_at, deleted_at
    FROM articulos
    WHERE rubro = 'M' AND stock_actual > 0 AND deleted_at IS NULL
    ORDER BY codigo_articulo ASC
  `;
  const { rows } = await pool.query(query);
  return rows;
};
