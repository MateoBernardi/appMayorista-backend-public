import { pool } from './pgClient';
import { ActividadDTO } from '../../domain/dto/ActividadDTO';
import { ActividadDetalleDTO } from '../../domain/dto/ActividadDTO';
import { LicenciaDTO } from '../../domain/dto/LicenciaDTO';


export const createActividad = async (actividadData: Omit<ActividadDTO, 'actividad_id'>): Promise<ActividadDTO> => {
    const query = `
        INSERT INTO actividades (titulo, descripcion, fecha_inicio, fecha_fin, solicitud_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `;
    const values = [
        actividadData.titulo,
        actividadData.descripcion,
        actividadData.fecha_inicio,
        actividadData.fecha_fin,
        actividadData.solicitud_id
    ];
    const res = await pool.query(query, values);
    return res.rows[0];
};

export const addActividadParticipante = async (
    actividadId: number,
    userId: number,
    rol: number,
): Promise<void> => {
    const query = `
        INSERT INTO actividades_participantes (id_actividad, id_usuario_participante, rol)
        VALUES ($1, $2, $3)
        ON CONFLICT (id_actividad, id_usuario_participante) DO NOTHING
    `;
    await pool.query(query, [actividadId, userId, rol]);
};

export const createActividadConParticipantes = async (
    actividadData: Omit<ActividadDTO, 'actividad_id'>,
    guestId: number,
    hostId: number,
): Promise<ActividadDTO> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Crear la actividad
        const actividadQuery = `
            INSERT INTO actividades (titulo, descripcion, fecha_inicio, fecha_fin, solicitud_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const actividadValues = [
            actividadData.titulo,
            actividadData.descripcion,
            actividadData.fecha_inicio,
            actividadData.fecha_fin,
            actividadData.solicitud_id
        ];
        const actividadResult = await client.query(actividadQuery, actividadValues);
        const actividad = actividadResult.rows[0];

        // Agregar el participante guest (invitado)
        const participanteQuery = `
            INSERT INTO actividades_participantes (id_actividad, id_usuario_participante, rol)
            VALUES ($1, $2, $3)
            ON CONFLICT (id_actividad, id_usuario_participante) DO NOTHING
        `;
        await client.query(participanteQuery, [actividad.id, guestId, 'guest']); // rol 2 = guest
        await client.query(participanteQuery, [actividad.id, hostId, 'host']); // rol 1 = host

        await client.query('COMMIT');
        return actividad;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const createActividadConMultiplesParticipantes = async (
    actividadData: Omit<ActividadDTO, 'actividad_id'>,
    hostId: number,
    guestIds: number[],
): Promise<ActividadDTO> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const actividadQuery = `
            INSERT INTO actividades (titulo, descripcion, fecha_inicio, fecha_fin, solicitud_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const actividadValues = [
            actividadData.titulo,
            actividadData.descripcion,
            actividadData.fecha_inicio,
            actividadData.fecha_fin,
            actividadData.solicitud_id,
        ];
        const actividadResult = await client.query(actividadQuery, actividadValues);
        const actividad = actividadResult.rows[0];

        const participanteQuery = `
            INSERT INTO actividades_participantes (id_actividad, id_usuario_participante, rol)
            VALUES ($1, $2, $3)
            ON CONFLICT (id_actividad, id_usuario_participante) DO NOTHING
        `;

        // Agregar el host (creador de la solicitud)
        await client.query(participanteQuery, [actividad.id, hostId, 'host']);

        // Agregar todos los invitados como guests
        for (const guestId of guestIds) {
            await client.query(participanteQuery, [actividad.id, guestId, 'guest']);
        }

        if (actividad && actividadData.archivos?.length) {
            const insertArchivosQuery = `
            INSERT INTO solicitudes_bitacora_archivo (bitacora_id, archivo_id)
            VALUES ${actividadData.archivos
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertArchivosQuery, [
                actividad.id,
                ...actividadData.archivos.map(a => a.id)
            ]);
        }

        await client.query('COMMIT');
        return actividad;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const createActividadConParticipante = async (
    actividadData: Omit<ActividadDTO, 'actividad_id'>,
    userId: number,
    rol: string,
): Promise<ActividadDTO> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Crear la actividad
        const actividadQuery = `
            INSERT INTO actividades (titulo, descripcion, fecha_inicio, fecha_fin, solicitud_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const actividadValues = [
            actividadData.titulo,
            actividadData.descripcion,
            actividadData.fecha_inicio,
            actividadData.fecha_fin,
            actividadData.solicitud_id
        ];
        const actividadResult = await client.query(actividadQuery, actividadValues);
        const actividad = actividadResult.rows[0];

        // Agregar el participante
        const participanteQuery = `
            INSERT INTO actividades_participantes (id_actividad, id_usuario_participante, rol)
            VALUES ($1, $2, $3)
            ON CONFLICT (id_actividad, id_usuario_participante) DO NOTHING
        `;
        await client.query(participanteQuery, [actividad.id, userId, rol]);

        if (actividad && actividadData.archivos?.length) {
            const insertArchivosQuery = `
            INSERT INTO solicitudes_bitacora_archivo (bitacora_id, archivo_id)
            VALUES ${actividadData.archivos
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertArchivosQuery, [
                actividad.id,
                ...actividadData.archivos.map(a => a.id)
            ]);
        }

        await client.query('COMMIT');
        return actividad;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const getActividadesByUser = async (
    userId: number,
    fechaInicio?: Date,
    fechaFin?: Date,
): Promise<{ actividades: ActividadDTO[], licencias: LicenciaDTO[] }> => {
    const tienePeriodo = Boolean(fechaInicio && fechaFin);

    const actividadesValues: any[] = [userId];
    const licenciasValues: any[] = [userId];

    let actividadesFiltroPeriodo = '';
    let licenciasFiltroPeriodo = '';

    if (tienePeriodo) {
        // Solapamiento de rangos con el período solicitado.
        actividadesValues.push(fechaFin, fechaInicio);
        licenciasValues.push(fechaFin, fechaInicio);

        actividadesFiltroPeriodo = `
                    AND a.fecha_inicio <= $2
                    AND (a.fecha_fin IS NULL OR a.fecha_fin >= $3)
                `;

        licenciasFiltroPeriodo = `
                    AND sa.fecha_inicio <= $2
                    AND sa.fecha_fin >= $3
                `;
    }

    const actividadesQuery = `
                SELECT a.*, ap.rol
                FROM actividades a
                JOIN actividades_participantes ap ON a.id = ap.id_actividad
                WHERE ap.id_usuario_participante = $1
                    AND a.deleted_at IS NULL
                    ${actividadesFiltroPeriodo}
                ORDER BY a.fecha_inicio DESC
        `;
    const actividadesRes = await pool.query(actividadesQuery, actividadesValues);

    const licenciasQuery = `
                SELECT sa.id, sa.usuario_id, sa.tipo_licencia_id, tl.nombre as tipo_licencia_nombre, sa.fecha_inicio, sa.fecha_fin, sa.cantidad_dias, sa.created_at, sa.updated_at
                FROM solicitudes_ausencia sa
                JOIN tipos_licencia tl ON sa.tipo_licencia_id = tl.id
                WHERE sa.usuario_id = $1
                    AND sa.estado IN ('APROBADA')
                    AND sa.deleted_at IS NULL
                    ${licenciasFiltroPeriodo}
                ORDER BY sa.fecha_inicio DESC
        `;
    const licenciasRes = await pool.query(licenciasQuery, licenciasValues);

    return {
        actividades: actividadesRes.rows,
        licencias: licenciasRes.rows
    };
};

export const getActividadById = async (actividadId: number): Promise<any | null> => {
    const query = `
        SELECT *
        FROM actividades
        WHERE id = $1
          AND deleted_at IS NULL
    `;
    const res = await pool.query(query, [actividadId]);
    return res.rows[0] ?? null;
};

export const getActividadDetalleByIdConParticipantes = async (
    actividadId: number,
): Promise<ActividadDetalleDTO | null> => {
    const query = `
        SELECT
            a.id AS actividad_id,
            a.titulo,
            a.descripcion,
            a.fecha_inicio,
            a.fecha_fin,
            a.solicitud_id,
            COALESCE(p.participantes, '[]'::json) AS participantes,
            COALESCE(ar.archivos, '[]'::json) AS archivos
        FROM actividades a

        -- 1. Subconsulta para Participantes (se mantiene igual)
        LEFT JOIN (
            SELECT 
                ap.id_actividad,
                json_agg(
                    json_build_object(
                        'id_usuario_participante', ap.id_usuario_participante,
                        'rol', ap.rol,
                        'nombre', vu.nombre,
                        'apellido', vu.apellido
                    )
                ) AS participantes
            FROM actividades_participantes ap
            LEFT JOIN v_interno_users vu ON vu.user_context_id = ap.id_usuario_participante
            GROUP BY ap.id_actividad
        ) p ON p.id_actividad = a.id

        -- 2. Subconsulta para Archivos (con todos los campos de ArchivoDTO)
        LEFT JOIN (
            SELECT 
                aa.actividad_id, -- actividad_id viene de la tabla pivot archivos_actividades
                json_agg(
                    json_build_object(
                        'id', arc.id,
                        'nombre', arc.nombre,
                        'ruta_r2', arc.ruta_r2,
                        'id_carpeta', arc.id_carpeta,
                        'tamaño', arc.tamaño,
                        'titulo', arc.titulo,
                        'created_by', arc.created_by,
                        'creador_nombre', vuc.nombre,
                        'creador_apellido', vuc.apellido,
                        'created_at', arc.created_at,
                        'id_tipo', arc.id_tipo,
                        'uso', arc.uso,
                        'allowed_roles', arc.allowed_roles,
                        -- Nota: 'tipo' y 'id_usuario_asociado' no figuran en tu lista de columnas de la tabla.
                        -- Si 'id_tipo' es el número, quizás 'tipo' sea un string que debas traer de otra tabla.
                        -- Los agrego como null o placeholders si no están en la tabla física.
                        'tipo', arc.id_tipo::text 
                    )
                ) AS archivos
            FROM archivos_actividades aa
            INNER JOIN archivos arc ON arc.id = aa.id -- Asumiendo que la columna en la pivot es id_archivo
            LEFT JOIN v_interno_users vuc ON vuc.user_context_id = arc.created_by
            WHERE arc.deleted_at IS NULL
            GROUP BY aa.actividad_id
        ) ar ON ar.actividad_id = a.id

        WHERE a.id = $1
        AND a.deleted_at IS NULL;
    `;

    const res = await pool.query(query, [actividadId]);
    return (res.rows[0] as ActividadDetalleDTO) ?? null;
};

export const esCreadorDeActividad = async (actividadId: number, userId: number): Promise<boolean> => {
    const query = `
        SELECT 1
        FROM actividades_participantes
        WHERE id_actividad = $1
          AND id_usuario_participante = $2
          AND rol = 'host'
        LIMIT 1
    `;
    const res = await pool.query(query, [actividadId, userId]);
    return res.rows.length > 0;
};

export const esParticipanteDeActividad = async (actividadId: number, userId: number): Promise<boolean> => {
    const query = `
        SELECT 1
        FROM actividades_participantes
        WHERE id_actividad = $1
          AND id_usuario_participante = $2
        LIMIT 1
    `;
    const res = await pool.query(query, [actividadId, userId]);
    return res.rows.length > 0;
};

export const eliminarActividadPorId = async (actividadId: number): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const deleteParticipantesQuery = `
            DELETE FROM actividades_participantes
            WHERE id_actividad = $1
        `;
        await client.query(deleteParticipantesQuery, [actividadId]);

        const deleteActividadQuery = `
            UPDATE actividades
            SET deleted_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const res = await client.query(deleteActividadQuery, [actividadId]);

        if (res.rowCount === 0) {
            throw new Error('No se encontró la actividad.');
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const eliminarParticipanteDeActividad = async (actividadId: number, userId: number): Promise<void> => {
    const query = `
        DELETE FROM actividades_participantes
        WHERE id_actividad = $1
          AND id_usuario_participante = $2
    `;
    const res = await pool.query(query, [actividadId, userId]);
    if (res.rowCount === 0) {
        throw new Error('No se encontró al participante en la actividad.');
    }
};

export const cancelarActividadesPasadas = async (): Promise<number> => {
    const query = `
        UPDATE actividades
        SET deleted_at = NOW()
        WHERE fecha_inicio < NOW()
        AND deleted_at IS NULL
    `;
    const res = await pool.query(query);
    return res.rowCount || 0;
};

export const actualizarHorariosActividad = async (
    actividadId: number,
    userId: number,
    nuevaFechaInicio: Date,
    nuevaFechaFin?: Date
): Promise<ActividadDTO> => {
    const query = `
        UPDATE actividades
        SET fecha_inicio = $2, fecha_fin = $3
        WHERE id = $1
        AND deleted_at IS NULL
        RETURNING *
    `;
    const res = await pool.query(query, [actividadId, nuevaFechaInicio, nuevaFechaFin]);
    if (res.rowCount === 0) {
        throw new Error('No se encontró la actividad.');
    }
    return res.rows[0];
};

export const getActividadesSolicitudById = async (actividadId: number): Promise<any> => {
    const query = `
        SELECT a.*, s.*
        FROM actividades a
        LEFT JOIN solicitudes s
        ON a.solicitud_id = s.solicitud_id
        WHERE a.actividad_id = $1;
    `;
    const res = await pool.query(query, [actividadId]);
    return res.rows;
}

/**
 * Obtiene el user_context_id del participante con rol 'host' de una actividad
 */
export const getHostDeActividad = async (actividadId: number): Promise<number | null> => {
    const query = `
        SELECT id_usuario_participante
        FROM actividades_participantes
        WHERE id_actividad = $1 AND rol = 'host'
        LIMIT 1
    `;
    const res = await pool.query(query, [actividadId]);
    return res.rows[0]?.id_usuario_participante || null;
};

/**
 * Obtiene los IDs de usuarios participantes de una actividad
 */
export const getParticipantesByActividadId = async (actividadId: number): Promise<number[]> => {
    const query = `
        SELECT id_usuario_participante
        FROM actividades_participantes
        WHERE id_actividad = $1
    `;
    const res = await pool.query(query, [actividadId]);
    return res.rows.map((row) => row.id_usuario_participante);
};

/**
 * Obtiene actividades próximas (dentro de los próximos 25 minutos) que aún no fueron notificadas,
 * junto con sus participantes.
 */
export const getActividadesProximasSinNotificar = async (): Promise<{
    actividad_id: number;
    titulo: string;
    fecha_inicio: Date;
    participantes: number[];
}[]> => {
    const query = `
        SELECT 
            a.id as actividad_id,
            a.titulo,
            a.fecha_inicio,
            ARRAY_AGG(ap.id_usuario_participante) as participantes
        FROM actividades a
        JOIN actividades_participantes ap ON a.id = ap.id_actividad
        WHERE a.deleted_at IS NULL
          AND a.notificacion_enviada = FALSE
          AND a.fecha_inicio BETWEEN NOW() AND NOW() + INTERVAL '25 minutes'
        GROUP BY a.id, a.titulo, a.fecha_inicio
    `;
    const res = await pool.query(query);
    return res.rows;
};

/**
 * Marca una actividad como notificada para no enviar duplicados.
 */
export const marcarActividadNotificada = async (actividadId: number): Promise<void> => {
    await pool.query(
        `UPDATE actividades SET notificacion_enviada = TRUE WHERE id = $1`,
        [actividadId]
    );
};

export const addArchivoToActividad = async (actividad_id: number, archivo_id: number[]) => {
    const query = `
        INSERT INTO archivos_actividades (actividad_id, id)
        VALUES ${archivo_id.map((_, i) => `($1, $${i + 2})`).join(', ')}
        ON CONFLICT DO NOTHING;
    `;
    await pool.query(query, [actividad_id, ...archivo_id]);
};

export const removeArchivoFromActividad = async (actividad_id: number, archivo_id: number[]) => {
    const query = `
        DELETE FROM archivos_actividades
        WHERE actividad_id = $1 AND id = ANY($2)
    `;

    // Borrado lógico del archivo
    const deleteArchivoQuery = `
        UPDATE archivos
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1)
    `;

    await pool.query(deleteArchivoQuery, [archivo_id]);
    await pool.query(query, [actividad_id, archivo_id]);
};

export const addInvitadosToActividad = async (actividad_id: number, invitados: { user_context_id: number; rol: string }[]) => {
    const query = `
        INSERT INTO actividades_participantes (id_actividad, id_usuario_participante, rol)
        VALUES ${invitados.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ')}
        ON CONFLICT (id_actividad, id_usuario_participante) DO UPDATE SET rol = EXCLUDED.rol;
    `;
    await pool.query(query, [actividad_id, ...invitados.flatMap(inv => [inv.user_context_id, inv.rol])]);
};

export const removeInvitadosFromActividad = async (actividad_id: number, invitados: { user_context_id: number; rol: string }[]) => {
    const query = `
        DELETE FROM actividades_participantes
        WHERE id_actividad = $1 AND id_usuario_participante = $2
    `;
    for (const invitado of invitados) {
        await pool.query(query, [actividad_id, invitado.user_context_id]);
    }
};
