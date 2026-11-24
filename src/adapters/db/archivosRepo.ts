import { pool } from './pgClient';
import { ArchivoDTO, ArchivoUso, CrearArchivoDTO, UpdateArchivoDTO } from '../../domain/dto/ArchivoDTO';

export interface ArchivoAclData {
    id: number;
    owner_id: number;
    allowed_roles: string[];
    allowed_users: number[];
    allowed_user_names: string[];
}

export interface ArchivoViewerData {
    user_context_id: number;
    nombre: string;
    apellido: string;
    visto_en: Date;
}

export const getArchivoById = async (id: number) => {
    const query = `
    SELECT a.id, a.nombre, a.ruta_r2, a.id_carpeta, a.tamaño, a.titulo, t.nombre as tipo, a.created_by, a.created_at
    FROM archivos a
    LEFT JOIN archivos_tipos t ON a.id_tipo = t.id
    WHERE a.deleted_at IS NULL AND a.id = $1;
  `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
}

export const existsArchivoByRutaR2 = async (rutaR2: string): Promise<boolean> => {
    const { rows } = await pool.query(
        'SELECT 1 FROM archivos WHERE ruta_r2 = $1 AND deleted_at IS NULL LIMIT 1',
        [rutaR2]
    );
    return rows.length > 0;
}

export const getArchivosUnseenByUser = async (userContextId: number, role: string) => {
    const query = `
        SELECT COUNT(*) AS unseen_count
        FROM archivos a
        LEFT JOIN archivos_visibilidad_usuario avu ON avu.archivo_id = a.id AND avu.usuario_id = $1
        LEFT JOIN archivo_aperturas aa ON aa.archivo_id = a.id AND aa.usuario_id = $1
        WHERE a.deleted_at IS NULL
          AND a.uso = 'EMPRESA'
          AND aa.archivo_id IS NULL
          AND (a.created_by = $1 OR avu.usuario_id IS NOT NULL OR $2 = ANY(a.allowed_roles))
          AND (
              a.id_carpeta IS NULL
              OR EXISTS (
                  WITH RECURSIVE folder_chain AS (
                      SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles
                      FROM carpetas c
                      WHERE c.id = a.id_carpeta AND c.deleted_at IS NULL
                      UNION ALL
                      SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles
                      FROM carpetas p
                      INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
                      WHERE p.deleted_at IS NULL
                  )
                  SELECT 1
                  FROM folder_chain fc
                  LEFT JOIN carpeta_visibilidad_usuario cvu
                      ON cvu.id_carpeta = fc.id
                      AND cvu.id_usuario = $1
                      AND cvu.deleted_at IS NULL
                  GROUP BY 1
                  HAVING bool_and(
                      fc.id_usuario = $1
                      OR $2 = ANY(fc.allowed_roles)
                      OR cvu.id_usuario IS NOT NULL
                  )
              )
          )
    `;
    const { rows } = await pool.query(query, [userContextId, role]);
    return parseInt(rows[0].unseen_count, 10);
}

export const getArchivosPersonales = async (userContextId: number) => {
    const query = `
    SELECT a.id, a.nombre, a.ruta_r2, a.id_carpeta, a.tamaño, a.titulo, t.nombre as tipo, a.created_by, a.created_at,
              v.nombre as creador_nombre, v.apellido as creador_apellido, aa.creado_en as opened_at
    FROM archivos a
    LEFT JOIN archivos_tipos t ON a.id_tipo = t.id
    LEFT JOIN v_usuario_entidad_completo v ON a.created_by = v.user_context_id
    LEFT JOIN archivo_aperturas aa ON aa.archivo_id = a.id AND aa.usuario_id = $1
    WHERE (a.created_by = $1 AND a.deleted_at IS NULL)
      AND a.uso = 'EMPRESA'
            AND (
                a.id_carpeta IS NULL
                OR EXISTS (
                    WITH RECURSIVE folder_chain AS (
                        SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles
                        FROM carpetas c
                        WHERE c.id = a.id_carpeta AND c.deleted_at IS NULL
                        UNION ALL
                        SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles
                        FROM carpetas p
                        INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
                        WHERE p.deleted_at IS NULL
                    )
                    SELECT 1
                    FROM folder_chain fc
                    LEFT JOIN carpeta_visibilidad_usuario cvu
                        ON cvu.id_carpeta = fc.id
                        AND cvu.id_usuario = $1
                        AND cvu.deleted_at IS NULL
                    GROUP BY 1
                    HAVING bool_and(
                        fc.id_usuario = $1
                        OR EXISTS (
                            SELECT 1
                            FROM v_usuario_entidad_completo vue
                            WHERE vue.user_context_id = $1
                                AND vue.rol_nombre = ANY(fc.allowed_roles)
                        )
                        OR cvu.id_usuario IS NOT NULL
                    )
                )
            )
    ORDER BY a.created_at DESC;
  `;
    const { rows } = await pool.query(query, [userContextId]);
    return rows;
}

export const getArchivos = async (userRole: string, userContextId: number) => {
    const query = `
    SELECT a.id, a.nombre, a.ruta_r2, a.id_carpeta, a.tamaño, a.titulo, t.nombre as tipo, a.created_by, a.created_at, a.allowed_roles,
        v.nombre as creador_nombre, v.apellido as creador_apellido, aa.creado_en as opened_at
    FROM archivos a
    LEFT JOIN archivos_tipos t ON a.id_tipo = t.id
    LEFT JOIN v_usuario_entidad_completo v ON a.created_by = v.user_context_id
    LEFT JOIN archivos_visibilidad_usuario avu ON avu.archivo_id = a.id AND avu.usuario_id = $2
    LEFT JOIN archivo_aperturas aa ON aa.archivo_id = a.id AND aa.usuario_id = $2
    WHERE a.deleted_at IS NULL
      AND a.uso = 'EMPRESA'
      AND (a.created_by = $2 OR avu.usuario_id IS NOT NULL OR $1 = ANY(a.allowed_roles))
            AND (
                a.id_carpeta IS NULL
                OR EXISTS (
                    WITH RECURSIVE folder_chain AS (
                        SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles
                        FROM carpetas c
                        WHERE c.id = a.id_carpeta AND c.deleted_at IS NULL
                        UNION ALL
                        SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles
                        FROM carpetas p
                        INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
                        WHERE p.deleted_at IS NULL
                    )
                    SELECT 1
                    FROM folder_chain fc
                    LEFT JOIN carpeta_visibilidad_usuario cvu
                        ON cvu.id_carpeta = fc.id
                        AND cvu.id_usuario = $2
                        AND cvu.deleted_at IS NULL
                    GROUP BY 1
                    HAVING bool_and(
                        fc.id_usuario = $2
                        OR $1 = ANY(fc.allowed_roles)
                        OR cvu.id_usuario IS NOT NULL
                    )
                )
            )
    ORDER BY a.created_at DESC;
  `;
    const { rows } = await pool.query(query, [userRole, userContextId]);
    return rows;
}

// Get or create tipo ID based on MIME type
export const getOrCreateTipoId = async (mimeType: string): Promise<number> => {
    // Map common MIME types to tipo names
    const tipoMap: { [key: string]: string } = {
        'application/pdf': 'pdf',
        'application/msword': 'word',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
        'application/vnd.ms-excel': 'excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
        'image/jpeg': 'imagen',
        'image/png': 'imagen',
        'image/gif': 'imagen',
        'image/webp': 'imagen',
        'text/plain': 'texto',
        'application/zip': 'comprimido',
        'application/x-zip-compressed': 'comprimido'
    };

    const tipoNombre = tipoMap[mimeType] || 'otro';

    try {
        // First try to find existing tipo
        const findQuery = `SELECT id FROM archivos_tipos WHERE nombre = $1`;
        const findResult = await pool.query(findQuery, [tipoNombre]);

        if (findResult.rows.length > 0) {
            return findResult.rows[0].id;
        }

        // If not found, create new tipo
        const insertQuery = `INSERT INTO archivos_tipos (nombre) VALUES ($1) RETURNING id`;
        const insertResult = await pool.query(insertQuery, [tipoNombre]);
        return insertResult.rows[0].id;
    } catch (error) {
        // Return a default tipo ID (assuming 'otro' exists or fallback to 1)
        return 1;
    }
}

export const createArchivo = async (archivo: CrearArchivoDTO) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const idTipo = await getOrCreateTipoId(archivo.tipo);

        const insertArchivoQuery = `
        INSERT INTO archivos (
            nombre,
            ruta_r2,
            id_carpeta,
            id_tipo,
            tamaño,
            titulo,
            created_by,
            allowed_roles,
            uso,
            created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id;
        `;

        const { rows } = await client.query(insertArchivoQuery, [
            archivo.nombre,
            archivo.ruta_r2,
            archivo.id_carpeta ?? null,
            idTipo,
            archivo.tamaño,
            archivo.titulo,
            archivo.created_by,
            archivo.allowed_roles ?? [],
            archivo.uso ?? ArchivoUso.EMPRESA
        ]);

        const archivoId = rows[0].id;

        if (archivo.usuarios_compartidos?.length) {
            const insertCompartidosQuery = `
            INSERT INTO archivos_visibilidad_usuario (archivo_id, usuario_id)
            VALUES ${archivo.usuarios_compartidos
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
        `;

            await client.query(insertCompartidosQuery, [
                archivoId,
                ...archivo.usuarios_compartidos
            ]);
        }

        if (archivo.usuarios_asociados?.length) {
            const insertAsociadosQuery = `
            INSERT INTO archivos_asociados_usuario (archivo_id, usuario_id)
            VALUES ${archivo.usuarios_asociados
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
        `;

            await client.query(insertAsociadosQuery, [
                archivoId,
                ...archivo.usuarios_asociados
            ]);
        }

        await client.query('COMMIT');

        // Fetch the complete archivo with JOINs after commit
        const archivoCompleto = await getArchivoById(archivoId);
        return archivoCompleto;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const deleteArchivo = async (id: number, userContextId: number) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(`
        UPDATE archivos
        SET deleted_at = NOW()
        WHERE id = $1
        AND created_by = $2-- Asegura que solo el creador pueda eliminar (o agregar lógica de roles aquí)
        AND deleted_at IS NULL; -- Evita "eliminar" un archivo ya eliminado
        `, [id, userContextId]);

        // 2. Eliminar compartidos explícitos
        await client.query(`
        DELETE FROM archivos_visibilidad_usuario
        WHERE archivo_id = $1;
        `, [id]);

        // 3. Eliminar asociaciones silenciosas
        await client.query(`
        DELETE FROM archivos_asociados_usuario
        WHERE archivo_id = $1;
        `, [id]);
        // await client.query(`INSERT INTO auditoria (...) VALUES (...)`);

        await client.query('COMMIT');
        return { id };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};


export const updateArchivo = async (
    userContextId: number,
    id: number,
    data: Partial<UpdateArchivoDTO>
) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        //UPDATE de archivos
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;

        if (data.nombre !== undefined) {
            fields.push(`nombre = $${i++}`);
            values.push(data.nombre);
        }

        if (data.titulo !== undefined) {
            fields.push(`titulo = $${i++}`);
            values.push(data.titulo);
        }

        if (data.allowed_roles !== undefined) {
            fields.push(`allowed_roles = $${i++}`);
            values.push(data.allowed_roles);
        }

        let archivo;

        // Limpiar relaciones anteriores si se están actualizando
        if (data.usuarios_compartidos !== undefined) {
            await client.query(
                `
                DELETE FROM archivos_visibilidad_usuario
                WHERE archivo_id = $1;
                `,
                [id]
            );
        }

        if (data.usuarios_asociados !== undefined) {
            await client.query(
                `
                DELETE FROM archivos_asociados_usuario
                WHERE archivo_id = $1;
                `,
                [id]
            );
        }

        if (fields.length > 0) {
            values.push(id);
            values.push(userContextId);

            const { rows } = await client.query(
                `
            UPDATE archivos
            SET ${fields.join(', ')}
            WHERE id = $${i}
            AND created_by = $${i + 1}
            AND deleted_at IS NULL
            RETURNING *;
            `,
                values
            );

            archivo = rows[0];
        }

        //Usuarios compartidos
        if (data.usuarios_compartidos !== undefined) {

            if (data.usuarios_compartidos.length > 0) {
                const inserts = data.usuarios_compartidos.map(
                    (userId) =>
                        client.query(
                            `
                    INSERT INTO archivos_visibilidad_usuario (archivo_id, usuario_id)
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING;
                    `,
                            [id, userId]
                        )
                );
                await Promise.all(inserts);
            }
        }

        //Usuarios asociados
        if (data.usuarios_asociados !== undefined) {

            if (data.usuarios_asociados.length > 0) {
                const inserts = data.usuarios_asociados.map(
                    (userId) =>
                        client.query(
                            `
                    INSERT INTO archivos_asociados_usuario (archivo_id, usuario_id)
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING;
                    `,
                            [id, userId]
                        )
                );
                await Promise.all(inserts);
            }
        }

        await client.query('COMMIT');
        return archivo ?? (await getArchivoById(id));
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};


export const getArchivoByIdAsociado = async (id_usuario_buscado: number, currentUserId: number, userRole: string) => {
    const query = `
    SELECT 
    a.id,
    a.nombre,
    a.ruta_r2,
    a.id_carpeta,
    a.titulo,
    a.tamaño,
    t.nombre AS tipo,
    a.created_by,
    a.created_at,
    a.allowed_roles,
    u.nombre AS creador_nombre,
    u.apellido AS creador_apellido
FROM archivos a
LEFT JOIN archivos_tipos t 
    ON a.id_tipo = t.id
LEFT JOIN v_interno_users u 
    ON a.created_by = u.user_context_id

-- relación con la persona buscada (Y)
LEFT JOIN archivos_asociados_usuario aa_objetivo
    ON aa_objetivo.archivo_id = a.id
   AND aa_objetivo.usuario_id = $1   -- persona buscada (Y)

-- visibilidad para el usuario consultante (X)
LEFT JOIN archivos_visibilidad_usuario avu_x
    ON avu_x.archivo_id = a.id
   AND avu_x.usuario_id = $2         -- usuario X

WHERE 
    a.deleted_at IS NULL
    AND a.uso = 'EMPRESA'

    -- (1) el archivo pertenece o está asociado a la persona buscada
    AND (
        a.created_by = $1
        OR aa_objetivo.usuario_id IS NOT NULL
    )

    -- (2) el usuario X tiene permiso para verlo
    AND (
        a.created_by = $2
        OR avu_x.usuario_id IS NOT NULL
        OR $3 = ANY(a.allowed_roles)
    )
        AND (
            a.id_carpeta IS NULL
            OR EXISTS (
                WITH RECURSIVE folder_chain AS (
                    SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles
                    FROM carpetas c
                    WHERE c.id = a.id_carpeta AND c.deleted_at IS NULL
                    UNION ALL
                    SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles
                    FROM carpetas p
                    INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
                    WHERE p.deleted_at IS NULL
                )
                SELECT 1
                FROM folder_chain fc
                LEFT JOIN carpeta_visibilidad_usuario cvu
                    ON cvu.id_carpeta = fc.id
                    AND cvu.id_usuario = $2
                    AND cvu.deleted_at IS NULL
                GROUP BY 1
                HAVING bool_and(
                    fc.id_usuario = $2
                    OR $3 = ANY(fc.allowed_roles)
                    OR cvu.id_usuario IS NOT NULL
                )
            )
        )

ORDER BY a.created_at DESC;
  `;
    const { rows } = await pool.query(query, [id_usuario_buscado, currentUserId, userRole]);
    return rows;
}

export const searchArchivosByPersona = async (searchTerm: string, userRole: string, currentUserId: number) => {
    const query = `
    WITH found_users AS (
        SELECT ue.user_context_id, u.nombre, u.apellido
        FROM usuarios u
        INNER JOIN v_usuario_entidad_completo ue ON u.id = ue.id_usuario
        WHERE 
            to_tsvector('spanish', COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellido, '')) @@ plainto_tsquery('spanish', $1)
            OR u.nombre ILIKE $3
            OR u.apellido ILIKE $3
            OR ue.username ILIKE $3
    )
    SELECT DISTINCT a.id, a.nombre, a.ruta_r2, a.id_carpeta, a.tamaño, a.titulo, t.nombre as tipo, a.created_by, a.created_at, a.allowed_roles,
           v.nombre as creador_nombre, v.apellido as creador_apellido
    FROM archivos a
    LEFT JOIN archivos_tipos t ON a.id_tipo = t.id
    LEFT JOIN v_usuario_entidad_completo v ON a.created_by = v.user_context_id
    LEFT JOIN archivos_visibilidad_usuario avu ON avu.archivo_id = a.id AND avu.usuario_id = $4
    WHERE (
        a.created_by IN (SELECT user_context_id FROM found_users)
        OR a.id_usuario_seguido IN (SELECT user_context_id FROM found_users)
    )
    AND a.deleted_at IS NULL
    AND a.uso = 'EMPRESA'
    -- SEGURIDAD REFORZADA:
    AND (
        $2 = ANY(a.allowed_roles)   -- Rol permitido
        OR a.created_by = $4        -- Es el creador
        OR avu.usuario_id IS NOT NULL -- Visibilidad explícita
    )
        AND (
            a.id_carpeta IS NULL
            OR EXISTS (
                WITH RECURSIVE folder_chain AS (
                    SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles
                    FROM carpetas c
                    WHERE c.id = a.id_carpeta AND c.deleted_at IS NULL
                    UNION ALL
                    SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles
                    FROM carpetas p
                    INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
                    WHERE p.deleted_at IS NULL
                )
                SELECT 1
                FROM folder_chain fc
                LEFT JOIN carpeta_visibilidad_usuario cvu
                    ON cvu.id_carpeta = fc.id
                    AND cvu.id_usuario = $4
                    AND cvu.deleted_at IS NULL
                GROUP BY 1
                HAVING bool_and(
                    fc.id_usuario = $4
                    OR $2 = ANY(fc.allowed_roles)
                    OR cvu.id_usuario IS NOT NULL
                )
            )
        )
    ORDER BY a.created_at DESC;
  `;
    const { rows } = await pool.query(query, [searchTerm, userRole, `%${searchTerm}%`, currentUserId]);
    return rows;
}

export const getArchivoByNombre = async (nombre: string, currentUserId: number, userRole: string) => {
    const query = `
   SELECT 
    a.id, a.nombre, a.ruta_r2, a.id_carpeta, a.tamaño, a.titulo,
    t.nombre as tipo, 
    a.created_by, a.created_at, a.allowed_roles,
    v.nombre as creador_nombre, v.apellido as creador_apellido
    FROM archivos a
    LEFT JOIN archivos_tipos t ON a.id_tipo = t.id
    LEFT JOIN v_usuario_entidad_completo v ON a.created_by = v.user_context_id
    LEFT JOIN archivos_visibilidad_usuario avu ON avu.archivo_id = a.id AND avu.usuario_id = $3
    WHERE a.deleted_at IS NULL
        AND a.uso = 'EMPRESA'
        AND (
            -- $1: nombre limpio
            to_tsvector('spanish', COALESCE(a.nombre, '')) @@ plainto_tsquery('spanish', $1)
            -- $2: %nombre%
            OR a.nombre ILIKE $2
        )
        -- CONDICIONES DE SEGURIDAD
        AND (
            a.created_by = $3               -- $3: currentUserId
            OR avu.usuario_id IS NOT NULL   -- Relación encontrada en archivos_visibilidad_usuario
            OR $4 = ANY(a.allowed_roles)    -- $4: userRole
        )
        AND (
            a.id_carpeta IS NULL
            OR EXISTS (
                WITH RECURSIVE folder_chain AS (
                    SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles
                    FROM carpetas c
                    WHERE c.id = a.id_carpeta AND c.deleted_at IS NULL
                    UNION ALL
                    SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles
                    FROM carpetas p
                    INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
                    WHERE p.deleted_at IS NULL
                )
                SELECT 1
                FROM folder_chain fc
                LEFT JOIN carpeta_visibilidad_usuario cvu
                    ON cvu.id_carpeta = fc.id
                    AND cvu.id_usuario = $3
                    AND cvu.deleted_at IS NULL
                GROUP BY 1
                HAVING bool_and(
                    fc.id_usuario = $3
                    OR $4 = ANY(fc.allowed_roles)
                    OR cvu.id_usuario IS NOT NULL
                )
            )
        )
    ORDER BY a.created_at DESC;
  `;
    const { rows } = await pool.query(query, [nombre, `%${nombre}%`, currentUserId, userRole]);
    return rows;
}

export const isArchivoOwner = async (id: number, userContextId: number): Promise<boolean> => {
    const query = `
            SELECT 1
            FROM archivos
            WHERE id = $1
                AND created_by = $2
                AND deleted_at IS NULL;
        `;

    const { rows } = await pool.query(query, [id, userContextId]);
    return rows.length > 0;
};

export const moveArchivoToCarpeta = async (id: number, idCarpeta: number | null): Promise<ArchivoDTO | null> => {
    const query = `
            UPDATE archivos
            SET id_carpeta = $1
            WHERE id = $2
                AND deleted_at IS NULL
            RETURNING id;
        `;

    const { rows } = await pool.query(query, [idCarpeta, id]);
    if (!rows[0]) {
        return null;
    }

    return getArchivoById(id);
};

export const getArchivoAclData = async (id: number): Promise<ArchivoAclData | null> => {
    const query = `
        SELECT
            a.id,
            a.created_by AS owner_id,
            a.allowed_roles,
            COALESCE(
                ARRAY_AGG(avu.usuario_id) FILTER (WHERE avu.usuario_id IS NOT NULL),
                ARRAY[]::int[]
            ) AS allowed_users,
            COALESCE(
                ARRAY_AGG(DISTINCT TRIM(CONCAT(COALESCE(vue.nombre, ''), ' ', COALESCE(vue.apellido, ''))))
                    FILTER (WHERE avu.usuario_id IS NOT NULL),
                ARRAY[]::text[]
            ) AS allowed_user_names
        FROM archivos a
        LEFT JOIN archivos_visibilidad_usuario avu
            ON avu.archivo_id = a.id
        LEFT JOIN v_usuario_entidad_completo vue
            ON vue.user_context_id = avu.usuario_id
        WHERE a.id = $1
            AND a.deleted_at IS NULL
        GROUP BY a.id, a.created_by, a.allowed_roles;
    `;

    const { rows } = await pool.query(query, [id]);
    if (!rows[0]) {
        return null;
    }

    return rows[0] as ArchivoAclData;
};

export const syncArchivoAcl = async (
    id: number,
    allowedRoles: string[],
    allowedUsers: number[],
): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            `
                UPDATE archivos
                SET allowed_roles = $2
                WHERE id = $1
                  AND deleted_at IS NULL;
            `,
            [id, allowedRoles],
        );

        await client.query(
            `
                DELETE FROM archivos_visibilidad_usuario
                WHERE archivo_id = $1;
            `,
            [id],
        );

        if (allowedUsers.length > 0) {
            const insertQuery = `
                INSERT INTO archivos_visibilidad_usuario (archivo_id, usuario_id)
                VALUES ${allowedUsers.map((_, index) => `($1, $${index + 2})`).join(', ')};
            `;

            await client.query(insertQuery, [id, ...allowedUsers]);
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const patchArchivoPermisos = async (
    id: number,
    rolesToRemove: string[],
    userIdsToRemove: number[],
): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            `
                UPDATE archivos
                SET allowed_roles = (
                    SELECT COALESCE(
                        ARRAY(
                            SELECT role_name
                            FROM UNNEST(COALESCE(archivos.allowed_roles, ARRAY[]::text[])) AS role_name
                            WHERE NOT (role_name = ANY($2::text[]))
                        ),
                        ARRAY[]::text[]
                    )
                )
                WHERE id = $1
                  AND deleted_at IS NULL;
            `,
            [id, rolesToRemove],
        );

        if (userIdsToRemove.length > 0) {
            await client.query(
                `
                    DELETE FROM archivos_visibilidad_usuario
                    WHERE archivo_id = $1
                      AND usuario_id = ANY($2::int[]);
                `,
                [id, userIdsToRemove],
            );
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const markFileAsRead = async (userContextId: number, archivoId: number): Promise<void> => {
    const query = `
        INSERT INTO archivo_aperturas (archivo_id, usuario_id, creado_en)
        VALUES ($1, $2, NOW())
        ON CONFLICT DO NOTHING;
    `;

    await pool.query(query, [archivoId, userContextId]);
};

export const getArchivoViewersByArchivoId = async (archivoId: number): Promise<ArchivoViewerData[]> => {
    const query = `
        SELECT
            aa.usuario_id AS user_context_id,
            u.nombre,
            u.apellido,
            aa.creado_en AS visto_en
        FROM archivo_aperturas aa
        INNER JOIN v_interno_users u
            ON aa.usuario_id = u.user_context_id
        WHERE aa.archivo_id = $1
        ORDER BY aa.creado_en DESC;
    `;

    const { rows } = await pool.query(query, [archivoId]);
    return rows;
};