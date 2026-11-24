import { pool } from './pgClient';
import { CarpetaDTO, CrearCarpetaDTO, EditarCarpetaDTO } from '../../domain/dto/CarpetaDTO';

export interface CarpetaAclData {
  id: number;
  owner_id: number;
  allowed_roles: string[];
  allowed_users: number[];
  allowed_user_names: string[];
}

export interface CarpetaForeignContentSummary {
  foreign_folder_count: number;
  foreign_file_count: number;
  foreign_folder_ids: number[];
  foreign_file_ids: number[];
}

export const getCarpetaById = async (id: number): Promise<CarpetaDTO | null> => {
  const query = `
    SELECT c.id, c.nombre, c.id_carpeta_padre, c.id_usuario, c.allowed_roles, c.created_at, c.updated_at, c.deleted_at, COALESCE(ARRAY_REMOVE(ARRAY_AGG(cvu.id_usuario::text), NULL), '{}') AS allowed_users
    FROM carpetas c
    LEFT JOIN carpeta_visibilidad_usuario cvu ON cvu.id_carpeta = c.id AND cvu.deleted_at IS NULL
    WHERE c.id = $1 AND c.deleted_at IS NULL
    GROUP BY c.id;
  `;

  const { rows } = await pool.query(query, [id]);
  return rows[0] ?? null;
};

// Carpeta raíz (sin padre y no borrada) por nombre exacto. La usan los flujos
// públicos (p. ej. CVs de la web) para resolver la carpeta destino del lado del
// servidor, sin aceptar ids del request. Si hubiera duplicados, toma la más vieja.
export const getCarpetaByNombreRaiz = async (
  nombre: string,
): Promise<{ id: number; id_usuario: number } | null> => {
  const query = `
    SELECT c.id, c.id_usuario
    FROM carpetas c
    WHERE c.nombre = $1 AND c.id_carpeta_padre IS NULL AND c.deleted_at IS NULL
    ORDER BY c.id
    LIMIT 1;
  `;

  const { rows } = await pool.query(query, [nombre]);
  return rows[0] ?? null;
};

export const getVisibleCarpetas = async (
  userContextId: number,
  userRole: string,
): Promise<Array<{ id: number; nombre: string; id_carpeta_padre: number | null }>> => {
  const query = `
    WITH RECURSIVE folder_chain AS (
      SELECT c.id AS carpeta_id, c.id AS node_id, c.id_carpeta_padre
      FROM carpetas c
      WHERE c.deleted_at IS NULL

      UNION ALL

      SELECT fc.carpeta_id, p.id AS node_id, p.id_carpeta_padre
      FROM folder_chain fc
      INNER JOIN carpetas p ON p.id = fc.id_carpeta_padre
      WHERE p.deleted_at IS NULL
    ),
    node_access AS (
      SELECT
        fc.carpeta_id,
        (
          c.id_usuario = $1
          OR $2 = ANY(c.allowed_roles)
          OR EXISTS (
            SELECT 1
            FROM carpeta_visibilidad_usuario cvu
            WHERE cvu.id_carpeta = c.id
              AND cvu.id_usuario = $1
              AND cvu.deleted_at IS NULL
          )
        ) AS has_access
      FROM folder_chain fc
      INNER JOIN carpetas c ON c.id = fc.node_id
    ),
    fully_accessible AS (
      SELECT
        carpeta_id,
        bool_and(has_access) AS has_full_access
      FROM node_access
      GROUP BY carpeta_id
    )
    SELECT c.id, c.nombre, c.id_carpeta_padre
    FROM carpetas c
    INNER JOIN fully_accessible fa ON fa.carpeta_id = c.id
    WHERE c.deleted_at IS NULL
      AND fa.has_full_access = TRUE
    ORDER BY c.nombre ASC;
  `;

  const { rows } = await pool.query(query, [userContextId, userRole]);
  return rows;
};

export const createCarpeta = async (data: CrearCarpetaDTO): Promise<CarpetaDTO> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO carpetas (nombre, id_carpeta_padre, id_usuario, allowed_roles, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, nombre, id_carpeta_padre, id_usuario, allowed_roles, created_at, updated_at, deleted_at;
    `;

    const { rows } = await client.query(insertQuery, [
      data.nombre,
      data.id_carpeta_padre ?? null,
      data.id_usuario,
      data.allowed_roles ?? [],
    ]);

    const carpeta = rows[0] as CarpetaDTO;

    if (data.usuarios_id?.length) {
      const insertVisibilityQuery = `
        INSERT INTO carpeta_visibilidad_usuario (id_carpeta, id_usuario)
        VALUES ${data.usuarios_id.map((_, index) => `($1, $${index + 2})`).join(', ')}
        ON CONFLICT (id_carpeta, id_usuario)
        DO UPDATE SET deleted_at = NULL;
      `;

      await client.query(insertVisibilityQuery, [carpeta.id, ...data.usuarios_id]);
    }

    await client.query('COMMIT');
    return carpeta;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateCarpeta = async (id: number, data: EditarCarpetaDTO): Promise<CarpetaDTO | null> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const fields: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let parameterIndex = 1;

    if (data.nombre !== undefined) {
      fields.push(`nombre = $${parameterIndex++}`);
      values.push(data.nombre);
    }

    if (data.allowed_roles !== undefined) {
      fields.push(`allowed_roles = $${parameterIndex++}`);
      values.push(data.allowed_roles);
    }

    values.push(id);
    const updateQuery = `
      UPDATE carpetas
      SET ${fields.join(', ')}
      WHERE id = $${parameterIndex}
        AND deleted_at IS NULL
      RETURNING id, nombre, id_carpeta_padre, id_usuario, allowed_roles, created_at, updated_at, deleted_at;
    `;

    const { rows } = await client.query(updateQuery, values);
    const carpeta = rows[0] as CarpetaDTO | undefined;

    if (!carpeta) {
      await client.query('ROLLBACK');
      return null;
    }

    if (data.usuarios_id !== undefined) {
      await client.query(
        `
          UPDATE carpeta_visibilidad_usuario
          SET deleted_at = NOW()
          WHERE id_carpeta = $1 AND deleted_at IS NULL;
        `,
        [id],
      );

      if (data.usuarios_id.length > 0) {
        const visibilityQuery = `
          INSERT INTO carpeta_visibilidad_usuario (id_carpeta, id_usuario, deleted_at)
          VALUES ${data.usuarios_id.map((_, index) => `($1, $${index + 2}, NULL)`).join(', ')}
          ON CONFLICT (id_carpeta, id_usuario)
          DO UPDATE SET deleted_at = NULL;
        `;

        await client.query(visibilityQuery, [id, ...data.usuarios_id]);
      }
    }

    await client.query('COMMIT');
    return carpeta;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const patchCarpetaPermisos = async (
  id: number,
  rolesToRemove: string[],
  userIdsToRemove: number[],
): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE carpetas
        SET
          allowed_roles = (
            SELECT COALESCE(
              ARRAY(
                SELECT role_name
                FROM UNNEST(COALESCE(carpetas.allowed_roles, ARRAY[]::text[])) AS role_name
                WHERE NOT (role_name = ANY($2::text[]))
              ),
              ARRAY[]::text[]
            )
          ),
          updated_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL;
      `,
      [id, rolesToRemove],
    );

    if (userIdsToRemove.length > 0) {
      await client.query(
        `
          UPDATE carpeta_visibilidad_usuario
          SET deleted_at = NOW()
          WHERE id_carpeta = $1
            AND id_usuario = ANY($2::int[])
            AND deleted_at IS NULL;
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

export const canManageCarpeta = async (id: number, userContextId: number, userRole: string): Promise<boolean> => {
  if (userRole === 'admin' || userRole === 'gerencia') {
    return true;
  }

  const query = `
    SELECT 1
    FROM carpetas
    WHERE id = $1
      AND id_usuario = $2
      AND deleted_at IS NULL;
  `;

  const { rows } = await pool.query(query, [id, userContextId]);
  return rows.length > 0;
};

export const userCanAccessCarpeta = async (id: number, userContextId: number, userRole: string): Promise<boolean> => {
  const query = `
    WITH RECURSIVE folder_chain AS (
      SELECT c.id, c.id_carpeta_padre, c.id_usuario, c.allowed_roles, 0 AS depth
      FROM carpetas c
      WHERE c.id = $1 AND c.deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.id_carpeta_padre, p.id_usuario, p.allowed_roles, fc.depth + 1
      FROM carpetas p
      INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
      WHERE p.deleted_at IS NULL
    ),
    node_access AS (
      SELECT
        fc.id,
        (
          fc.id_usuario = $2
          OR $3 = ANY(fc.allowed_roles)
          OR EXISTS (
            SELECT 1
            FROM carpeta_visibilidad_usuario cvu
            WHERE cvu.id_carpeta = fc.id
              AND cvu.id_usuario = $2
              AND cvu.deleted_at IS NULL
          )
        ) AS has_access
      FROM folder_chain fc
    )
    SELECT COALESCE(
      (SELECT bool_and(has_access) FROM node_access),
      FALSE
    ) AS has_access;
  `;

  const { rows } = await pool.query(query, [id, userContextId, userRole]);
  return rows[0]?.has_access ?? false;
};

export const deleteCarpetaCascade = async (id: number): Promise<{ id: number }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const subtreeQuery = `
      WITH RECURSIVE subtree AS (
        SELECT id
        FROM carpetas
        WHERE id = $1 AND deleted_at IS NULL
        UNION ALL
        SELECT c.id
        FROM carpetas c
        INNER JOIN subtree s ON c.id_carpeta_padre = s.id
        WHERE c.deleted_at IS NULL
      )
      SELECT id FROM subtree;
    `;

    const subtreeResult = await client.query(subtreeQuery, [id]);
    const subtreeIds = subtreeResult.rows.map((row: { id: number }) => row.id);

    if (!subtreeIds.length) {
      await client.query('ROLLBACK');
      return { id };
    }

    await client.query(
      `
        UPDATE archivos
        SET deleted_at = NOW()
        WHERE id_carpeta = ANY($1::int[])
          AND deleted_at IS NULL;
      `,
      [subtreeIds],
    );

    await client.query(
      `
        UPDATE carpeta_visibilidad_usuario
        SET deleted_at = NOW()
        WHERE id_carpeta = ANY($1::int[])
          AND deleted_at IS NULL;
      `,
      [subtreeIds],
    );

    await client.query(
      `
        UPDATE carpetas
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND deleted_at IS NULL;
      `,
      [subtreeIds],
    );

    await client.query('COMMIT');
    return { id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const splitRolesByCarpetaAccess = async (
  carpetaId: number,
  roles: string[],
): Promise<{ validRoles: string[]; invalidRoles: string[] }> => {
  if (!roles.length) {
    return { validRoles: [], invalidRoles: [] };
  }

  const query = `
    WITH RECURSIVE input_roles AS (
      SELECT DISTINCT UNNEST($2::text[]) AS role_name
    ),
    folder_chain AS (
      SELECT c.id, c.id_carpeta_padre, c.allowed_roles
      FROM carpetas c
      WHERE c.id = $1 AND c.deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.id_carpeta_padre, p.allowed_roles
      FROM carpetas p
      INNER JOIN folder_chain fc ON fc.id_carpeta_padre = p.id
      WHERE p.deleted_at IS NULL
    ),
    role_access AS (
      SELECT
        ir.role_name,
        bool_and(ir.role_name = ANY(fc.allowed_roles)) AS has_full_access
      FROM input_roles ir
      CROSS JOIN folder_chain fc
      GROUP BY ir.role_name
    )
    SELECT role_name, has_full_access
    FROM role_access;
  `;

  const { rows } = await pool.query(query, [carpetaId, roles]);
  const validRoles: string[] = [];
  const invalidRoles: string[] = [];

  for (const row of rows) {
    if (row.has_full_access) {
      validRoles.push(row.role_name);
    } else {
      invalidRoles.push(row.role_name);
    }
  }

  return { validRoles, invalidRoles };
};

export const getRolesByUserContextIds = async (userContextIds: number[]): Promise<Map<number, string>> => {
  if (!userContextIds.length) {
    return new Map<number, string>();
  }

  const query = `
    SELECT user_context_id, rol_nombre
    FROM v_usuario_entidad_completo
    WHERE user_context_id = ANY($1::int[]);
  `;

  const { rows } = await pool.query(query, [userContextIds]);
  const byUserId = new Map<number, string>();

  for (const row of rows) {
    byUserId.set(row.user_context_id, row.rol_nombre);
  }

  return byUserId;
};

export const getUserDisplayNamesByUserContextIds = async (
  userContextIds: number[],
): Promise<Map<number, string>> => {
  if (!userContextIds.length) {
    return new Map<number, string>();
  }

  const query = `
    SELECT
      user_context_id,
      TRIM(CONCAT(COALESCE(nombre, ''), ' ', COALESCE(apellido, ''))) AS full_name
    FROM v_usuario_entidad_completo
    WHERE user_context_id = ANY($1::int[]);
  `;

  const { rows } = await pool.query(query, [userContextIds]);
  const byUserId = new Map<number, string>();

  for (const row of rows) {
    byUserId.set(row.user_context_id, row.full_name);
  }

  return byUserId;
};

export const splitUsersByCarpetaAccess = async (
  carpetaId: number,
  userContextIds: number[],
): Promise<{ validUsers: number[]; invalidUsers: number[] }> => {
  if (!userContextIds.length) {
    return { validUsers: [], invalidUsers: [] };
  }

  const userRoleMap = await getRolesByUserContextIds(userContextIds);
  const validUsers: number[] = [];
  const invalidUsers: number[] = [];

  for (const userId of userContextIds) {
    const roleName = userRoleMap.get(userId);
    if (!roleName) {
      invalidUsers.push(userId);
      continue;
    }

    const hasAccess = await userCanAccessCarpeta(carpetaId, userId, roleName);
    if (hasAccess) {
      validUsers.push(userId);
    } else {
      invalidUsers.push(userId);
    }
  }

  return { validUsers, invalidUsers };
};

export const getForeignContentInSubtree = async (
  carpetaId: number,
  requesterUserContextId: number,
): Promise<CarpetaForeignContentSummary> => {
  const query = `
    WITH RECURSIVE subtree AS (
      SELECT id
      FROM carpetas
      WHERE id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT c.id
      FROM carpetas c
      INNER JOIN subtree s ON c.id_carpeta_padre = s.id
      WHERE c.deleted_at IS NULL
    ),
    foreign_folders AS (
      SELECT c.id
      FROM carpetas c
      INNER JOIN subtree s ON s.id = c.id
      WHERE c.deleted_at IS NULL
        AND c.id <> $1
        AND c.id_usuario <> $2
    ),
    foreign_files AS (
      SELECT a.id
      FROM archivos a
      WHERE a.id_carpeta IN (SELECT id FROM subtree)
        AND a.deleted_at IS NULL
        AND a.created_by <> $2
    )
    SELECT
      (SELECT COUNT(*)::int FROM foreign_folders) AS foreign_folder_count,
      (SELECT COUNT(*)::int FROM foreign_files) AS foreign_file_count,
      COALESCE((SELECT array_agg(id) FROM foreign_folders), ARRAY[]::int[]) AS foreign_folder_ids,
      COALESCE((SELECT array_agg(id) FROM foreign_files), ARRAY[]::int[]) AS foreign_file_ids;
  `;

  const { rows } = await pool.query(query, [carpetaId, requesterUserContextId]);
  return rows[0] as CarpetaForeignContentSummary;
};

export const getCarpetaAclData = async (id: number): Promise<CarpetaAclData | null> => {
  const query = `
    SELECT
      c.id,
      c.id_usuario AS owner_id,
      c.allowed_roles,
      COALESCE(
        ARRAY_AGG(cvu.id_usuario) FILTER (WHERE cvu.id_usuario IS NOT NULL),
        ARRAY[]::int[]
      ) AS allowed_users,
      COALESCE(
        ARRAY_AGG(DISTINCT TRIM(CONCAT(COALESCE(vue.nombre, ''), ' ', COALESCE(vue.apellido, ''))))
          FILTER (WHERE cvu.id_usuario IS NOT NULL),
        ARRAY[]::text[]
      ) AS allowed_user_names
    FROM carpetas c
    LEFT JOIN carpeta_visibilidad_usuario cvu
      ON cvu.id_carpeta = c.id
      AND cvu.deleted_at IS NULL
    LEFT JOIN v_usuario_entidad_completo vue
      ON vue.user_context_id = cvu.id_usuario
    WHERE c.id = $1
      AND c.deleted_at IS NULL
    GROUP BY c.id, c.id_usuario, c.allowed_roles;
  `;

  const { rows } = await pool.query(query, [id]);
  if (!rows[0]) {
    return null;
  }

  return rows[0] as CarpetaAclData;
};
