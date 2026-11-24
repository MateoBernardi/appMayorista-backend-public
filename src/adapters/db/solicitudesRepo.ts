import { PoolClient } from 'pg';
import { pool } from './pgClient';
import { SolicitudBitacoraDTO, SolicitudDTO, SolicitudInfoDTO, PaginatedBitacoraResult } from '../../domain/dto/SolicitudDTO';
import { ArchivoDTO } from '../../domain/dto/ArchivoDTO';
import { generateSignedUrl } from '../archivos/archivosApi';

/** Firma en paralelo la URL de cada archivo (mismo TTL que GET /archivos/:id/url) para que
 *  el chat pueda renderizar imágenes/adjuntos sin un round-trip extra por archivo. */
async function firmarUrlsDeArchivos<T extends { archivos?: any[] }>(rows: T[]): Promise<T[]> {
    const ARCHIVO_URL_EXPIRES_IN = 3600;
    await Promise.all(
        rows.flatMap(row => (row.archivos ?? []).map(async (archivo: any) => {
            if (!archivo?.ruta_r2) return;
            try {
                archivo.url = await generateSignedUrl(archivo.ruta_r2, ARCHIVO_URL_EXPIRES_IN, archivo.nombre);
            } catch (err) {
                console.error('Error firmando URL de archivo de bitácora:', archivo.id, err);
            }
        })),
    );
    return rows;
}

/** Shared helper: maps the optional `type` query param to the tipos array used in SQL ANY($N). */
function buildTiposAFiltrar(type?: string): string[] {
    return type === 'CHAT' ? ['CHAT'] : ['MANDATO', 'REUNION', 'SOLICITUD'];
}

const ESTADOS_EXPIRABLES = ['SENT', 'SEEN', 'MODIFIED', 'MODIFIED_BY_HOST'];

export const createSolicitud = async (
    solicitud: SolicitudDTO
): Promise<number> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertSolicitudQuery = `
            INSERT INTO solicitudes (titulo, created_by, tipo_actividad, es_grupo, descripcion, fecha_inicio, fecha_fin)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING solicitud_id
        `;
        const solicitudValues = [
            solicitud.titulo,
            solicitud.created_by,
            solicitud.tipo_actividad,
            solicitud.es_grupo ?? false,
            solicitud.descripcion,
            solicitud.fecha_inicio,
            solicitud.fecha_fin,
        ];
        const res = await client.query(insertSolicitudQuery, solicitudValues);
        const solicitudId = res.rows[0].solicitud_id;

        const insertInvitadoQuery = `
            INSERT INTO solicitudes_invitados (id_solicitud, id_usuario_invitado, estado)
            VALUES ($1, $2, 'SENT')
        `;

        for (const invitadoId of solicitud.invitados) {
            await client.query(insertInvitadoQuery, [solicitudId, invitadoId]);
        }

        const insertBitacoraQuery = `
            INSERT INTO solicitudes_bitacora (solicitud_id, usuario_id, observacion, fecha_inicio_nueva, fecha_fin_nueva, created_at, estado)
            VALUES ($1, $2, $3, $4, $5, NOW(), 'SENT')
            RETURNING id
        `;
        const bitacoraRes = await client.query(insertBitacoraQuery, [solicitudId, solicitud.created_by, solicitud.descripcion, solicitud.fecha_inicio, solicitud.fecha_fin]);
        const bitacoraId = bitacoraRes.rows[0]?.id;

        if (bitacoraId && solicitud.archivosIds?.length) {
            const insertBitacoraArchivosQuery = `
            INSERT INTO solicitudes_bitacora_archivo (bitacora_id, archivo_id)
            VALUES ${solicitud.archivosIds
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertBitacoraArchivosQuery, [
                bitacoraId,
                ...solicitud.archivosIds
            ]);
        }

        await client.query('COMMIT');
        return solicitudId;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const getSolicitudesBitacoraById = async (
    userId: number,
    solicitudId: number,
    { limit, cursor, includeSeen, direction }: { limit: number; cursor?: number; includeSeen?: boolean; direction?: 'older' | 'newer' },
): Promise<PaginatedBitacoraResult> => {
    // Fetch one extra row to detect whether more pages exist.
    const fetchLimit = limit + 1;
    const older = direction !== 'newer';

    const params: unknown[] = [userId, solicitudId, fetchLimit];
    let cursorClause = '';
    if (cursor !== undefined) {
        params.push(cursor);
        cursorClause = `AND sb.id ${older ? '<' : '>'} $${params.length}`;
    }

    const seenClause = includeSeen ? '' : `AND sb.estado <> 'SEEN'`;

    const query = `
        WITH page_rows AS (
            SELECT
                sb.id,
                sb.fecha_inicio_nueva,
                sb.fecha_fin_nueva,
                sb.observacion,
                sb.created_at,
                sb.usuario_id,
                sb.estado,
                sb.reply_to_id,
                vu.nombre   AS usuario_nombre,
                vu.apellido AS usuario_apellido,
                v.seen_at
            FROM solicitudes_bitacora sb
            LEFT JOIN v_interno_users vu ON sb.usuario_id = vu.user_context_id
            LEFT JOIN solicitudes_bitacora_vistas v
                ON v.id_solicitud_bitacora = sb.id AND v.id_usuario_entidad = $1
            WHERE sb.solicitud_id = $2
              AND EXISTS (
                  SELECT 1 FROM solicitudes s
                  WHERE s.solicitud_id = $2
                    AND (
                        s.created_by = $1
                        OR EXISTS (
                            SELECT 1 FROM solicitudes_invitados si
                            WHERE si.id_solicitud = $2
                              AND si.id_usuario_invitado = $1
                              AND si.deleted_at IS NULL
                        )
                    )
              )
              ${seenClause}
              ${cursorClause}
            ORDER BY sb.id ${older ? 'DESC' : 'ASC'}
            LIMIT $3
        ),
        archivos_agg AS (
            SELECT
                pr.id AS bitacora_id,
                json_agg(
                    json_build_object(
                        'id',                  a.id,
                        'nombre',              a.nombre,
                        'ruta_r2',             a.ruta_r2,
                        'id_carpeta',          a.id_carpeta,
                        'tipo',                a.id_tipo,
                        'tamaño',              a.tamaño,
                        'titulo',              a.titulo,
                        'created_by',          a.created_by,
                        'creador_nombre',      vc.nombre,
                        'creador_apellido',    vc.apellido,
                        'opened_at',           aa_ap.creado_en,
                        'created_at',          a.created_at,
                        'id_tipo',             a.id_tipo,
                        'uso',                 a.uso,
                        'allowed_roles',       a.allowed_roles
                    ) ORDER BY a.created_at DESC
                ) AS archivos
            FROM page_rows pr
            JOIN solicitudes_bitacora_archivo ba ON ba.bitacora_id = pr.id
            JOIN archivos a
                ON  ba.archivo_id  = a.id
                AND a.deleted_at   IS NULL
            LEFT JOIN v_interno_users vc
                ON  a.created_by   = vc.user_context_id
            LEFT JOIN archivo_aperturas aa_ap
                ON  aa_ap.archivo_id = a.id
                AND aa_ap.usuario_id = $1
            GROUP BY pr.id
        ),
        vistas_agg AS (
            SELECT
                v.id_solicitud_bitacora AS bitacora_id,
                json_agg(
                    json_build_object(
                        'id_usuario', v.id_usuario_entidad,
                        'nombre',     vu2.nombre,
                        'apellido',   vu2.apellido,
                        'seen_at',    v.seen_at
                    ) ORDER BY v.seen_at
                ) AS seen_by
            FROM page_rows pr
            JOIN solicitudes_bitacora_vistas v ON v.id_solicitud_bitacora = pr.id
            LEFT JOIN v_interno_users vu2 ON vu2.user_context_id = v.id_usuario_entidad
            GROUP BY v.id_solicitud_bitacora
        )
        SELECT
            pr.*,
            COALESCE(aa.archivos, '[]') AS archivos,
            COALESCE(va.seen_by, '[]')  AS seen_by,
            CASE WHEN pr.reply_to_id IS NOT NULL THEN
                json_build_object(
                    'id',               replied.id,
                    'usuario_id',       replied.usuario_id,
                    'usuario_nombre',   vr.nombre,
                    'usuario_apellido', vr.apellido,
                    'observacion',      replied.observacion
                )
            END AS reply_to
        FROM page_rows pr
        LEFT JOIN archivos_agg aa ON pr.id = aa.bitacora_id
        LEFT JOIN vistas_agg va   ON pr.id = va.bitacora_id
        LEFT JOIN solicitudes_bitacora replied ON replied.id = pr.reply_to_id
        LEFT JOIN v_interno_users vr ON vr.user_context_id = replied.usuario_id
        ORDER BY pr.id ${older ? 'DESC' : 'ASC'}
    `;

    const res = await pool.query(query, params);

    const hasMore = res.rows.length > limit;
    const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
    const pageRows = older ? rows.reverse() : rows;

    const data: SolicitudBitacoraDTO[] = await firmarUrlsDeArchivos(pageRows.map(row => ({
        ...row,
        archivos: typeof row.archivos === 'string' ? JSON.parse(row.archivos) : row.archivos,
        seen_by: typeof row.seen_by === 'string' ? JSON.parse(row.seen_by) : row.seen_by,
        reply_to: typeof row.reply_to === 'string' ? JSON.parse(row.reply_to) : row.reply_to,
    })));

    const edge = older ? pageRows[0] : pageRows[pageRows.length - 1];
    const nextCursor = hasMore && edge ? Number(edge.id) : null;

    return { data, nextCursor };
};

export const getSolicitudesUnseenByUser = async (userId: number, type?: string): Promise<number> => {
    const tiposAFiltrar = buildTiposAFiltrar(type);
    const query = `
        WITH terminal_marks AS (
            SELECT solicitud_id, MAX(id) AS terminal_id
            FROM solicitudes_bitacora
            WHERE deleted_at IS NULL
              AND estado = 'ACTIVIDAD_CREADA'
            GROUP BY solicitud_id
        )
        SELECT COUNT(DISTINCT sb.solicitud_id) AS unseen_count
        FROM solicitudes_bitacora sb
        JOIN solicitudes s ON s.solicitud_id = sb.solicitud_id AND s.deleted_at IS NULL
        LEFT JOIN solicitudes_bitacora_vistas v
            ON v.id_solicitud_bitacora = sb.id AND v.id_usuario_entidad = $1
        LEFT JOIN terminal_marks tm ON tm.solicitud_id = sb.solicitud_id
        WHERE sb.deleted_at IS NULL
          AND sb.usuario_id <> $1
          AND sb.estado <> 'SEEN'
          AND v.id_solicitud_bitacora IS NULL
          AND (tm.terminal_id IS NULL OR sb.id > tm.terminal_id)
          AND s.tipo_actividad = ANY($2)
          AND EXISTS (
              SELECT 1 FROM solicitudes_invitados si
              WHERE si.id_solicitud = sb.solicitud_id
                AND si.id_usuario_invitado = $1
                AND si.deleted_at IS NULL
          )
    `;

    const res = await pool.query(query, [userId, tiposAFiltrar]);
    return parseInt(res.rows[0].unseen_count);
}

export const marcarBitacoraVisto = async (
    solicitudId: number,
    userId: number,
    { hastaId, client }: { hastaId?: number | null | undefined; client?: PoolClient | typeof pool } = {}
): Promise<void> => {
    const db = client ?? pool;
    const query = `
        INSERT INTO solicitudes_bitacora_vistas (id_usuario_entidad, id_solicitud_bitacora)
        SELECT $2, sb.id
        FROM solicitudes_bitacora sb
        WHERE sb.solicitud_id = $1
          AND sb.deleted_at IS NULL
          AND sb.usuario_id <> $2
          AND ($3::int IS NULL OR sb.id <= $3)
        ON CONFLICT DO NOTHING
    `;
    await db.query(query, [solicitudId, userId, hastaId ?? null]);
};

export const updateSolicitudInvitadoEstado = async (
    solicitudId: number,
    userId: number,
    estado: number | string,
    observacion: string,
    archivosIds?: number[],
    replyToId?: number | null
): Promise<SolicitudInfoDTO> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateInvitadoQuery = `
            UPDATE solicitudes_invitados
            SET estado = $3
            WHERE id_solicitud = $1 AND id_usuario_invitado = $2 AND deleted_at IS NULL
        `;
        await client.query(updateInvitadoQuery, [solicitudId, userId, String(estado)]);


        const insertBitacoraQuery = `
            INSERT INTO solicitudes_bitacora (solicitud_id, fecha_inicio_nueva, fecha_fin_nueva, usuario_id, created_at, observacion, estado, reply_to_id)
            VALUES ($1, NULL, NULL, $2, NOW(), $4, $3, $5)
            RETURNING id;
        `;
        const bitacoraRes = await client.query(insertBitacoraQuery, [solicitudId, userId, String(estado), observacion, replyToId ?? null]);
        const bitacoraId = bitacoraRes.rows[0]?.id;

        if (bitacoraId && archivosIds?.length) {
            const insertArchivosQuery = `
            INSERT INTO solicitudes_bitacora_archivo (bitacora_id, archivo_id)
            VALUES ${archivosIds
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertArchivosQuery, [
                bitacoraId,
                ...archivosIds
            ]);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    const solicitudRes = await pool.query('SELECT * FROM solicitudes WHERE solicitud_id = $1', [solicitudId]);
    return solicitudRes.rows[0];
};

export const reenviarSolicitud = async (
    solicitudId: number,
    nuevosInvitadosIds: number[],
    estado: string
): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertInvitadoQuery = `
            INSERT INTO solicitudes_invitados (id_solicitud, id_usuario_invitado, estado)
            VALUES ($1, $2, $3)
            ON CONFLICT (id_solicitud, id_usuario_invitado)
            DO UPDATE SET deleted_at = NULL
        `;

        for (const invitadoId of nuevosInvitadosIds) {
            await client.query(insertInvitadoQuery, [solicitudId, invitadoId, estado]);
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const updateSolicitudTitulo = async (solicitudId: number, titulo: string): Promise<void> => {
    await pool.query('UPDATE solicitudes SET titulo = $2 WHERE solicitud_id = $1', [solicitudId, titulo]);
};

export const updateSolicitudFechas = async (
    solicitudId: number,
    nuevaFechaInicio: Date,
    nuevaFechaFin: Date,
    usuarioId: number,
    observacion: string,
    estado: string,
    replyToId?: number | null
): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateSolicitudQuery = `
            UPDATE solicitudes
            SET fecha_inicio = $2, fecha_fin = $3
            WHERE solicitud_id = $1
        `;
        await client.query(updateSolicitudQuery, [solicitudId, nuevaFechaInicio, nuevaFechaFin]);

        const updateInvitadosQuery = `
            UPDATE solicitudes_invitados
            SET estado = $2
            WHERE id_solicitud = $1 AND deleted_at IS NULL
        `;
        await client.query(updateInvitadosQuery, [solicitudId, estado]);

        const insertBitacoraQuery = `
            INSERT INTO solicitudes_bitacora (solicitud_id, fecha_inicio_nueva, fecha_fin_nueva, usuario_id, created_at, observacion, estado, reply_to_id)
            VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
        `;
        await client.query(insertBitacoraQuery, [
            solicitudId,
            nuevaFechaInicio,
            nuevaFechaFin,
            usuarioId,
            observacion,
            estado,
            replyToId ?? null,
        ]);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const getSolicitudesByParticipante = async (
    userId: number,
    { limit, offset }: { limit: number; offset: number },
    type?: string
): Promise<{ data: SolicitudInfoDTO[]; total: number }> => {
    const tiposAFiltrar = buildTiposAFiltrar(type);

    const query = `
    WITH relevantes AS (
        SELECT s.solicitud_id, s.titulo, s.descripcion, s.fecha_inicio, s.fecha_fin,
               s.tipo_actividad, s.es_grupo, s.created_by, s.created_at
        FROM solicitudes s
        WHERE s.deleted_at IS NULL
          AND s.tipo_actividad = ANY($4)
          AND (
              s.created_by = $1
              OR EXISTS (
                  SELECT 1 FROM solicitudes_invitados si
                  WHERE si.id_solicitud = s.solicitud_id
                  AND si.id_usuario_invitado = $1
                  AND si.deleted_at IS NULL
              )
          )
    ),
    ultima_actividad AS (
        SELECT solicitud_id, MAX(created_at) AS bitacora_updated_at
        FROM solicitudes_bitacora
        WHERE deleted_at IS NULL
          AND solicitud_id IN (SELECT solicitud_id FROM relevantes)
        GROUP BY solicitud_id
    ),
    pagina AS (
        SELECT r.*,
               GREATEST(r.created_at, COALESCE(ua.bitacora_updated_at, r.created_at)) AS updated_at
        FROM relevantes r
        LEFT JOIN ultima_actividad ua ON ua.solicitud_id = r.solicitud_id
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
    ),
    bitacora_resumen AS (
        SELECT
            sb.solicitud_id,
            (array_agg(sb.observacion ORDER BY sb.id ASC)
                FILTER (WHERE sb.observacion IS NOT NULL AND sb.observacion <> ''))[1]  AS primer_mensaje,
            (array_agg(sb.observacion ORDER BY sb.id DESC)
                FILTER (WHERE sb.observacion IS NOT NULL AND sb.observacion <> ''))[1]  AS ultimo_mensaje,
            (array_agg(sb.fecha_inicio_nueva ORDER BY sb.id DESC)
                FILTER (WHERE sb.fecha_inicio_nueva IS NOT NULL))[1]                 AS fecha_inicio_prop,
            (array_agg(sb.fecha_fin_nueva ORDER BY sb.id DESC)
                FILTER (WHERE sb.fecha_fin_nueva IS NOT NULL))[1]                    AS fecha_fin_prop
        FROM pagina pg
        JOIN solicitudes_bitacora sb ON sb.solicitud_id = pg.solicitud_id AND sb.deleted_at IS NULL
        GROUP BY sb.solicitud_id
    ),
    -- Entrada más reciente de la bitácora (cualquier contenido, no solo texto):
    -- clasifica el preview de las listas (imagen/archivo/fecha/texto) y da el
    -- autor + hora para la flecha enviado/recibido.
    ultima_entrada AS (
        SELECT DISTINCT ON (sb.solicitud_id)
            sb.solicitud_id,
            sb.created_at AS ultimo_mensaje_at,
            sb.usuario_id AS ultimo_mensaje_autor_id,
            (sb.fecha_inicio_nueva IS NOT NULL OR sb.fecha_fin_nueva IS NOT NULL) AS es_cambio_fechas,
            EXISTS (
                SELECT 1 FROM solicitudes_bitacora_archivo ba
                JOIN archivos a ON a.id = ba.archivo_id AND a.deleted_at IS NULL
                WHERE ba.bitacora_id = sb.id
            ) AS tiene_archivos,
            EXISTS (
                SELECT 1 FROM solicitudes_bitacora_archivo ba
                JOIN archivos a ON a.id = ba.archivo_id AND a.deleted_at IS NULL
                WHERE ba.bitacora_id = sb.id
                  AND COALESCE(a.ruta_r2, a.nombre) ~* '\\.(jpe?g|png|webp|gif|heic|heif|bmp)($|\\?)'
            ) AS tiene_imagen
        FROM pagina pg
        JOIN solicitudes_bitacora sb ON sb.solicitud_id = pg.solicitud_id
            AND sb.deleted_at IS NULL
            -- 'SEEN' son entradas de sistema (marcado de lectura), no contenido
            -- real: si son la última fila, tapan el mensaje/archivo real.
            AND sb.estado <> 'SEEN'
        ORDER BY sb.solicitud_id, sb.id DESC
    ),
    terminal_marks AS (
        SELECT sb.solicitud_id, MAX(sb.id) AS terminal_id
        FROM pagina pg
        JOIN solicitudes_bitacora sb ON sb.solicitud_id = pg.solicitud_id
        WHERE sb.deleted_at IS NULL
          AND sb.estado = 'ACTIVIDAD_CREADA'
        GROUP BY sb.solicitud_id
    ),
    sin_ver AS (
        SELECT DISTINCT sb.solicitud_id
        FROM pagina pg
        JOIN solicitudes_bitacora sb ON sb.solicitud_id = pg.solicitud_id
        LEFT JOIN solicitudes_bitacora_vistas v
               ON v.id_solicitud_bitacora = sb.id
              AND v.id_usuario_entidad    = $1
        LEFT JOIN terminal_marks tm ON tm.solicitud_id = sb.solicitud_id
        WHERE sb.deleted_at IS NULL
          AND sb.usuario_id <> $1
          AND sb.estado <> 'SEEN'
          AND v.id_solicitud_bitacora IS NULL
          AND (tm.terminal_id IS NULL OR sb.id > tm.terminal_id)
    ),
    archivos_agg AS (
        SELECT
            sa.solicitud_id,
            json_agg(
                json_build_object(
                    'id',               a.id,
                    'nombre',           a.nombre,
                    'ruta_r2',          a.ruta_r2,
                    'id_carpeta',       a.id_carpeta,
                    'tipo',             a.id_tipo,
                    'tamaño',           a.tamaño,
                    'titulo',           a.titulo,
                    'created_by',       a.created_by,
                    'nombre_creador',   vc.nombre,
                    'apellido_creador', vc.apellido,
                    'created_at',       a.created_at
                ) ORDER BY a.created_at DESC
            ) FILTER (WHERE a.id IS NOT NULL) AS archivos
        FROM pagina pg
        JOIN archivos_solicitudes sa ON sa.solicitud_id = pg.solicitud_id
        JOIN archivos a ON sa.id = a.id AND a.deleted_at IS NULL
        LEFT JOIN v_interno_users vc ON a.created_by = vc.user_context_id
        GROUP BY sa.solicitud_id
    ),
    invitados_agg AS (
        SELECT
            si.id_solicitud,
            json_agg(
                json_build_object(
                    'id_usuario_invitado', si.id_usuario_invitado,
                    'nombre',              v.nombre,
                    'apellido',            v.apellido,
                    'estado',              si.estado
                )
            ) AS invitados
        FROM pagina pg
        JOIN solicitudes_invitados si ON si.id_solicitud = pg.solicitud_id
        JOIN v_interno_users v ON si.id_usuario_invitado = v.user_context_id
        WHERE si.deleted_at IS NULL
        GROUP BY si.id_solicitud
    )
    SELECT
        p.solicitud_id,
        p.titulo,
        COALESCE(p.descripcion, br.primer_mensaje)          AS descripcion,
        br.ultimo_mensaje,
        CASE
            WHEN ue.tiene_imagen THEN 'IMAGEN'
            WHEN ue.tiene_archivos THEN 'ARCHIVO'
            WHEN ue.es_cambio_fechas THEN 'FECHA'
            WHEN ue.solicitud_id IS NOT NULL THEN 'TEXT'
            ELSE NULL
        END                                                  AS ultimo_mensaje_tipo,
        ue.ultimo_mensaje_at,
        ue.ultimo_mensaje_autor_id,
        COALESCE(br.fecha_inicio_prop, p.fecha_inicio)      AS fecha_inicio,
        COALESCE(br.fecha_fin_prop, p.fecha_fin)            AS fecha_fin,
        p.tipo_actividad,
        p.es_grupo,
        p.created_by,
        p.created_at,
        vc.nombre                                           AS nombre_creador,
        vc.apellido                                         AS apellido_creador,
        (p.created_by = $1)                                 AS "isHost",
        (sv.solicitud_id IS NULL)                           AS seen,
        CASE
            WHEN sv.solicitud_id IS NOT NULL THEN COALESCE(si_self.estado, si_host.estado)::text
            WHEN p.created_by = $1 THEN
                CASE WHEN COALESCE(si_self.estado, si_host.estado)::text = 'MODIFIED'
                     THEN 'SEEN' ELSE COALESCE(si_self.estado, si_host.estado)::text END
            ELSE
                CASE WHEN si_self.estado::text IN ('SENT', 'MODIFIED_BY_HOST', 'ACCEPTED_BY_HOST')
                     THEN 'SEEN' ELSE si_self.estado::text END
        END                                                 AS estado,
        COALESCE(ia.invitados, '[]')                        AS invitados,
        COALESCE(aa.archivos, '[]')                         AS archivos,
        p.updated_at
    FROM pagina p
    LEFT JOIN v_interno_users vc   ON p.created_by = vc.user_context_id
    LEFT JOIN archivos_agg aa      ON p.solicitud_id = aa.solicitud_id
    LEFT JOIN invitados_agg ia     ON p.solicitud_id = ia.id_solicitud
    LEFT JOIN bitacora_resumen br  ON p.solicitud_id = br.solicitud_id
    LEFT JOIN ultima_entrada ue    ON p.solicitud_id = ue.solicitud_id
    LEFT JOIN sin_ver sv           ON p.solicitud_id = sv.solicitud_id
    LEFT JOIN LATERAL (
        SELECT estado
        FROM solicitudes_invitados
        WHERE id_solicitud = p.solicitud_id
          AND id_usuario_invitado = $1
        LIMIT 1
    ) si_self ON TRUE
    LEFT JOIN LATERAL (
        SELECT estado
        FROM solicitudes_invitados
        WHERE id_solicitud = p.solicitud_id
        ORDER BY id_usuario_invitado
        LIMIT 1
    ) si_host ON TRUE
    ORDER BY p.updated_at DESC
    `;

    const countQuery = `
        SELECT COUNT(*) as total
        FROM solicitudes s
        WHERE s.deleted_at IS NULL
        AND s.tipo_actividad = ANY($2)
          AND (
              s.created_by = $1 
              OR EXISTS (
                  SELECT 1 FROM solicitudes_invitados si 
                  WHERE si.id_solicitud = s.solicitud_id 
                  AND si.id_usuario_invitado = $1 
                  AND si.deleted_at IS NULL
              )
          )
    `;

    const [dataRes, countRes] = await Promise.all([
        pool.query(query, [userId, limit, offset, tiposAFiltrar]),
        pool.query(countQuery, [userId, tiposAFiltrar]),
    ]);

    // Mapeo para asegurar que los campos JSON se parseen si vienen como string (depende de tu driver de pg)
    const data = dataRes.rows.map(row => ({
        ...row,
        invitados: typeof row.invitados === 'string' ? JSON.parse(row.invitados) : row.invitados,
        archivos: typeof row.archivos === 'string' ? JSON.parse(row.archivos) : row.archivos,
    }));

    return {
        data,
        total: parseInt(countRes.rows[0].total, 10),
    };
};

export const getSolicitudById = async (solicitudId: number): Promise<any> => {
    const query = `
        SELECT *
        FROM solicitudes
        JOIN solicitudes_invitados ON solicitudes.solicitud_id = solicitudes_invitados.id_solicitud
        WHERE solicitudes.solicitud_id = $1
    `;
    const res = await pool.query(query, [solicitudId]);
    return res.rows[0];
};

export const getSolicitudDetalleById = async (
    solicitudId: number,
    userId: number
): Promise<SolicitudInfoDTO | null> => {
    const query = `
        WITH archivos_agg AS (
        SELECT
            sa.solicitud_id,
            json_agg(
                json_build_object(
                    'id',                  a.id,
                    'nombre',              a.nombre,
                    'ruta_r2',             a.ruta_r2,
                    'id_carpeta',          a.id_carpeta,
                    'tipo',                a.id_tipo,
                    'tamaño',              a.tamaño,
                    'titulo',              a.titulo,
                    'created_by',          a.created_by,
                    'creador_nombre',      vc.nombre,
                    'creador_apellido',    vc.apellido,
                    'opened_at',           aa_ap.creado_en,
                    'created_at',          a.created_at,
                    'id_tipo',             a.id_tipo,
                    'uso',                 a.uso,
                    'allowed_roles',       a.allowed_roles
                ) ORDER BY a.created_at DESC
            ) FILTER (WHERE a.id IS NOT NULL) AS archivos
            FROM archivos_solicitudes sa
            JOIN archivos a
                ON  sa.id  = a.id
                AND a.deleted_at   IS NULL
            LEFT JOIN v_interno_users vc
                ON  a.created_by   = vc.user_context_id
            LEFT JOIN archivo_aperturas aa_ap
                ON  aa_ap.archivo_id = a.id
                AND aa_ap.usuario_id = $2
            GROUP BY sa.solicitud_id
        )
        SELECT
            s.solicitud_id,
            s.titulo,
            s.descripcion,
            s.fecha_inicio,
            s.fecha_fin,
            s.created_by,
            s.tipo_actividad,
            s.es_grupo,
            si.estado,
            v.nombre                    AS nombre_creador,
            v.apellido                  AS apellido_creador,
            vi.nombre                   AS nombre_invitado,
            vi.apellido                 AS apellido_invitado,
            COALESCE(aa.archivos, '[]') AS archivos
        FROM solicitudes s
        LEFT JOIN solicitudes_invitados  si ON s.solicitud_id        = si.id_solicitud
        LEFT JOIN v_interno_users         v ON s.created_by          = v.user_context_id
        LEFT JOIN v_interno_users        vi ON si.id_usuario_invitado = vi.user_context_id
        LEFT JOIN archivos_agg           aa ON s.solicitud_id        = aa.solicitud_id
        WHERE
            s.solicitud_id = $1
            AND (s.created_by = $2 OR si.id_usuario_invitado = $2)
            AND si.deleted_at IS NULL
            AND s.deleted_at  IS NULL
    `;

    const res = await pool.query(query, [solicitudId, userId]);
    if (!res.rows.length) return null;

    const row = res.rows[0];
    return {
        ...row,
        archivos: typeof row.archivos === 'string'
            ? JSON.parse(row.archivos)
            : row.archivos,
    };
};

export const getNumeroInvitadosBySolicitudId = async (solicitudId: number): Promise<number> => {
    const query = `
        SELECT COUNT(*) AS numero_invitados, s.created_by
        FROM solicitudes_invitados si
        JOIN solicitudes s
        ON si.id_solicitud = s.solicitud_id
        WHERE si.id_solicitud = $1
        AND si.deleted_at IS NULL
        GROUP BY s.created_by
    `;
    const res = await pool.query(query, [solicitudId]);
    return parseInt(res.rows[0].numero_invitados);
}

export const cancelarSolicitud = async (solicitudId: number): Promise<void> => {
    const query = `
        UPDATE solicitudes
        SET deleted_at = NOW()
        WHERE solicitud_id = $1
          AND deleted_at IS NULL;
    `;
    await pool.query(query, [solicitudId]);
};

export const ocultarSolicitudDeInvitado = async (solicitudId: number, invitadoId: number): Promise<boolean> => {
    const query = `
        UPDATE solicitudes_invitados
        SET deleted_at = NOW()
        WHERE id_solicitud = $1
          AND id_usuario_invitado = $2
          AND deleted_at IS NULL
    `;

    const result = await pool.query(query, [solicitudId, invitadoId]);
    return (result.rowCount ?? 0) > 0;
};

export const aceptarCambiosBySolicitud = async (solicitudId: number, observacion?: string): Promise<void> => {
    const solicitud = await getSolicitudById(solicitudId);
    if (!solicitud) {
        throw new Error('Solicitud no encontrada.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateInvitadosQuery = `
            UPDATE solicitudes_invitados
            SET estado = $2
            WHERE id_solicitud = $1 AND deleted_at IS NULL
        `;
        await client.query(updateInvitadosQuery, [solicitudId, 'ACCEPTED_BY_HOST']);

        const insertBitacoraQuery = `
            INSERT INTO solicitudes_bitacora (solicitud_id, fecha_inicio_nueva, fecha_fin_nueva, usuario_id, created_at, observacion, estado)
            VALUES ($1, NULL, NULL, $2, NOW(), $3, $4)
        `;
        await client.query(insertBitacoraQuery, [solicitudId, Number(solicitud.created_by), observacion, 'ACCEPTED_BY_HOST']);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const updateByHost = async (
    solicitudId: number,
    userId: number,
    estado: string,
    observacion: string,
    archivosIds?: number[],
    replyToId?: number | null
): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const query = `
            UPDATE solicitudes_invitados
            SET estado = $2
            WHERE id_solicitud = $1
              AND deleted_at IS NULL
              AND (estado IS NULL OR estado <> 'ACTIVIDAD_CREADA')
        `;
        await client.query(query, [solicitudId, estado]);

        const insertBitacoraQuery = `
            INSERT INTO solicitudes_bitacora (solicitud_id, fecha_inicio_nueva, fecha_fin_nueva, usuario_id, created_at, observacion, estado, reply_to_id)
            VALUES ($1, NULL, NULL, $2, NOW(), $4, $3, $5)
            RETURNING id
        `;
        const bitacoraRes = await client.query(insertBitacoraQuery, [solicitudId, userId, estado, observacion, replyToId ?? null]);
        const bitacoraId = bitacoraRes.rows[0]?.id;

        if (bitacoraId && archivosIds?.length) {
            const insertArchivosQuery = `
            INSERT INTO solicitudes_bitacora_archivo (bitacora_id, archivo_id)
            VALUES ${archivosIds
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertArchivosQuery, [
                bitacoraId,
                ...archivosIds
            ]);
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/**
 * Obtiene los IDs de todos los participantes de una solicitud (creador + invitados)
 */
export const getParticipantesBySolicitudId = async (solicitudId: number): Promise<number[]> => {
    const query = `
        SELECT DISTINCT user_context_id
        FROM (
            SELECT created_by AS user_context_id
            FROM solicitudes
            WHERE solicitud_id = $1
            UNION
            SELECT id_usuario_invitado AS user_context_id
            FROM solicitudes_invitados
            WHERE id_solicitud = $1 AND deleted_at IS NULL
        ) participantes
    `;

    const result = await pool.query(query, [solicitudId]);
    return result.rows.map(row => row.user_context_id);
};

export const getBitacoraEntryRefById = async (
    id: number
): Promise<{ id: number; solicitud_id: number; reply_to_id: number | null } | null> => {
    const res = await pool.query(
        'SELECT id, solicitud_id, reply_to_id FROM solicitudes_bitacora WHERE id = $1',
        [id]
    );
    return res.rows[0] ?? null;
};

/**
 * Obtiene el estado actual de un invitado en una solicitud
 */
export const getEstadoInvitado = async (solicitudId: number, userId: number): Promise<string | null> => {
    const query = `
        SELECT estado FROM solicitudes_invitados
        WHERE id_solicitud = $1 AND id_usuario_invitado = $2 AND deleted_at IS NULL
    `;
    const res = await pool.query(query, [solicitudId, userId]);
    return res.rows[0]?.estado || null;
};

/**
 * Verifica si ya se creó una actividad para la solicitud
 */
export const tieneInvitadosConEstadoFinal = async (solicitudId: number): Promise<boolean> => {
    const query = `
        SELECT 1 FROM solicitudes_invitados
        WHERE id_solicitud = $1 AND deleted_at IS NULL AND estado = 'ACTIVIDAD_CREADA'
        LIMIT 1
    `;
    const res = await pool.query(query, [solicitudId]);
    return res.rows.length > 0;
};

/**
 * Obtiene los IDs de los usuarios invitados a una solicitud
 */
export const getInvitadosBySolicitudId = async (solicitudId: number): Promise<number[]> => {
    const query = `
        SELECT id_usuario_invitado AS user_context_id
        FROM solicitudes_invitados
        WHERE id_solicitud = $1 AND deleted_at IS NULL
    `;

    const result = await pool.query(query, [solicitudId]);
    return result.rows.map(row => row.user_context_id);
};

/**
 * IDs de invitados que ya aceptaron la solicitud (excluye al creador, que
 * nunca tiene fila propia en solicitudes_invitados). Usado para no crear
 * actividades/objetivos para quien todavía no aceptó.
 */
export const getInvitadosAceptadosBySolicitudId = async (solicitudId: number): Promise<number[]> => {
    const query = `
        SELECT id_usuario_invitado AS user_context_id
        FROM solicitudes_invitados
        WHERE id_solicitud = $1 AND deleted_at IS NULL AND estado = 'ACCEPTED'
    `;

    const result = await pool.query(query, [solicitudId]);
    return result.rows.map(row => row.user_context_id);
};

export const existeSolicitudChatActiva = async (userId1: number, userId2: number): Promise<number | null> => {
    const query = `
        SELECT s.solicitud_id
        FROM solicitudes s
        WHERE s.tipo_actividad = 'CHAT'
          AND s.deleted_at IS NULL
          AND s.es_grupo IS NOT TRUE
          AND EXISTS (
              SELECT 1 FROM solicitudes_invitados
              WHERE id_solicitud = s.solicitud_id
                AND id_usuario_invitado = $1
                AND deleted_at IS NULL
                AND (estado IS NULL OR estado <> 'ACTIVIDAD_CREADA')
          )
          AND EXISTS (
              SELECT 1 FROM solicitudes_invitados
              WHERE id_solicitud = s.solicitud_id
                AND id_usuario_invitado = $2
                AND deleted_at IS NULL
                AND (estado IS NULL OR estado <> 'ACTIVIDAD_CREADA')
          )
          AND (
              SELECT COUNT(*) FROM solicitudes_invitados si
              WHERE si.id_solicitud = s.solicitud_id
                AND si.deleted_at IS NULL
                AND (si.estado IS NULL OR si.estado <> 'ACTIVIDAD_CREADA')
          ) = 2
        LIMIT 1
    `;
    const res = await pool.query(query, [userId1, userId2]);
    return res.rows[0]?.solicitud_id ?? null;
};

export const buscarSolicitudes = async (
    searchTerm: string,
    userId: number,
    type?: 'MANDATO' | 'CHAT' | 'REUNION',
): Promise<(SolicitudInfoDTO & { match_priority: number })[]> => {
    const tiposAFiltrar = buildTiposAFiltrar(type);
    const query = `
        WITH participantes_busqueda AS (
            SELECT
                si.id_solicitud,
                string_agg(vu.nombre || ' ' || vu.apellido, ' ') AS nombres_participantes
            FROM solicitudes_invitados si
            JOIN v_interno_users vu ON vu.user_context_id = si.id_usuario_invitado
            WHERE si.id_usuario_invitado != $2
              AND si.deleted_at IS NULL
            GROUP BY si.id_solicitud
        ),
        ultima_bitacora AS (
            SELECT DISTINCT ON (solicitud_id)
                solicitud_id,
                created_at AS bitacora_updated_at
            FROM solicitudes_bitacora
            WHERE deleted_at IS NULL
            ORDER BY solicitud_id, created_at DESC
        ),
        archivos_agg AS (
            SELECT
                sa.solicitud_id,
                json_agg(
                    json_build_object(
                        'id',               a.id,
                        'nombre',           a.nombre,
                        'ruta_r2',          a.ruta_r2,
                        'id_carpeta',       a.id_carpeta,
                        'tipo',             a.id_tipo,
                        'tamaño',           a.tamaño,
                        'titulo',           a.titulo,
                        'created_by',       a.created_by,
                        'nombre_creador',   vc.nombre,
                        'apellido_creador', vc.apellido,
                        'created_at',       a.created_at
                    ) ORDER BY a.created_at DESC
                ) FILTER (WHERE a.id IS NOT NULL) AS archivos
            FROM archivos_solicitudes sa
            JOIN archivos a ON sa.id = a.id AND a.deleted_at IS NULL
            LEFT JOIN v_interno_users vc ON a.created_by = vc.user_context_id
            GROUP BY sa.solicitud_id
        ),
        invitados_agg AS (
            SELECT
                si.id_solicitud,
                json_agg(
                    json_build_object(
                        'id_usuario_invitado', si.id_usuario_invitado,
                        'nombre',              v.nombre,
                        'apellido',            v.apellido,
                        'estado',              si.estado
                    )
                ) AS invitados
            FROM solicitudes_invitados si
            JOIN v_interno_users v ON si.id_usuario_invitado = v.user_context_id
            WHERE si.deleted_at IS NULL
            GROUP BY si.id_solicitud
        ),
        -- Mismo cómputo de "seen"/"estado"/preview de descripción y último
        -- mensaje que getSolicitudesByParticipante (el listado normal), para que
        -- un resultado de búsqueda no muestre un estado sin ver ya visto en el
        -- listado, ni una descripción vacía cuando el contenido real vive en la
        -- bitácora (chats sin solicitudes.descripcion), ni el primer mensaje como
        -- preview en lugar del último.
        bitacora_resumen AS (
            SELECT
                sb.solicitud_id,
                (array_agg(sb.observacion ORDER BY sb.id ASC)
                    FILTER (WHERE sb.observacion IS NOT NULL AND sb.observacion <> ''))[1] AS primer_mensaje,
                (array_agg(sb.observacion ORDER BY sb.id DESC)
                    FILTER (WHERE sb.observacion IS NOT NULL AND sb.observacion <> ''))[1] AS ultimo_mensaje
            FROM solicitudes_bitacora sb
            WHERE sb.deleted_at IS NULL
            GROUP BY sb.solicitud_id
        ),
        terminal_marks AS (
            SELECT sb.solicitud_id, MAX(sb.id) AS terminal_id
            FROM solicitudes_bitacora sb
            WHERE sb.deleted_at IS NULL
              AND sb.estado = 'ACTIVIDAD_CREADA'
            GROUP BY sb.solicitud_id
        ),
        sin_ver AS (
            SELECT DISTINCT sb.solicitud_id
            FROM solicitudes_bitacora sb
            LEFT JOIN solicitudes_bitacora_vistas v
                   ON v.id_solicitud_bitacora = sb.id
                  AND v.id_usuario_entidad    = $2
            LEFT JOIN terminal_marks tm ON tm.solicitud_id = sb.solicitud_id
            WHERE sb.deleted_at IS NULL
              AND sb.usuario_id <> $2
              AND sb.estado <> 'SEEN'
              AND v.id_solicitud_bitacora IS NULL
              AND (tm.terminal_id IS NULL OR sb.id > tm.terminal_id)
        )
        SELECT
            s.solicitud_id,
            s.titulo,
            COALESCE(s.descripcion, br.primer_mensaje)           AS descripcion,
            br.ultimo_mensaje,
            CASE
                WHEN ue.tiene_imagen THEN 'IMAGEN'
                WHEN ue.tiene_archivos THEN 'ARCHIVO'
                WHEN ue.es_cambio_fechas THEN 'FECHA'
                WHEN ue.solicitud_id IS NOT NULL THEN 'TEXT'
                ELSE NULL
            END                                                  AS ultimo_mensaje_tipo,
            ue.ultimo_mensaje_at,
            ue.ultimo_mensaje_autor_id,
            s.fecha_inicio,
            s.fecha_fin,
            s.tipo_actividad,
            s.es_grupo,
            s.created_by,
            s.created_at,
            vc.nombre                                            AS nombre_creador,
            vc.apellido                                          AS apellido_creador,
            (s.created_by = $2)                                  AS "isHost",
            (sv.solicitud_id IS NULL)                            AS seen,
            CASE
                WHEN sv.solicitud_id IS NOT NULL THEN COALESCE(si_self.estado, si_host.estado)::text
                WHEN s.created_by = $2 THEN
                    CASE WHEN COALESCE(si_self.estado, si_host.estado)::text = 'MODIFIED'
                         THEN 'SEEN' ELSE COALESCE(si_self.estado, si_host.estado)::text END
                ELSE
                    CASE WHEN si_self.estado::text IN ('SENT', 'MODIFIED_BY_HOST', 'ACCEPTED_BY_HOST')
                         THEN 'SEEN' ELSE si_self.estado::text END
            END                                                  AS estado,
            COALESCE(ia.invitados, '[]')                         AS invitados,
            COALESCE(aa.archivos, '[]')                          AS archivos,
            GREATEST(s.created_at, COALESCE(ub.bitacora_updated_at, s.created_at)) AS updated_at,
            CASE
                WHEN to_tsvector('spanish', COALESCE(p.nombres_participantes, '')) @@ plainto_tsquery('spanish', $1) THEN 1
                WHEN to_tsvector('spanish', COALESCE(s.titulo, ''))                @@ plainto_tsquery('spanish', $1) THEN 2
                WHEN to_tsvector('spanish', COALESCE(s.descripcion, ''))           @@ plainto_tsquery('spanish', $1) THEN 3
                ELSE 4
            END AS match_priority
        FROM solicitudes s
        LEFT JOIN v_interno_users vc        ON s.created_by   = vc.user_context_id
        LEFT JOIN archivos_agg aa           ON s.solicitud_id = aa.solicitud_id
        LEFT JOIN invitados_agg ia          ON s.solicitud_id = ia.id_solicitud
        LEFT JOIN ultima_bitacora ub        ON s.solicitud_id = ub.solicitud_id
        LEFT JOIN participantes_busqueda p  ON s.solicitud_id = p.id_solicitud
        LEFT JOIN bitacora_resumen br       ON s.solicitud_id = br.solicitud_id
        LEFT JOIN sin_ver sv                ON s.solicitud_id = sv.solicitud_id
        -- Entrada más reciente de la bitácora (como ultima_entrada del listado):
        -- tipo de preview y autor + hora. LATERAL: solo corre para los resultados.
        LEFT JOIN LATERAL (
            SELECT
                sb.solicitud_id,
                sb.created_at AS ultimo_mensaje_at,
                sb.usuario_id AS ultimo_mensaje_autor_id,
                (sb.fecha_inicio_nueva IS NOT NULL OR sb.fecha_fin_nueva IS NOT NULL) AS es_cambio_fechas,
                EXISTS (
                    SELECT 1 FROM solicitudes_bitacora_archivo ba
                    JOIN archivos a ON a.id = ba.archivo_id AND a.deleted_at IS NULL
                    WHERE ba.bitacora_id = sb.id
                ) AS tiene_archivos,
                EXISTS (
                    SELECT 1 FROM solicitudes_bitacora_archivo ba
                    JOIN archivos a ON a.id = ba.archivo_id AND a.deleted_at IS NULL
                    WHERE ba.bitacora_id = sb.id
                      AND COALESCE(a.ruta_r2, a.nombre) ~* '\\.(jpe?g|png|webp|gif|heic|heif|bmp)($|\\?)'
                ) AS tiene_imagen
            FROM solicitudes_bitacora sb
            WHERE sb.solicitud_id = s.solicitud_id
              AND sb.deleted_at IS NULL
              -- 'SEEN' son entradas de sistema (marcado de lectura), no contenido real
              AND sb.estado <> 'SEEN'
            ORDER BY sb.id DESC
            LIMIT 1
        ) ue ON TRUE
        LEFT JOIN LATERAL (
            SELECT estado
            FROM solicitudes_invitados
            WHERE id_solicitud = s.solicitud_id
              AND id_usuario_invitado = $2
            LIMIT 1
        ) si_self ON TRUE
        LEFT JOIN LATERAL (
            SELECT estado
            FROM solicitudes_invitados
            WHERE id_solicitud = s.solicitud_id
            ORDER BY id_usuario_invitado
            LIMIT 1
        ) si_host ON TRUE
        WHERE s.deleted_at IS NULL
          AND s.tipo_actividad = ANY($4)
          AND (
              s.created_by = $2
              OR EXISTS (
                  SELECT 1 FROM solicitudes_invitados si
                  WHERE si.id_solicitud = s.solicitud_id
                    AND si.id_usuario_invitado = $2
                    AND si.deleted_at IS NULL
              )
          )
          AND (
              to_tsvector('spanish', COALESCE(p.nombres_participantes, '')) @@ plainto_tsquery('spanish', $1)
              OR to_tsvector('spanish', COALESCE(s.titulo, ''))             @@ plainto_tsquery('spanish', $1)
              OR to_tsvector('spanish', COALESCE(s.descripcion, ''))        @@ plainto_tsquery('spanish', $1)
              OR p.nombres_participantes ILIKE $3
              OR s.titulo                ILIKE $3
              OR s.descripcion           ILIKE $3
          )
        ORDER BY match_priority, updated_at DESC
    `;
    const res = await pool.query(query, [searchTerm, userId, `%${searchTerm}%`, tiposAFiltrar]);
    return res.rows.map(row => ({
        ...row,
        invitados: typeof row.invitados === 'string' ? JSON.parse(row.invitados) : row.invitados,
        archivos: typeof row.archivos === 'string' ? JSON.parse(row.archivos) : row.archivos,
    }));
};

/**
 * Returns the archivos attached to a CHAT-type solicitud.
 * Returns an empty array if the solicitud does not exist, is not tipo CHAT,
 * or the user is not a participant.
 */
export const getArchivosBySolicitudChatId = async (
    solicitudId: number,
    userId: number,
): Promise<ArchivoDTO[]> => {
    const query = `
        SELECT DISTINCT ON (a.id)
            a.id,
            a.nombre,
            a.ruta_r2,
            a.id_carpeta,
            a.id_tipo                 AS tipo,
            a.tamaño,
            a.titulo,
            a.created_by,
            vc.nombre                 AS creador_nombre,
            vc.apellido               AS creador_apellido,
            aa_ap.creado_en           AS opened_at,
            a.created_at,
            a.id_tipo,
            a.uso,
            a.allowed_roles
        FROM solicitudes_bitacora sb
        -- 1. Conectamos la bitácora con la tabla intermedia de sus archivos
        JOIN solicitudes_bitacora_archivo sba
            ON  sba.bitacora_id = sb.id
        -- 2. Conectamos con la tabla de archivos reales
        JOIN archivos a
            ON  sba.archivo_id  = a.id
            AND a.deleted_at    IS NULL
        LEFT JOIN v_interno_users vc
            ON  a.created_by    = vc.user_context_id
        LEFT JOIN archivo_aperturas aa_ap
            ON  aa_ap.archivo_id = a.id
            AND aa_ap.usuario_id = $2
        JOIN solicitudes s
            ON  sb.solicitud_id = s.solicitud_id
        WHERE sb.solicitud_id    = $1  -- Filtramos la bitácora por la solicitud correcta
        AND s.tipo_actividad   = 'CHAT'
        AND s.deleted_at       IS NULL
        AND (
            s.created_by = $2
            OR EXISTS (
                SELECT 1 FROM solicitudes_invitados si
                WHERE si.id_solicitud      = $1
                    AND si.id_usuario_invitado = $2
                    AND si.deleted_at         IS NULL
            )
        )
        ORDER BY a.id, a.created_at DESC;
    `;
    const res = await pool.query(query, [solicitudId, userId]);
    return res.rows;
};

export const buscarBitacora = async (
    userId: number,
    { q, solicitudId, limit, cursor }: { q?: string; solicitudId?: number; limit: number; cursor?: number },
): Promise<PaginatedBitacoraResult> => {
    const params: unknown[] = [userId, limit + 1];
    let filters = '';

    if (solicitudId !== undefined) {
        params.push(solicitudId);
        filters += ` AND sb.solicitud_id = $${params.length}`;
    }

    if (q) {
        const palabras = q.trim().split(/\s+/).filter(Boolean);
        const condiciones = palabras.map((palabra) => {
            params.push(`%${palabra}%`, palabra);
            const ilikeIdx = params.length - 1;
            const rawIdx = params.length;
            return `(
                sb.observacion ILIKE $${ilikeIdx}
                OR to_tsvector('spanish', COALESCE(sb.observacion, '')) @@ plainto_tsquery('spanish', $${rawIdx})
                OR sb.observacion % $${rawIdx}
            )`;
        }).join(' AND ');
        filters += ` AND (${condiciones})`;
    }

    if (cursor !== undefined) {
        params.push(cursor);
        filters += ` AND sb.id < $${params.length}`;
    }

    const query = `
        SELECT
            sb.id,
            sb.solicitud_id,
            sb.observacion,
            sb.created_at,
            sb.usuario_id,
            sb.estado,
            vu.nombre   AS usuario_nombre,
            vu.apellido AS usuario_apellido
        FROM solicitudes_bitacora sb
        LEFT JOIN v_interno_users vu ON sb.usuario_id = vu.user_context_id
        WHERE sb.deleted_at IS NULL
          AND EXISTS (
              SELECT 1 FROM solicitudes s
              WHERE s.solicitud_id = sb.solicitud_id
                AND s.deleted_at   IS NULL
                AND (
                    s.created_by = $1
                    OR EXISTS (
                        SELECT 1 FROM solicitudes_invitados si
                        WHERE si.id_solicitud        = sb.solicitud_id
                          AND si.id_usuario_invitado = $1
                          AND si.deleted_at          IS NULL
                    )
                )
          )
          ${filters}
        ORDER BY sb.id DESC
        LIMIT $2
    `;

    const res = await pool.query(query, params);

    const hasMore = res.rows.length > limit;
    const data: SolicitudBitacoraDTO[] = hasMore ? res.rows.slice(0, limit) : res.rows;
    const last = data[data.length - 1];

    return { data, nextCursor: hasMore && last ? Number(last.id) : null };
};

export const esParticipanteDeSolicitud = async (solicitudId: number, userId: number): Promise<boolean> => {
    const query = `
        SELECT 1
        FROM (
            SELECT created_by AS user_context_id FROM solicitudes WHERE solicitud_id = $1
            UNION
            SELECT id_usuario_invitado FROM solicitudes_invitados WHERE id_solicitud = $1 AND deleted_at IS NULL
        ) participantes
        WHERE user_context_id = $2
        LIMIT 1
    `;
    const res = await pool.query(query, [solicitudId, userId]);
    return res.rows.length > 0;
};

export const addInvitadosToSolicitud = async (solicitudId: number, invitados: number[]): Promise<void> => {
    const query = `
        INSERT INTO solicitudes_invitados (id_solicitud, id_usuario_invitado, estado)
        VALUES ${invitados.map((_, i) => `($1, $${i + 2}, 'SENT')`).join(', ')}
        ON CONFLICT (id_solicitud, id_usuario_invitado) DO UPDATE SET deleted_at = NULL, estado = 'SENT'
    `;
    await pool.query(query, [solicitudId, ...invitados]);
};

export const removeInvitadosFromSolicitud = async (solicitudId: number, invitados: number[]): Promise<boolean> => {
    const query = `
        UPDATE solicitudes_invitados
        SET deleted_at = NOW()
        WHERE id_solicitud = $1 AND id_usuario_invitado = ANY($2) AND deleted_at IS NULL
    `;
    const result = await pool.query(query, [solicitudId, invitados]);
    return (result.rowCount ?? 0) > 0;
};

/**
 * Marca todos los invitados de una solicitud con estado 'ACTIVIDAD_CREADA'
 */
export const marcarSolicitudActividadCreada = async (solicitudId: number): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateQuery = `
            UPDATE solicitudes_invitados
            SET estado = 'ACTIVIDAD_CREADA'
            WHERE id_solicitud = $1 AND deleted_at IS NULL
        `;
        await client.query(updateQuery, [solicitudId]);

        const insertBitacoraQuery = `
            INSERT INTO solicitudes_bitacora (solicitud_id, usuario_id, created_at, estado)
            SELECT solicitud_id, created_by, NOW(), 'ACTIVIDAD_CREADA'
            FROM solicitudes
            WHERE solicitud_id = $1
        `;
        await client.query(insertBitacoraQuery, [solicitudId]);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};
