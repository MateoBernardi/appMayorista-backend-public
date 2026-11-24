import { ClienteDTO, LocalidadDTO, VisitaDTO, ClientesVisitadosDTO } from '../../domain/dto/ClienteDTO';
import { pool } from './pgClient';

export const getAllActiveClients = async (zona: string): Promise<ClienteDTO[]> => {
  const query = `
    WITH clientes_zona AS (
    SELECT 
        c.id_cliente,
        c.descripcion,
        c.direccion,
        c.email,
        c.cuit,
        c.observacion,
        c.id_condicion_iva,
        l.nombre AS nombre,
        l.codigo_postal AS codigo_postal
    FROM clientes c
    JOIN localidades l ON c.id_localidad = l.id_localidad
    WHERE l.zona = $1 
      AND c.deleted_at IS NULL
    )
    SELECT 
        cz.*,
        ci.descripcion AS condicion_iva,
        -- Datos de visita (solo para los clientes filtrados)
        v.resultado AS estado_hoy,
        v.observacion_visita AS observacion_hoy,
        -- Subconsulta de teléfonos (más rápida que un GROUP BY gigante)
        (SELECT COALESCE(json_agg(jsonb_build_object('telefono', t.telefono, 'tipo', t.tipo)), '[]')
        FROM telefonos t WHERE t.id_cliente = cz.id_cliente) AS telefonos,
        -- Subconsulta de pedidos
        (SELECT COUNT(*) FROM pedidos pd 
        WHERE pd.id_cliente = cz.id_cliente AND pd.estado = 'pendiente' AND pd.deleted_at IS NULL) AS pedidos_pendientes
    FROM clientes_zona cz
    JOIN condiciones_iva ci ON cz.id_condicion_iva = ci.id_condicion
    LEFT JOIN visitas v ON cz.id_cliente = v.id_cliente AND v.fecha_visita = CURRENT_DATE AND v.deleted_at IS NULL
    ORDER BY cz.descripcion;
  `;
  const { rows } = await pool.query(query, [zona]);
  return rows;
};

export const getClienteById = async (id: number): Promise<ClienteDTO | undefined> => {
  const query = `
    SELECT 
      c.id_cliente,
      c.descripcion,
      c.direccion,
      c.cuit,
      c.observacion,
      c.id_condicion_iva,
      c.id_localidad,
      l.nombre AS nombre,
      l.codigo_postal AS codigo_postal,
      l.zona,
      ci.descripcion AS condicion_iva,
      (SELECT COALESCE(json_agg(jsonb_build_object('telefono', t.telefono, 'tipo', t.tipo)), '[]')
        FROM telefonos t WHERE t.id_cliente = c.id_cliente) AS telefonos
    FROM clientes c
    LEFT JOIN localidades l ON c.id_localidad = l.id_localidad
    LEFT JOIN condiciones_iva ci ON c.id_condicion_iva = ci.id_condicion
    WHERE c.id_cliente = $1 AND c.deleted_at IS NULL
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0];
};

export const searchClientesRepo = async (query: string): Promise<ClienteDTO[]> => {
  const palabras = query.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];

  const condicionesPorPalabra = palabras.map((_, i) => {
    const ilikeParam = `$${i + 2}`;
    const rawParam = `$${i + 2 + palabras.length}`;
    return `(
      c.descripcion ILIKE ${ilikeParam} OR to_tsvector('spanish', c.descripcion) @@ plainto_tsquery('spanish', ${rawParam}) OR c.descripcion % ${rawParam}
      OR l.nombre ILIKE ${ilikeParam} OR to_tsvector('spanish', l.nombre) @@ plainto_tsquery('spanish', ${rawParam}) OR l.nombre % ${rawParam}
      OR c.direccion ILIKE ${ilikeParam} OR to_tsvector('spanish', c.direccion) @@ plainto_tsquery('spanish', ${rawParam}) OR c.direccion % ${rawParam}
    )`;
  }).join(' AND ');

  const simExpr = (col: string) =>
    `GREATEST(${palabras.map((_, i) => `similarity(${col}, $${i + 2 + palabras.length})`).join(', ')})`;

  const sql = `
    SELECT
      c.id_cliente,
      c.descripcion,
      c.direccion,
      c.cuit,
      c.observacion,
      l.nombre AS nombre,
      l.codigo_postal AS codigo_postal,
      ci.descripcion AS condicion_iva,
      COALESCE(
        json_agg(
          jsonb_build_object('telefono', t.telefono, 'tipo', t.tipo)
        ) FILTER (WHERE t.id_telefono IS NOT NULL), '[]'
      ) AS telefonos,
      (
        SELECT COUNT(*)
        FROM pedidos pd
        WHERE pd.id_cliente = c.id_cliente
          AND pd.estado = 'pendiente'
          AND pd.deleted_at IS NULL
      ) AS pedidos_pendientes,
      CASE
        WHEN c.descripcion ILIKE '%' || $1 || '%' OR to_tsvector('spanish', c.descripcion) @@ plainto_tsquery('spanish', $1) THEN 3
        WHEN l.nombre ILIKE '%' || $1 || '%' OR to_tsvector('spanish', l.nombre) @@ plainto_tsquery('spanish', $1) THEN 2
        WHEN c.direccion ILIKE '%' || $1 || '%' OR to_tsvector('spanish', c.direccion) @@ plainto_tsquery('spanish', $1) THEN 1
        ELSE 0
      END AS field_priority,
      GREATEST(${simExpr('c.descripcion')}, ${simExpr('l.nombre')}, ${simExpr('c.direccion')}) AS sim
    FROM clientes c
    JOIN condiciones_iva ci ON c.id_condicion_iva = ci.id_condicion
    JOIN localidades l ON c.id_localidad = l.id_localidad
    LEFT JOIN telefonos t ON c.id_cliente = t.id_cliente
    WHERE c.deleted_at IS NULL
      AND (${condicionesPorPalabra})
    GROUP BY c.id_cliente, ci.descripcion, l.nombre, l.codigo_postal
    ORDER BY field_priority DESC, sim DESC, c.descripcion ASC
    LIMIT 30
  `;
  const values = [query, ...palabras.map(p => `%${p}%`), ...palabras];

  const { rows } = await pool.query(sql, values);
  return rows;
};

export const createCliente = async (cliente: ClienteDTO): Promise<number> => {
  const client = await pool.connect(); 
  try {
    await client.query('BEGIN');

    const clienteQuery = `
      INSERT INTO clientes (descripcion, direccion, email, cuit, id_condicion_iva, id_localidad, observacion)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id_cliente;
    `;
    const clienteValues = [
      cliente.descripcion,
      cliente.direccion,
      cliente.email,
      cliente.cuit,
      cliente.id_condicion_iva,
      cliente.id_localidad,
      cliente.observacion || null
    ];
    
    const res = await client.query(clienteQuery, clienteValues);
    const idCliente = res.rows[0].id_cliente;

    if (cliente.telefonos && cliente.telefonos.length > 0) {
      for (const tel of cliente.telefonos) {
        await client.query(
          'INSERT INTO telefonos (id_cliente, telefono, tipo) VALUES ($1, $2, $3)',
          [idCliente, tel.telefono, tel.tipo]
        );
      }
    }

    await client.query('COMMIT');
    return idCliente;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateCliente = async (id: number, cliente: Partial<ClienteDTO>): Promise<{ success: boolean }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Actualizar datos básicos
    const updateQuery = `
      UPDATE clientes 
      SET descripcion = $1, direccion = $2, email = $3, 
          id_condicion_iva = $4, id_localidad = $5, observacion = $6,
          updated_at = CURRENT_TIMESTAMP
      WHERE id_cliente = $7 AND deleted_at IS NULL
      RETURNING *;
    `;
    await client.query(updateQuery, [
      cliente.descripcion,
      cliente.direccion,
      cliente.email,
      cliente.id_condicion_iva,
      cliente.id_localidad,
      cliente.observacion || null,
      id
    ]);

    // 2. Sincronizar teléfonos (Borrar y re-insertar es lo más seguro)
    await client.query('DELETE FROM telefonos WHERE id_cliente = $1', [id]);
    
    if (cliente.telefonos && cliente.telefonos.length > 0) {
      for (const tel of cliente.telefonos) {
        await client.query(
          'INSERT INTO telefonos (id_cliente, telefono, tipo) VALUES ($1, $2, $3)',
          [id, tel.telefono, tel.tipo]
        );
      }
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Soft delete manual (por id_cliente) o automático (clientes sin pedidos en 6 meses).
 * @param id (opcional) Si se pasa, borra solo ese cliente. Si no, borra todos los inactivos.
 */
export const deleteCliente = async (id?: number): Promise<ClienteDTO | ClienteDTO[] | undefined> => {
  if (id) {
    // Soft delete manual
    const query = `
      UPDATE clientes
      SET deleted_at = NOW()
      WHERE id_cliente = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  } else {
    // Soft delete automático: clientes sin pedidos en 6 meses
    const query = `
      UPDATE clientes c
      SET deleted_at = NOW()
      WHERE c.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM pedidos p
          WHERE p.id_cliente = c.id_cliente
            AND p.deleted_at IS NULL
            AND p.fecha >= NOW() - INTERVAL '6 months'
        )
      RETURNING *;
    `;
    const { rows } = await pool.query(query);
    return rows; // Devuelve todos los clientes marcados como inactivos
  }
};

export const fetchClientesVisitadosZona = async (zona: string): Promise<ClientesVisitadosDTO | undefined> => {
  const query = `
    SELECT 
    COUNT(c.id_cliente) AS total_clientes_zona,
    COUNT(v.id_visita) AS clientes_visitados_hoy,
    CASE
        WHEN COUNT(c.id_cliente) = 0 THEN 0 -- Evitar división por cero
        ELSE ROUND((COUNT(v.id_visita)::NUMERIC / COUNT(c.id_cliente)::NUMERIC) * 100, 1)
    END AS porcentaje_avance,
    COALESCE(
        json_agg(json_build_object('id_cliente', c.id_cliente, 'resultado', v.resultado))
            FILTER (WHERE v.id_visita IS NOT NULL),
        '[]'::json
    ) AS visitas
    FROM
        clientes c
    JOIN 
        localidades l ON c.id_localidad = l.id_localidad
    LEFT JOIN 
        visitas v ON c.id_cliente = v.id_cliente AND v.fecha_visita = CURRENT_DATE AND v.deleted_at IS NULL
    WHERE 
        l.zona = $1
        AND c.deleted_at IS NULL;
  `;
  const { rows } = await pool.query(query, [zona]);
  return rows[0];
}

export const nuevaLocalidad = async (nombre: string, zona: string, codigo_postal: string): Promise<number> => {
  const query = `
    INSERT INTO localidades (nombre, zona, codigo_postal)
    VALUES ($1, $2, $3)
    RETURNING id_localidad;
  `;
  const { rows } = await pool.query(query, [nombre, zona, codigo_postal]);
  return rows[0].id_localidad;
};

export const getLocalidadById = async (id: number): Promise<LocalidadDTO | undefined> => {
  const query = `
    SELECT id_localidad, nombre, zona, codigo_postal
    FROM localidades
    WHERE id_localidad = $1;
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0];
};

export const getAllLocalidades = async (): Promise<LocalidadDTO[]> => {
  const query = `
    SELECT id_localidad, nombre, zona, codigo_postal
    FROM localidades
    ORDER BY nombre;
  `;
  const { rows } = await pool.query(query);
  return rows;
};


export const getZonasDisponibles = async (): Promise<{ zona: number }[]> => {
  const query = `
    SELECT DISTINCT zona
    FROM localidades
    ORDER BY zona;
  `;
  const { rows } = await pool.query(query);
  return rows;
};

export const getCondicionIvaPorDescripcion = async (descripcion: string): Promise<{ id_condicion: number; descripcion: string } | undefined> => {
  const query = `
    SELECT id_condicion, descripcion
    FROM condiciones_iva
    WHERE descripcion ILIKE $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [`%${descripcion}%`]);
  return rows[0];
};

export const getClientesByCuitsOrEmails = async (cuits: string[], emails: string[]): Promise<{ cuit: string; email: string | null }[]> => {
  const query = `
    SELECT cuit, email
    FROM clientes
    WHERE deleted_at IS NULL AND (cuit = ANY($1) OR email = ANY($2));
  `;
  const { rows } = await pool.query(query, [cuits, emails]);
  return rows;
};

export const createClientesBulk = async (clientes: ClienteDTO[]): Promise<number> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let insertados = 0;
    for (const cliente of clientes) {
      const clienteQuery = `
        INSERT INTO clientes (descripcion, direccion, email, cuit, id_condicion_iva, id_localidad, observacion)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id_cliente;
      `;
      const clienteValues = [
        cliente.descripcion,
        cliente.direccion,
        cliente.email || null,
        cliente.cuit,
        cliente.id_condicion_iva,
        cliente.id_localidad,
        cliente.observacion || null
      ];

      const res = await client.query(clienteQuery, clienteValues);
      const idCliente = res.rows[0].id_cliente;
      insertados++;

      if (cliente.telefonos && cliente.telefonos.length > 0) {
        for (const tel of cliente.telefonos) {
          await client.query(
            'INSERT INTO telefonos (id_cliente, telefono, tipo) VALUES ($1, $2, $3)',
            [idCliente, tel.telefono, tel.tipo]
          );
        }
      }
    }

    await client.query('COMMIT');
    return insertados;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getAllClientesByLocalidad = async (id_localidad: number): Promise<ClienteDTO[]> => {
  const query = `
    SELECT 
      c.id_cliente,
      c.descripcion,
      c.direccion,
      c.cuit,
      c.observacion,
      c.id_condicion_iva,
      l.nombre AS nombre,
      l.codigo_postal AS codigo_postal,
      ci.descripcion AS condicion_iva,
      (SELECT COALESCE(json_agg(jsonb_build_object('telefono', t.telefono, 'tipo', t.tipo)), '[]')
        FROM telefonos t WHERE t.id_cliente = c.id_cliente) AS telefonos
    FROM clientes c
    JOIN localidades l ON c.id_localidad = l.id_localidad
    JOIN condiciones_iva ci ON c.id_condicion_iva = ci.id_condicion
    WHERE c.id_localidad = $1 AND c.deleted_at IS NULL
    ORDER BY c.descripcion;
  `;
  const { rows } = await pool.query(query, [id_localidad]);
  return rows;
};