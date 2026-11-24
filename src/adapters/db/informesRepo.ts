import { Pool, PoolClient } from 'pg';
import { pool } from './pgClient';
import {
  AdjuntoArchivoDTO,
  AdjuntoDTO,
  EntradaFilaDTO,
  EntradaVistoDTO,
  InformeResumenDTO,
  NuevoAdjuntoDTO,
  PersonaResumenDTO,
  ResultadoAgregarEntrada,
  ResultadoEscritura,
} from '../../domain/dto/InformeDTO';

const ENTRADA_COLS =
  'id::text AS id, informe_id, tipo, autor_id, menciones, creado_en, editado_en, cuerpo';
const ADJUNTO_COLS =
  'a.id::text AS id, a.entrada_id::text AS entrada_id, a.tipo, a.nombre, a.mime, a.tamano, a.orden';
const PAGE_SIZE = 20;

// Visibilidad: quien escribió alguna entrada del informe (incluye al creador) o fue mencionado.
const visible = (informe: string, persona: string) =>
  `EXISTS (
     SELECT 1 FROM informe_entrada v
      WHERE v.informe_id = ${informe}
        AND (v.autor_id = ${persona} OR v.menciones @> ARRAY[${persona}::int])
   )`;

// Acceso de management: el informe menciona al empleado consultado (sin importar quién mira).
const mencionaA = (informe: string, empleado: string) =>
  `EXISTS (
     SELECT 1 FROM informe_entrada v
      WHERE v.informe_id = ${informe}
        AND v.menciones @> ARRAY[${empleado}::int]
   )`;

type Db = Pool | PoolClient;

/** Ids de la lista que existen como usuario activo (los mencionables). */
export async function getUsuariosExistentes(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<{ id: number }>(
    `SELECT ue.id
       FROM usuario_entidad ue
       JOIN usuarios u ON u.id = ue.id_usuario AND u.deleted_at IS NULL
      WHERE ue.id = ANY($1::int[])`,
    [ids],
  );
  return rows.map((r) => r.id);
}

/** Inserta el `relato` que abre un informe. */
export async function insertRelato(
  informeId: string,
  autorId: number,
  cuerpo: string,
  menciones: number[],
): Promise<EntradaFilaDTO> {
  const { rows } = await pool.query<EntradaFilaDTO>(
    `INSERT INTO informe_entrada (informe_id, tipo, autor_id, menciones, cuerpo)
     VALUES ($1, 'relato', $2, $3::int[], $4)
     RETURNING ${ENTRADA_COLS}`,
    [informeId, autorId, menciones, cuerpo],
  );
  return rows[0]!;
}

/**
 * Agrega un `mensaje` a un informe existente. Toma un lock transaccional por
 * informe para que la verificación de acceso y el INSERT sean atómicos.
 */
export async function agregarEntrada(
  informeId: string,
  autorId: number,
  cuerpo: string,
  menciones: number[],
  /** Gerencia escribe aunque no sea autor ni esté mencionada. */
  esGerencia = false,
): Promise<ResultadoAgregarEntrada> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [informeId]);

    const { rows: estado } = await client.query<{
      total: number;
      visible: boolean | null;
    }>(
      `SELECT count(*)::int AS total,
              bool_or(autor_id = $2 OR menciones @> ARRAY[$2::int]) AS visible
         FROM informe_entrada
        WHERE informe_id = $1`,
      [informeId, autorId],
    );
    const { total, visible: puedeVer } = estado[0]!;

    if (total === 0 || (!puedeVer && !esGerencia)) {
      await client.query('ROLLBACK');
      return { status: 'no_existe' };
    }

    const { rows } = await client.query<EntradaFilaDTO>(
      `INSERT INTO informe_entrada (informe_id, tipo, autor_id, menciones, cuerpo)
       VALUES ($1, 'mensaje', $2, $3::int[], $4)
       RETURNING ${ENTRADA_COLS}`,
      [informeId, autorId, menciones, cuerpo],
    );
    await client.query('COMMIT');
    return { status: 'ok', entrada: rows[0]! };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function estadoEscritura(
  db: Db,
  informeId: string,
  entradaId: number,
  personaId: number,
): Promise<ResultadoEscritura<{}>> {
  const { rows } = await db.query<{
    visible: boolean | null;
    existe: boolean | null;
    autor_entrada: number | null;
  }>(
    `SELECT bool_or(autor_id = $2 OR menciones @> ARRAY[$2::int]) AS visible,
            bool_or(id = $3::bigint) AS existe,
            max(autor_id) FILTER (WHERE id = $3::bigint) AS autor_entrada
       FROM informe_entrada
      WHERE informe_id = $1`,
    [informeId, personaId, entradaId],
  );
  const e = rows[0]!;
  if (!e.visible || !e.existe) return { status: 'no_existe' };
  if (e.autor_entrada !== personaId) return { status: 'no_autor' };
  return { status: 'ok' };
}

/** Comprueba, sin lock, que la persona puede escribir sobre la entrada (antes de subir un archivo). */
export function verificarEscrituraEntrada(informeId: string, entradaId: number, personaId: number) {
  return estadoEscritura(pool, informeId, entradaId, personaId);
}

async function enTransaccionSobreEntrada<T>(
  informeId: string,
  entradaId: number,
  personaId: number,
  operacion: (client: PoolClient) => Promise<ResultadoEscritura<T>>,
): Promise<ResultadoEscritura<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [informeId]);
    const estado = await estadoEscritura(client, informeId, entradaId, personaId);
    if (estado.status !== 'ok') {
      await client.query('ROLLBACK');
      return estado;
    }
    const resultado = await operacion(client);
    await client.query(resultado.status === 'ok' ? 'COMMIT' : 'ROLLBACK');
    return resultado;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Reemplaza el cuerpo y las menciones de una entrada propia de un informe abierto. */
export function editarEntrada(
  informeId: string,
  entradaId: number,
  personaId: number,
  cuerpo: string,
  menciones: number[],
) {
  return enTransaccionSobreEntrada<{ entrada: EntradaFilaDTO }>(
    informeId,
    entradaId,
    personaId,
    async (client) => {
      const { rows } = await client.query<EntradaFilaDTO>(
        `UPDATE informe_entrada
            SET cuerpo = $3, menciones = $4::int[], editado_en = now()
          WHERE id = $1::bigint AND informe_id = $2
          RETURNING ${ENTRADA_COLS}`,
        [entradaId, informeId, cuerpo, menciones],
      );
      return { status: 'ok', entrada: rows[0]! };
    },
  );
}

export function insertAdjunto(
  informeId: string,
  entradaId: number,
  personaId: number,
  adjunto: NuevoAdjuntoDTO,
) {
  return enTransaccionSobreEntrada<{ adjunto: AdjuntoDTO }>(
    informeId,
    entradaId,
    personaId,
    async (client) => {
      const { rows } = await client.query<AdjuntoDTO>(
        `WITH nuevo AS (
           INSERT INTO informe_adjunto (entrada_id, tipo, r2_key, nombre, mime, tamano, orden)
           VALUES (
             $1::bigint, $2, $3, $4, $5, $6,
             COALESCE($7::int, (SELECT COALESCE(max(orden) + 1, 0) FROM informe_adjunto WHERE entrada_id = $1::bigint))
           )
           RETURNING *
         )
         SELECT id::text AS id, entrada_id::text AS entrada_id, tipo, nombre, mime, tamano, orden
           FROM nuevo`,
        [entradaId, adjunto.tipo, adjunto.r2_key, adjunto.nombre, adjunto.mime, adjunto.tamano, adjunto.orden ?? null],
      );
      return { status: 'ok', adjunto: rows[0]! };
    },
  );
}

export function deleteAdjunto(
  informeId: string,
  entradaId: number,
  personaId: number,
  adjuntoId: number,
) {
  return enTransaccionSobreEntrada<{}>(informeId, entradaId, personaId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM informe_adjunto WHERE id = $1::bigint AND entrada_id = $2::bigint',
      [adjuntoId, entradaId],
    );
    return rowCount ? { status: 'ok' } : { status: 'no_existe' };
  });
}

/** Entradas del informe en orden cronológico; vacío si no existe o la persona no lo ve. */
export async function getConversacion(
  informeId: string,
  personaId: number,
  empleadoId?: number,
): Promise<EntradaFilaDTO[]> {
  const { rows } = await pool.query<EntradaFilaDTO>(
    `SELECT ${ENTRADA_COLS},
            EXISTS (
              SELECT 1 FROM informe_entrada_visto iv
               WHERE iv.entrada_id = informe_entrada.id AND iv.usuario_id = $3::int
            ) AS visto
       FROM informe_entrada
      WHERE informe_id = $1 AND ${empleadoId === undefined ? visible('$1', '$2') : mencionaA('$1', '$2')}
      ORDER BY creado_en, id`,
    [informeId, empleadoId ?? personaId, personaId],
  );
  return rows;
}

/** Marca como vistas las entradas del informe que la persona aún no vio; devuelve cuántas marcó. */
export async function marcarEntradasVistas(informeId: string, personaId: number): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO informe_entrada_visto (entrada_id, usuario_id)
     SELECT id, $2::int
       FROM informe_entrada
      WHERE informe_id = $1 AND ${visible('$1', '$2')}
     ON CONFLICT DO NOTHING`,
    [informeId, personaId],
  );
  return rowCount ?? 0;
}

/** Quiénes vieron la entrada; vacío si no existe en ese informe. */
export async function getVistosDeEntrada(informeId: string, entradaId: number): Promise<EntradaVistoDTO[]> {
  const { rows } = await pool.query<EntradaVistoDTO>(
    `SELECT iv.usuario_id AS user_context_id, u.nombre, u.apellido, iv.visto_en
       FROM informe_entrada_visto iv
       JOIN informe_entrada e ON e.id = iv.entrada_id
       JOIN usuario_entidad ue ON ue.id = iv.usuario_id
       JOIN usuarios u ON u.id = ue.id_usuario
      WHERE e.id = $2::bigint AND e.informe_id = $1
      ORDER BY iv.visto_en DESC`,
    [informeId, entradaId],
  );
  return rows;
}

/** ¿La persona puede ver el informe? (misma regla que la lectura). */
export async function informeVisiblePara(informeId: string, personaId: number): Promise<boolean> {
  const { rows } = await pool.query(`SELECT ${visible('$1', '$2')} AS ok`, [informeId, personaId]);
  return rows[0]?.ok === true;
}

export async function getAdjuntosPorInforme(informeId: string): Promise<AdjuntoDTO[]> {
  const { rows } = await pool.query<AdjuntoDTO>(
    `SELECT ${ADJUNTO_COLS}
       FROM informe_adjunto a
       JOIN informe_entrada e ON e.id = a.entrada_id
      WHERE e.informe_id = $1
      ORDER BY a.orden, a.id`,
    [informeId],
  );
  return rows;
}

export async function getAdjuntosDeEntrada(entradaId: number): Promise<AdjuntoDTO[]> {
  const { rows } = await pool.query<AdjuntoDTO>(
    `SELECT ${ADJUNTO_COLS}
       FROM informe_adjunto a
      WHERE a.entrada_id = $1::bigint
      ORDER BY a.orden, a.id`,
    [entradaId],
  );
  return rows;
}

/** Datos del archivo de un adjunto; nulo si no existe o la persona no ve el informe. */
export async function getAdjuntoVisible(
  informeId: string,
  adjuntoId: number,
  personaId: number,
  empleadoId?: number,
): Promise<AdjuntoArchivoDTO | null> {
  const { rows } = await pool.query<AdjuntoArchivoDTO>(
    `SELECT a.r2_key, a.nombre, a.mime
       FROM informe_adjunto a
       JOIN informe_entrada e ON e.id = a.entrada_id
      WHERE a.id = $2::bigint AND e.informe_id = $1
        AND ${empleadoId === undefined ? visible('e.informe_id', '$3') : mencionaA('e.informe_id', '$3')}`,
    [informeId, adjuntoId, empleadoId ?? personaId],
  );
  return rows[0] ?? null;
}

/** Nombre y apellido de las personas dadas (autores y mencionados). */
export async function getPersonasResumen(ids: number[]): Promise<PersonaResumenDTO[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<PersonaResumenDTO>(
    `SELECT ue.id, u.nombre, u.apellido
       FROM usuario_entidad ue
       JOIN usuarios u ON u.id = ue.id_usuario
      WHERE ue.id = ANY($1::int[])`,
    [ids],
  );
  return rows;
}

export type InformeFilaListado = Omit<InformeResumenDTO, 'preview'> & {
  cuerpo_inicial: string;
};

/** Informes visibles para la persona, paginados por keyset sobre la última actividad. */
export async function listInformesVisibles(
  personaId: number,
  antes: string | null,
  soloMencionesDe?: number,
): Promise<{ informes: InformeFilaListado[]; nextCursor: string | null }> {
  // Con `soloMencionesDe` (vista de management) se listan los informes que mencionan a ese empleado.
  const sujeto = soloMencionesDe ?? personaId;
  const filtroVisibles =
    soloMencionesDe === undefined ? 'autor_id = $1 OR menciones @> ARRAY[$1::int]' : 'menciones @> ARRAY[$1::int]';
  // El cursor viaja como texto para conservar los microsegundos de timestamptz.
  const { rows } = await pool.query(
    `WITH visibles AS (
       SELECT DISTINCT informe_id
         FROM informe_entrada
        WHERE ${filtroVisibles}
     ), agg AS (
       SELECT e.informe_id,
              (array_agg(e.autor_id ORDER BY e.creado_en, e.id))[1]  AS creador,
              min(e.creado_en)                                       AS creada_en,
              count(*)::int                                          AS entradas,
              (SELECT count(*)::int
                 FROM informe_adjunto a
                 JOIN informe_entrada x ON x.id = a.entrada_id
                WHERE x.informe_id = e.informe_id)                   AS adjuntos,
              max(e.creado_en)                                       AS ultima_actividad,
              bool_or(e.menciones @> ARRAY[$1::int])                 AS mencionado,
              (array_agg(e.cuerpo ORDER BY e.creado_en, e.id))[1]    AS cuerpo_inicial
         FROM informe_entrada e
         JOIN visibles v USING (informe_id)
        GROUP BY e.informe_id
       HAVING max(e.creado_en) < COALESCE($2::timestamptz, 'infinity')
        ORDER BY max(e.creado_en) DESC
        LIMIT ${PAGE_SIZE}
     )
     SELECT a.*, a.ultima_actividad::text AS cursor,
            u.nombre AS creador_nombre, u.apellido AS creador_apellido
       FROM agg a
       LEFT JOIN usuario_entidad ue ON ue.id = a.creador
       LEFT JOIN usuarios u ON u.id = ue.id_usuario
      ORDER BY a.ultima_actividad DESC`,
    [sujeto, antes],
  );

  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1].cursor : null;
  return {
    informes: rows.map(({ cursor: _cursor, ...i }) =>
      soloMencionesDe === undefined ? i : { ...i, mencionado: false },
    ),
    nextCursor,
  };
}
