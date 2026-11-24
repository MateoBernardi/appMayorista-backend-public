import { pool } from './pgClient';
import { UsuarioDTO, UsuarioWithPasswordDTO, UsuarioEntidadDTO } from '../../domain/dto/UsuarioDTO';
import { CuentaDisponibleDTO } from '../../domain/dto/CuentaDisponibleDTO';

export const createUser = async (userData: { username: string, email: string, password: string, nombre: string, apellido: string }): Promise<UsuarioDTO> => {
    const { username, email, password, nombre, apellido } = userData;

    // Crear usuario en la base de datos
    const result = await pool.query(
        `INSERT INTO usuarios (username, password, email, nombre, apellido) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, username, email, nombre, apellido, created_at, updated_at`,
        [username, password, email, nombre, apellido]
    );
    
    return result.rows[0];
};

/**
 * Crea un contexto temporal con rol readonly para un usuario nuevo
 * Esto permite que el usuario acceda a las rutas de asociación
 */
export const createTemporaryReadonlyContext = async (userId: number, readonlyRoleId: number): Promise<number> => {
    // Buscar el id_entidad_tipo para 'unverified' (debes tener esto en tu tabla entidades_tipos)
    // Si no existe, usar NULL o crear uno específico para usuarios sin verificar
    const result = await pool.query(
        `INSERT INTO usuario_entidad (id_usuario, id_entidad_tipo, id_entidad, id_rol, fecha_asociacion)
         VALUES ($1, 0, 0, $2, NOW())
         RETURNING id`,
        [userId, readonlyRoleId]
    );
    
    return result.rows[0].id;
};

export const findUserByUsername = async (username: string): Promise<UsuarioWithPasswordDTO | null> => {
    const result = await pool.query(
        `SELECT id, username, password, email, nombre, apellido, created_at, updated_at 
         FROM usuarios 
         WHERE username = $1 AND deleted_at IS NULL`,
        [username]
    );
    
    return result.rows[0] || null;
};

export const findUserByEmail = async (email: string): Promise<UsuarioWithPasswordDTO> => {
    const result = await pool.query(
        `SELECT id, username, password, email, nombre, apellido, created_at, updated_at 
         FROM usuarios 
         WHERE email = $1 AND deleted_at IS NULL`,
        [email]
    );
    
    return result.rows[0] || null;
};

export const findUserById = async (id: number): Promise<UsuarioWithPasswordDTO> => {
    const result = await pool.query(
        `SELECT id, username, email, nombre, apellido, created_at, updated_at 
         FROM usuarios 
         WHERE id = $1 AND deleted_at IS NULL`,
        [id]
    );
    
    return result.rows[0] || null;
};

export const getUserWithRole = async (userId: number) => {
    const result = await pool.query(
        `SELECT u.id, u.username, u.email, u.id_rol, u.cuit, u.created_at, u.updated_at,
                r.nombre as rol_nombre
         FROM usuarios u
         JOIN roles r ON u.id_rol = r.id_rol
         WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [userId]
    );
    
    return result.rows[0] || null;
};

export const updateUser = async (id: number, userData: Partial<{ username: string, email: string, nombre: string, apellido: string }>): Promise<UsuarioDTO | null> => {
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    if (userData.username) {
        fields.push(`username = $${paramCount++}`);
        values.push(userData.username);
    }
    
    if (userData.email) {
        fields.push(`email = $${paramCount++}`);
        values.push(userData.email);
    }
    
    if (fields.length === 0) {
        throw new Error('No hay campos para actualizar');
    }
    
    values.push(id);
    
    const result = await pool.query(
        `UPDATE usuarios 
         SET ${fields.join(', ')} 
         WHERE id = $${paramCount} AND deleted_at IS NULL
         RETURNING id, username, email, nombre, apellido, created_at, updated_at`,
        values
    );
    
    return result.rows[0] || null;
};

export const updateUserPassword = async (id: number, newPassword: string): Promise<boolean> => {
    
    const result = await pool.query(
        `UPDATE usuarios 
         SET password = $1 
         WHERE id = $2 AND deleted_at IS NULL`,
        [newPassword, id]
    );
    
    return result.rowCount !== null && result.rowCount > 0;
};

export const updateUserRole = async (id: number, newRoleId: number): Promise<boolean> => {
    const result = await pool.query(
        `UPDATE usuario_entidad 
         SET id_rol = $2
         WHERE id = $1`,
        [id, newRoleId]
    );
    
    return result.rowCount !== null && result.rowCount > 0;
}

export const deleteUser = async (id: number): Promise<boolean> => {
    // Soft delete - el trigger se encarga de setear deleted_at
    const result = await pool.query(
        `DELETE FROM usuarios WHERE id = $1`,
        [id]
    );
    
    return result.rowCount !== null && result.rowCount > 0;
};

export const getAllUsers = async (): Promise<UsuarioDTO[]> => {
    const result = await pool.query(
        `SELECT u.id, u.username, u.email, u.created_at, u.updated_at,
                r.nombre as rol_nombre
         FROM usuarios u
         JOIN roles r ON u.id_rol = r.id_rol
         WHERE u.deleted_at IS NULL
         ORDER BY u.created_at DESC`
    );
    
    return result.rows;
};

export const getUsuarioEntidadByUserAndEntorno = async (userId: number, entorno: string) => {
    const result = await pool.query(
        `SELECT ue.id, ue.id_usuario, ue.id_entidad_tipo, ue.id_entidad, ue.id_rol,
                et.nombre as entidad_tipo_nombre, et.origen,
                r.nombre as rol_nombre
         FROM usuario_entidad ue
         JOIN entidades_tipos et ON ue.id_entidad_tipo = et.id
         JOIN roles r ON ue.id_rol = r.id_rol
         WHERE ue.id_usuario = $1 AND et.origen = $2 AND ue.fecha_asociacion IS NOT NULL`,
        [userId, entorno]
    );
    
    return result.rows[0] || null;
};

/**
 * Obtiene el contexto completo de usuario usando la vista optimizada
 * @param userId - ID del usuario
 * @param entorno - Entorno ('web', 'mayorista', 'interno')
 * @returns UsuarioEntidadDTO con toda la información de contexto
 */
export const getUsuarioEntidadCompleto = async (userId: number, entorno: 'web' | 'mayorista' | 'interno'): Promise<UsuarioEntidadDTO[]> => {
    const result = await pool.query<UsuarioEntidadDTO>(
        `SELECT * FROM v_usuario_entidad_completo 
         WHERE id_usuario = $1 AND entorno = $2`,
        [userId, entorno]
    );
    
    return result.rows;
};

export const getAllUsuarioPerfiles = async (userContextId: number): Promise<UsuarioEntidadDTO[]> => {
    const result = await pool.query<UsuarioEntidadDTO>(
        `SELECT * FROM v_usuario_entidad_completo 
         WHERE user_context_id = $1`,
        [userContextId]
    );
    
    return result.rows;
};

/**
 * Busca usuarios por nombre y/o apellido combinando full-text search con ILIKE
 * - Usa ts_vector para búsquedas de palabras completas (más relevantes)
 * - Usa ILIKE para sugerencias con coincidencias parciales
 * @param searchTerm - Término de búsqueda para nombre y apellido
 * @returns Array de UsuarioEntidadDTO que coincidan con la búsqueda, ordenados por relevancia
 */
export const getUsuarioEntidadByNombreApellido = async (searchTerm: string): Promise<UsuarioEntidadDTO[]> => {
    const result = await pool.query<UsuarioEntidadDTO>(
        `SELECT *, 
                CASE 
                    WHEN to_tsvector('spanish', COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')) 
                         @@ plainto_tsquery('spanish', $1) THEN 1
                    ELSE 2
                END as match_priority,
                ts_rank(
                    to_tsvector('spanish', COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')), 
                    plainto_tsquery('spanish', $1)
                ) as relevance_score
         FROM v_interno_users 
         WHERE to_tsvector('spanish', COALESCE(nombre, '') || ' ' || COALESCE(apellido, '')) 
               @@ plainto_tsquery('spanish', $1)
            OR nombre ILIKE $2 
            OR apellido ILIKE $2
         ORDER BY match_priority, relevance_score DESC, nombre, apellido`,
        [searchTerm, `%${searchTerm}%`]
    );
    
    return result.rows;
};

export const getUsuariosByRole = async (roleName: string): Promise<UsuarioEntidadDTO[]> => {
    const result = await pool.query<UsuarioEntidadDTO>(
        `SELECT * FROM v_interno_users 
         WHERE rol_nombre = $1
         ORDER BY usuario_created_at DESC`,
        [roleName]
    );
    
    return result.rows;
};

/**
 * Obtiene el contexto de usuario por user_context_id usando la vista optimizada
 * @param userContextId - ID de usuario_entidad
 * @returns UsuarioEntidadDTO con toda la información de contexto
 */
export const getUsuarioEntidadByContextId = async (userContextId: number): Promise<UsuarioEntidadDTO | null> => {
    const result = await pool.query<UsuarioEntidadDTO>(
        `SELECT * FROM v_usuario_entidad_completo 
         WHERE user_context_id = $1`,
        [userContextId]
    );
    
    return result.rows[0] || null;
};

/**
 * Obtiene usuarios por entorno usando vistas optimizadas
 * @param entorno - Entorno ('web', 'mayorista', 'interno')
 * @returns Array de UsuarioEntidadDTO
 */
export const getUsuariosByEntorno = async (entorno: 'web' | 'mayorista' | 'interno'): Promise<UsuarioEntidadDTO[]> => {
    // Usar las vistas específicas por entorno para mejor performance
    const viewName = entorno === 'web' ? 'v_web_users' 
                    : entorno === 'mayorista' ? 'v_mayorista_users' 
                    : 'v_interno_users';
    
    const result = await pool.query<UsuarioEntidadDTO>(
        `SELECT * FROM ${viewName} ORDER BY usuario_created_at DESC`
    );
    
    return result.rows;
};

/**
 * Busca cuentas disponibles por CUIT en la tabla correspondiente al entorno
 * @param cuit - CUIT a buscar
 * @param entorno - Entorno ('web', 'mayorista', 'interno')
 * @returns Array de cuentas disponibles con metadatos de origen y entorno
 */
export const findCuentasPorCuit = async (cuit: string, entorno: 'web' | 'mayorista' | 'interno'): Promise<CuentaDisponibleDTO[]> => {
    let query: string;
    
    if (entorno === 'web') {
        // Buscar en clientes para entorno web
        query = `
            SELECT 
                c.id_cliente as id,
                c.descripcion as nombre,
                NULL::text as apellido,
                c.direccion,
                l.nombre as localidad,
                c.cuit,
                COALESCE(c.email, '') as contact,
                'cliente' as tabla_origen,
                et.id as id_entidad_tipo,
                et.origen as entorno,
                et.nombre as tipo_entidad
            FROM clientes c
            LEFT JOIN localidades l ON c.id_localidad = l.id_localidad
            CROSS JOIN entidades_tipos et
            WHERE c.cuit = $1 
                AND et.origen = $2
                AND c.deleted_at IS NULL
            ORDER BY nombre, apellido
        `;
    } else {
        // Buscar en personal para mayorista e interno
        query = `
            SELECT 
                p.id_empleado as id,
                p.nombre,
                p.apellido,
                p.direccion,
                NULL::text as localidad,
                p.cuit,
                COALESCE(p.correo, '') as contact,
                'personal' as tabla_origen,
                et.id as id_entidad_tipo,
                et.origen as entorno,
                et.nombre as tipo_entidad
            FROM personal p
            CROSS JOIN entidades_tipos et
            WHERE p.cuit = $1 
                AND et.origen = $2
                AND p.activo = true
                AND p.deleted_at IS NULL
            ORDER BY nombre, apellido
        `;
    }
    
    const result = await pool.query(query, [cuit, entorno]);
    return result.rows as CuentaDisponibleDTO[];
};

/**
 * Crea una asociación entre un usuario y una entidad (cuenta)
 * @param userId - ID del usuario
 * @param idEntidadTipo - ID del tipo de entidad
 * @param idEntidad - ID de la entidad (cliente o personal)
 * @param idRol - ID del rol a asignar
 * @returns ID de la asociación creada
 */
export const createUsuarioEntidad = async (
    userId: number, 
    idEntidadTipo: number, 
    idEntidad: number, 
    idRol: number
): Promise<number> => {
    const result = await pool.query(
        `INSERT INTO usuario_entidad (id_usuario, id_entidad_tipo, id_entidad, id_rol, fecha_asociacion)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id`,
        [userId, idEntidadTipo, idEntidad, idRol]
    );
    
    return result.rows[0].id;
};

/**
 * Obtiene el entorno (origen) de un tipo de entidad
 * @param idEntidadTipo - ID en entidades_tipos
 * @returns 'web' | 'mayorista' | 'interno', o null si no existe
 */
export const getOrigenEntidadTipo = async (idEntidadTipo: number): Promise<'web' | 'mayorista' | 'interno' | null> => {
    const result = await pool.query(
        `SELECT origen FROM entidades_tipos WHERE id = $1`,
        [idEntidadTipo]
    );
    return result.rows[0]?.origen ?? null;
};

/**
 * Obtiene el rol por defecto según el entorno
 * @param entorno - Entorno ('web', 'mayorista', 'interno')
 * @returns ID del rol
 */
export const getRolPorDefectoPorEntorno = async (entorno: 'web' | 'mayorista' | 'interno'): Promise<number> => {
    // Mapeo de entornos a roles por defecto
    const rolesMap: Record<string, string> = {
        web: 'publico',       
        mayorista: 'ventas',   
        interno: 'empleado-super'  
    };
    
    const rolNombre = rolesMap[entorno];
    
    const result = await pool.query(
        `SELECT id_rol FROM roles WHERE nombre = $1`,
        [rolNombre]
    );
    
    if (result.rows.length === 0) {
        throw new Error(`No se encontró el rol por defecto para el entorno ${entorno}`);
    }
    
    return result.rows[0].id_rol;
};

/**
 * Obtiene IDs de usuarios por roles específicos, excluyendo opcionalmente un usuario
 */
export const getUsuarioIdsByRoles = async (roles: string[], excludeUserContextId?: number): Promise<number[]> => {
    const normalizedRoles = roles
        .map((role) => String(role).trim().toLowerCase())
        .filter((role) => role.length > 0);

    if (normalizedRoles.length === 0) {
        return [];
    }

    let query = `
        SELECT DISTINCT user_context_id 
        FROM v_interno_users 
        WHERE LOWER(TRIM(rol_nombre)) = ANY($1)
    `;
    
    const params: any[] = [normalizedRoles];
    
    if (excludeUserContextId) {
        query += ` AND user_context_id != $2`;
        params.push(excludeUserContextId);
    }
    
    const result = await pool.query(query, params);
    return result.rows.map(row => row.user_context_id);
};

/**
 * Obtiene IDs de todos los usuarios de un entorno específico, excluyendo opcionalmente un usuario
 */
export const getUsuarioIdsByEntorno = async (entorno: string, excludeUserContextId?: number): Promise<number[]> => {
    let query = `
        SELECT DISTINCT user_context_id 
        FROM v_usuario_entidad_completo 
        WHERE entorno = $1
    `;
    
    const params: any[] = [entorno];
    
    if (excludeUserContextId) {
        query += ` AND user_context_id != $2`;
        params.push(excludeUserContextId);
    }
    
    const result = await pool.query(query, params);
    return result.rows.map(row => row.user_context_id);
};

/**
 * Obtiene IDs de todos los usuarios de múltiples entornos
 */
export const getUsuarioIdsByMultiplesEntornos = async (entornos: string[]): Promise<number[]> => {
    const query = `
        SELECT DISTINCT user_context_id 
        FROM v_usuario_entidad_completo 
        WHERE entorno = ANY($1)
    `;
    
    const result = await pool.query(query, [entornos]);
    return result.rows.map(row => row.user_context_id);
};

/**
 * Obtiene IDs de todos los usuarios excluyendo uno específico
 */
export const getAllUsuarioIdsExcept = async (excludeUserContextId: number): Promise<number[]> => {
    const query = `
        SELECT DISTINCT user_context_id 
        FROM v_usuario_entidad_completo 
        WHERE user_context_id != $1
    `;
    
    const result = await pool.query(query, [excludeUserContextId]);
    return result.rows.map(row => row.user_context_id);
};

/**
 * Obtiene todas las entradas de usuario_entidad para un usuario dado
 * @param userId - ID del usuario
 * @returns Array de filas de usuario_entidad
 */
export const getUsuarioEntidadesByUserId = async (userId: number) => {
    const result = await pool.query(
        `SELECT ue.id AS user_context_id, ue.id_usuario, ue.id_entidad_tipo, ue.id_entidad, ue.id_rol,
                et.origen AS entorno, r.nombre AS rol_nombre
         FROM usuario_entidad ue
         JOIN entidades_tipos et ON ue.id_entidad_tipo = et.id
         JOIN roles r ON ue.id_rol = r.id_rol
         WHERE ue.id_usuario = $1`,
        [userId]
    );
    return result.rows;
};

/**
 * Elimina todas las entradas de usuario_entidad de un usuario
 * @param userId - ID del usuario
 * @returns Cantidad de filas eliminadas
 */
export const deleteUsuarioEntidadByUserId = async (userId: number): Promise<number> => {
    const result = await pool.query(
        `DELETE FROM usuario_entidad WHERE id_usuario = $1`,
        [userId]
    );
    return result.rowCount || 0;
};

/**
 * Soft-delete de un usuario (setea deleted_at)
 * @param userId - ID del usuario
 * @returns true si se actualizó correctamente
 */
export const softDeleteUser = async (userId: number): Promise<boolean> => {
    const result = await pool.query(
        `UPDATE usuarios SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
};

/**
 * Ejecuta la baja de usuario de forma atómica en una sola transacción.
 * Si cualquier paso falla, se hace rollback completo.
 */
export const bajaUsuarioAtomica = async (
    userId: number
): Promise<{ username: string; personalDesactivado: boolean; usuarioDesactivado: boolean }> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const usuarioResult = await client.query<{ id: number; username: string }>(
            `SELECT id, username
             FROM usuarios
             WHERE id = $1 AND deleted_at IS NULL
             FOR UPDATE`,
            [userId]
        );

        if (usuarioResult.rows.length === 0) {
            throw new Error('Usuario no encontrado');
        }

        const usuario = usuarioResult.rows[0];

        const entidadesResult = await client.query<{ user_context_id: number; entorno: string; id_entidad: number }>(
            `SELECT ue.id AS user_context_id,
                    et.origen AS entorno,
                    ue.id_entidad
             FROM usuario_entidad ue
             INNER JOIN entidades_tipos et ON ue.id_entidad_tipo = et.id
             WHERE ue.id_usuario = $1`,
            [userId]
        );

        const userContextIds = entidadesResult.rows.map((entidad) => entidad.user_context_id);
        if (userContextIds.length > 0) {
            await client.query(
                `DELETE FROM refresh_tokens
                 WHERE id_usuario_entidad = ANY($1::int[])`,
                [userContextIds]
            );
        }

        const softDeleteResult = await client.query(
            `UPDATE usuarios
             SET deleted_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND deleted_at IS NULL`,
            [userId]
        );

        const usuarioDesactivado = (softDeleteResult.rowCount || 0) > 0;

        const idsPersonal = entidadesResult.rows
            .filter((entidad) => entidad.entorno === 'interno' || entidad.entorno === 'mayorista')
            .map((entidad) => entidad.id_entidad);

        let personalDesactivado = false;
        if (idsPersonal.length > 0) {
            const personalResult = await client.query(
                `UPDATE personal
                 SET activo = FALSE,
                     updated_at = NOW(),
                     deleted_at = NOW()
                 WHERE id_empleado = ANY($1::int[])
                   AND deleted_at IS NULL`,
                [idsPersonal]
            );

            personalDesactivado = (personalResult.rowCount || 0) > 0;
        }

        await client.query('COMMIT');

        return {
            username: usuario!.username,
            personalDesactivado,
            usuarioDesactivado,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};



export interface ContextoAvisoGerencia {
    editorNombre: string | null;
    kioscoId: number | null;
    gerenciaIds: number[];
}

// Todo lo necesario para que la cuenta kiosco avise a gerencia en nombre de un editor,
// en una sola consulta: nombre del editor, cuenta kiosco emisora y destinatarios de gerencia.
export const getContextoAvisoGerencia = async (editorUserContextId: number): Promise<ContextoAvisoGerencia> => {
    const result = await pool.query<ContextoAvisoGerencia>(
        `WITH kiosco AS (
            SELECT MIN(user_context_id) AS id
            FROM v_interno_users
            WHERE LOWER(TRIM(rol_nombre)) = 'kiosco'
         )
         SELECT
            (SELECT nombre || ' ' || apellido FROM v_usuario_entidad_completo WHERE user_context_id = $1 LIMIT 1) AS "editorNombre",
            k.id AS "kioscoId",
            COALESCE(
                (SELECT array_agg(DISTINCT user_context_id) FROM v_interno_users
                 WHERE LOWER(TRIM(rol_nombre)) = 'gerencia' AND user_context_id IS DISTINCT FROM k.id),
                '{}'
            ) AS "gerenciaIds"
         FROM kiosco k`,
        [editorUserContextId]
    );
    return result.rows[0] ?? { editorNombre: null, kioscoId: null, gerenciaIds: [] };
};
