import { pool } from './pgClient';
import { ObjetivoDTO, BitacoraDTO, CreateObjetivoDTO } from '../../domain/dto/ObjetivoDTO';

export const getObjetivos = async (userContextId: number) => {
    const query = `
        SELECT
        o.*,
        u_creador.username as created_by_username,
        (ou_filter.last_seen_at IS NOT NULL) as seen,

        COALESCE(i.invitados, '[]') as invitados,
        COALESCE(bi.bitacora, '[]') as bitacora,
        COALESCE(ar.archivos, '[]') as archivos

        FROM objetivos o

        INNER JOIN objetivos_usuarios ou_filter
            ON ou_filter.objetivo_id = o.id
        AND ou_filter.user_context_id = $1

        -- 👇 PARTICIPANTES
        LEFT JOIN LATERAL (
            SELECT json_agg(DISTINCT jsonb_build_object(
                'user_id', ou.user_context_id,
                'invitado_nombre', viu.nombre,
                'invitado_apellido', viu.apellido,
                'username', viu.username,
                'email', viu.email,
                'rol', ou.rol
            )) as invitados
            FROM objetivos_usuarios ou
            LEFT JOIN v_interno_users viu 
                ON ou.user_context_id = viu.user_context_id
            WHERE ou.objetivo_id = o.id
        ) i ON true

        -- 👇 BITÁCORA
        LEFT JOIN LATERAL (
            SELECT json_agg(
                jsonb_build_object(
                    'id', b.id,
                    'estado_anterior', b.estado_anterior,
                    'estado_nuevo', b.estado_nuevo,
                    'observacion', b.observacion,
                    'created_at', b.created_at,
                    'appointment', b.appointment,
                    -- Quien hizo la acción (cambio de estado o asignó)
                    'usuario_id', b.usuario_id,
                    'usuario_nombre', CONCAT(u_actor.nombre, ' ', u_actor.apellido),
                    -- A quién se asignó
                    'assignee_id', b.asignee,
                    'assignee_nombre', CONCAT(u_asignee.nombre, ' ', u_asignee.apellido)
            ) ORDER BY b.created_at DESC
                ) as bitacora
            FROM objetivos_bitacora b
            LEFT JOIN v_interno_users ue_actor
                ON b.usuario_id = ue_actor.user_context_id
            LEFT JOIN usuarios u_actor
                ON ue_actor.id_usuario = u_actor.id
            LEFT JOIN v_interno_users ue_asignee
                ON b.asignee = ue_asignee.user_context_id
            LEFT JOIN usuarios u_asignee
                ON ue_asignee.id_usuario = u_asignee.id
            WHERE b.objetivo_id = o.id
        ) bi ON true

        -- 👇 ARCHIVOS
        LEFT JOIN LATERAL (
            SELECT json_agg(DISTINCT jsonb_build_object(
                'id', a.id,
                'nombre', a.nombre,
                'url', a.ruta_r2,
                'tipo', a.id_tipo,
                'tamaño', a.tamaño
            )) as archivos
            FROM archivos_objetivos ao
            LEFT JOIN archivos a 
                ON ao.id = a.id
            WHERE ao.objetivo_id = o.id
        ) ar ON true

        -- 👇 CREADOR
        LEFT JOIN v_interno_users ue_creador 
            ON o.created_by = ue_creador.user_context_id
        LEFT JOIN usuarios u_creador 
            ON ue_creador.id_usuario = u_creador.id

        WHERE o.deleted_at IS NULL

        ORDER BY o.rank_position ASC;
    `;
    const result = await pool.query(query, [userContextId]);
    return result.rows;
};

export const createObjetivo = async (objetivo: CreateObjetivoDTO, rank_position: string, created_by: number) => {
    const client = await pool.connect();
    const { titulo, descripcion, estado } = objetivo;

    try {
        await client.query('BEGIN');

        const query = `
            INSERT INTO objetivos (titulo, descripcion, estado, rank_position, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;

        const result = await client.query(query, [titulo, descripcion, estado, rank_position, created_by]);
        const nuevoObjetivo = result.rows[0];

        if (objetivo.invitados?.length) {
            const insertCompartidosQuery = `
            INSERT INTO objetivos_usuarios (objetivo_id, user_context_id, rol, last_seen_at)
            VALUES ${objetivo.invitados
                    .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
        `;

            await client.query(insertCompartidosQuery, [
                nuevoObjetivo.id,
                ...objetivo.invitados.flatMap(invitado => [
                    invitado.user_id,
                    invitado.rol,
                    invitado.user_id === created_by ? new Date() : null,
                ])
            ]);
        }

        if (objetivo.archivosIds?.length) {
            const insertArchivosQuery = `
            INSERT INTO archivos_objetivos (objetivo_id, id)
            VALUES ${objetivo.archivosIds
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertArchivosQuery, [
                nuevoObjetivo.id,
                ...objetivo.archivosIds
            ]);
        }

        await client.query('COMMIT');
        return nuevoObjetivo;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
};

export const updateObjetivo = async (id: number, objetivo: Partial<ObjetivoDTO>): Promise<ObjetivoDTO | null> => {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (objetivo.titulo !== undefined) {
        fields.push(`titulo = $${paramCount++}`);
        values.push(objetivo.titulo);
    }
    if (objetivo.descripcion !== undefined) {
        fields.push(`descripcion = $${paramCount++}`);
        values.push(objetivo.descripcion);
    }
    if (objetivo.estado !== undefined) {
        fields.push(`estado = $${paramCount++}`);
        values.push(objetivo.estado);
    }
    if (objetivo.rank_position !== undefined) {
        fields.push(`rank_position = $${paramCount++}`);
        values.push(objetivo.rank_position);
    }
    if (objetivo.updated_by !== undefined) {
        fields.push(`updated_by = $${paramCount++}`);
        values.push(objetivo.updated_by);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    if (fields.length === 0) return null;

    values.push(id);
    const query = `
        UPDATE objetivos
        SET ${fields.join(', ')}
        WHERE id = $${paramCount} AND deleted_at IS NULL
        RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
};

export const deleteObjetivo = async (id: number, deleted_by: number) => {
    const query = `
        UPDATE objetivos
        SET deleted_at = CURRENT_TIMESTAMP, updated_by = $2
        WHERE id = $1
    `;
    await pool.query(query, [id, deleted_by]);
};

export const addBitacora = async (bitacora: Partial<BitacoraDTO> & { objetivo_id: number }) => {
    const { objetivo_id, estado_anterior, estado_nuevo, observacion } = bitacora;
    const query = `
        INSERT INTO objetivos_bitacora (objetivo_id, usuario_id, estado_anterior, estado_nuevo, observacion)
        VALUES ($1, $2, $3, $4, $5)
    `;
    await pool.query(query, [objetivo_id, bitacora.usuario_id, estado_anterior, estado_nuevo, observacion]);
};

export const getObjetivoById = async (id: number): Promise<ObjetivoDTO | null> => {
    const query = `SELECT * FROM objetivos WHERE id = $1 AND deleted_at IS NULL`;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
};

export const getMinRank = async (): Promise<string | null> => {
    const query = `SELECT min(rank_position) as min_rank FROM objetivos WHERE deleted_at IS NULL`;
    const result = await pool.query(query);
    return result.rows[0].min_rank;
};

export const getMaxRank = async (): Promise<string | null> => {
    const query = `SELECT max(rank_position) as max_rank FROM objetivos WHERE deleted_at IS NULL`;
    const result = await pool.query(query);
    return result.rows[0].max_rank;
};

export const editTituloObjetivo = async (id: number, titulo: string, updated_by: number) => {
    const query = `
        UPDATE objetivos
        SET titulo = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING *
    `;
    const result = await pool.query(query, [titulo, updated_by, id]);
    return result.rows[0] || null;
};

export const editDescripcionObjetivo = async (id: number, descripcion: string, updated_by: number) => {
    const query = `
        UPDATE objetivos
        SET descripcion = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING *
    `;
    const result = await pool.query(query, [descripcion, updated_by, id]);
    return result.rows[0] || null;
};

export const addArchivoToObjetivo = async (objetivo_id: number, archivo_id: number[]) => {
    const query = `
        INSERT INTO archivos_objetivos (objetivo_id, id)
        VALUES ${archivo_id.map((_, i) => `($1, $${i + 2})`).join(', ')}
        ON CONFLICT DO NOTHING;
    `;
    await pool.query(query, [objetivo_id, ...archivo_id]);
};

export const removeArchivoFromObjetivo = async (objetivo_id: number, archivo_id: number[]) => {
    const query = `
        DELETE FROM archivos_objetivos
        WHERE objetivo_id = $1 AND id = ANY($2)
    `;

    // Borrado lógico del archivo
    const deleteArchivoQuery = `
        UPDATE archivos
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1)
    `;

    await pool.query(deleteArchivoQuery, [archivo_id]);
    await pool.query(query, [objetivo_id, archivo_id]);
};

export const markObjetivoAsSeen = async (objetivo_id: number, user_context_id: number) => {
    const query = `
        UPDATE objetivos_usuarios
        SET last_seen_at = NOW()
        WHERE objetivo_id = $1 AND user_context_id = $2
    `;
    await pool.query(query, [objetivo_id, user_context_id]);
};

export const getInvitadosByObjetivoId = async (objetivo_id: number): Promise<{ user_id: number; rol: string }[]> => {
    const query = `
        SELECT user_context_id as user_id, rol
        FROM objetivos_usuarios
        WHERE objetivo_id = $1
    `;
    const result = await pool.query(query, [objetivo_id]);
    return result.rows;
};

export const addInvitadosToObjetivo = async (objetivo_id: number, invitados: { user_id: number; rol: string }[]) => {
    const query = `
        INSERT INTO objetivos_usuarios (objetivo_id, user_context_id, rol)
        VALUES ${invitados.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ')}
        ON CONFLICT (objetivo_id, user_context_id) DO UPDATE SET rol = EXCLUDED.rol;
    `;
    await pool.query(query, [objetivo_id, ...invitados.flatMap(inv => [inv.user_id, inv.rol])]);
};

export const removeInvitadosFromObjetivo = async (objetivo_id: number, invitados: { user_id: number; rol: string }[]) => {
    const query = `
        DELETE FROM objetivos_usuarios
        WHERE objetivo_id = $1 AND user_context_id = $2
    `;
    for (const invitado of invitados) {
        await pool.query(query, [objetivo_id, invitado.user_id]);
    }
};

export const addAsignadosToBitacora = async (
    objetivo_id: number,
    user_context_ids: number[],
    creador_id: number,
    appointment: 'ASSIGN' | 'DISCHARGE'
) => {
    const query = `
        INSERT INTO objetivos_bitacora (objetivo_id, asignee, usuario_id, appointment)
        VALUES ${user_context_ids.map((_, i) => `($1, $${i + 2}, $${user_context_ids.length + 2}, $${user_context_ids.length + 3})`).join(', ')}
        ON CONFLICT DO NOTHING;
    `;
    await pool.query(query, [objetivo_id, ...user_context_ids, creador_id, appointment]);
};  