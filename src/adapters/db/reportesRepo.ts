import { pool } from './pgClient';
import type { ReporteDTO, CreateReporteDTO, EstadoReporte, ReporteStatsDTO, MostImprovedUserDTO, TopPositiveUserDTO } from '../../domain/dto/ReporteDTO';
import { formatFechaHora, parseTimestampAR } from '../../utils/dateOnly';

const EMPLOYEE_ROLE_FILTER = "(u.rol_nombre IN ('empleado', 'encargado') OR u.rol_nombre LIKE 'empleado-%')";

// Adjunta bitácora e imágenes a un conjunto de reportes ya resueltos (usado tanto
// por getReportesByUser como por getReportesManaged, que devuelven reportes con
// el mismo shape esperado por ReporteModal en el frontend).
const attachBitacoraYImagenes = async (reportes: any[]): Promise<any[]> => {
    if (reportes.length === 0) return [];
    const reporteIds = reportes.map(r => r.id);

    const bitacoraQuery = `
        SELECT ra.*, u.nombre as usuario_nombre, u.apellido as usuario_apellido
        FROM reporte_actividad ra
        LEFT JOIN v_interno_users u ON ra.usuario_id = u.user_context_id
        WHERE ra.reporte_id = ANY($1)
        ORDER BY ra.created_at ASC
    `;
    const imagenesQuery = `
        SELECT ri.reporte_id, i.url, ri.orden
        FROM reporte_imagen ri
        INNER JOIN images i ON ri.image_id = i.id
        WHERE ri.reporte_id = ANY($1) AND ri.deleted_at IS NULL
        ORDER BY ri.orden ASC
    `;

    const [bitacoraResult, imagenesResult] = await Promise.all([
        pool.query(bitacoraQuery, [reporteIds]),
        pool.query(imagenesQuery, [reporteIds]),
    ]);

    const bitacoraMap = new Map<number, any[]>();
    for (const row of bitacoraResult.rows) {
        if (!bitacoraMap.has(row.reporte_id)) bitacoraMap.set(row.reporte_id, []);
        bitacoraMap.get(row.reporte_id)!.push(row);
    }

    const imagenesMap = new Map<number, any[]>();
    for (const row of imagenesResult.rows) {
        if (!imagenesMap.has(row.reporte_id)) imagenesMap.set(row.reporte_id, []);
        imagenesMap.get(row.reporte_id)!.push(row.url);
    }

    return reportes.map(r => ({
        ...r,
        bitacora: bitacoraMap.get(r.id) || [],
        imagenes: imagenesMap.get(r.id) || [],
    }));
};

export const getReportesByUser = async (usuarioId: Number): Promise<(ReporteDTO & { bitacora: any[] })[]> => {
    const query = `
        SELECT
        r.*,
        u.nombre AS creador_nombre,
        u.apellido AS creador_apellido
        FROM reportes r
        LEFT JOIN v_interno_users u ON r.creador_id = u.user_context_id -- Unimos con el creador
        WHERE r.usuario_reportado_id = $1                         -- Filtramos por el reportado (tú)
          AND r.created_at >= NOW() - INTERVAL '6 months'
          AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC;
    `;
    const values = [usuarioId];
    const result = await pool.query(query, values);
    return attachBitacoraYImagenes(result.rows);
};

export const getReportesPendingByUser = async (userContextId: Number): Promise<number> => {
    const query = `
        SELECT COUNT(*) as reportes_count
        FROM reportes r
        WHERE r.usuario_reportado_id = $1
          AND r.estado = 'PENDIENTE'
          AND r.created_at >= NOW() - INTERVAL '6 months'
          AND r.deleted_at IS NULL
    `;
    const values = [userContextId];
    const result = await pool.query(query, values);
    return parseInt(result.rows[0].reportes_count);
}

// "Unseen" del lado de gestión: reportes de subordinados que siguen esperando
// una resolución (pendientes de que el empleado responda, o ya en disputa
// esperando que un gerente/encargado la resuelva).
export const getReportesPendingForManager = async (roleId: number): Promise<number> => {
    const query = `
        SELECT COUNT(*) as reportes_count
        FROM reportes r
        JOIN v_interno_users u ON r.usuario_reportado_id = u.user_context_id
        WHERE r.estado IN ('PENDIENTE', 'DISPUTA')
          AND u.id_rol > $1
          AND r.deleted_at IS NULL
    `;
    const result = await pool.query(query, [roleId]);
    return parseInt(result.rows[0].reportes_count);
}

// Listado paginado de reportes para la vista de gestión (encargado/gerencia/etc.):
// misma regla de jerarquía que getReportesPendingForManager (solo subordinados),
// más un filtro opcional por rol del reportado (p.ej. para que un encargado acote
// a un tipo de empleado dentro de lo que ya puede ver).
export const getReportesManaged = async (
    { roleId, rol, estado, limit, offset }: { roleId: number; rol?: string | undefined; estado?: EstadoReporte | undefined; limit: number; offset: number }
): Promise<{ data: (ReporteDTO & { bitacora: any[]; imagenes: string[] })[]; total: number }> => {
    const params: unknown[] = [roleId];
    let rolClause = '';
    if (rol) {
        params.push(rol);
        rolClause = `AND u.rol_nombre = $${params.length}`;
    }
    let estadoClause = '';
    if (estado) {
        params.push(estado);
        estadoClause = `AND r.estado = $${params.length}`;
    }

    const dataQuery = `
        SELECT r.*,
               u.nombre AS usuario_nombre, u.apellido AS usuario_apellido,
               c.nombre AS creador_nombre, c.apellido AS creador_apellido
        FROM reportes r
        JOIN v_interno_users u ON r.usuario_reportado_id = u.user_context_id
        LEFT JOIN v_interno_users c ON r.creador_id = c.user_context_id
        WHERE u.id_rol > $1
          AND r.deleted_at IS NULL
          ${rolClause}
          ${estadoClause}
        ORDER BY r.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countQuery = `
        SELECT COUNT(*) as total
        FROM reportes r
        JOIN v_interno_users u ON r.usuario_reportado_id = u.user_context_id
        WHERE u.id_rol > $1
          AND r.deleted_at IS NULL
          ${rolClause}
          ${estadoClause}
    `;

    const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery, [...params, limit, offset]),
        pool.query(countQuery, params),
    ]);

    const data = await attachBitacoraYImagenes(dataRes.rows);
    return { data, total: parseInt(countRes.rows[0].total, 10) };
};

export const createReporte = async (data: CreateReporteDTO): Promise<ReporteDTO> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const query = `
            INSERT INTO reportes (usuario_reportado_id, creador_id, titulo, descripcion, categoria, fecha_incidente, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
        const values = [
            data.usuario_reportado_id,
            data.creador_id,
            data.titulo,
            data.descripcion,
            data.categoria,
            data.fecha_incidente || new Date(),
            data.estado,
        ];
        const result = await client.query(query, values);
        const reporte = result.rows[0];
        
        await client.query('COMMIT');
        return reporte;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const getReporteById = async (id: number): Promise<ReporteDTO | null> => {
    const query = `
        SELECT r.*, u.nombre as usuario_nombre, u.apellido as usuario_apellido
        FROM reportes r
        JOIN v_interno_users u ON r.usuario_reportado_id = u.user_context_id
        WHERE r.id = $1 AND r.deleted_at IS NULL
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
};

export const isReporteLockedByManager = async (reporteId: number): Promise<boolean> => {
    const query = `
        SELECT 1
        FROM reporte_actividad ra
        JOIN v_interno_users u ON ra.usuario_id = u.user_context_id
        WHERE (ra.reporte_id = $1
            AND ra.tipo_accion IN ('ACEPTACION', 'RECHAZO', 'DESESTIMACION'))
            AND u.rol_nombre IN ('gerencia') 
        LIMIT 1
    `;
    const result = await pool.query(query, [reporteId]);
    return result.rowCount ? result.rowCount > 0 : false;
};

export const updateReporte = async (
    id: number,
    usuarioId: number,
    changes: {
        estado?: EstadoReporte;
        observacion?: string;
        tipo_accion: string;
    }
): Promise<ReporteDTO> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let reporte;
        if (changes.estado) {
            const updateQuery = `
                UPDATE reportes
                SET estado = $1
                WHERE id = $2
                RETURNING *
            `;
            const updateResult = await client.query(updateQuery, [changes.estado, id]);
            reporte = updateResult.rows[0];
        } else {
            const getQuery = 'SELECT * FROM reportes WHERE id = $1';
            const getResult = await client.query(getQuery, [id]);
            reporte = getResult.rows[0];
        }

        if (!reporte) {
            throw new Error('Reporte no encontrado');
        }

        const actividadQuery = `
            INSERT INTO reporte_actividad (reporte_id, usuario_id, tipo_accion, observacion)
            VALUES ($1, $2, $3, $4)
        `;
        await client.query(actividadQuery, [id, usuarioId, changes.tipo_accion, changes.observacion]);

        await client.query('COMMIT');
        return reporte;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const getRankingReportes = async (estado?: EstadoReporte): Promise<ReporteStatsDTO[]> => {
    // La fórmula se mantiene igual para el cálculo de puntos
    const netoFormula = `(
        COUNT(r.id) FILTER (WHERE r.categoria = 'NEGATIVO') -
        FLOOR(COUNT(r.id) FILTER (WHERE r.categoria = 'POSITIVO') / 3)
    )::int`;

    // El filtro por estado solo acota qué usuarios entran en el resultado (los
    // que tienen al menos un reporte en ese estado); no cambia el cálculo de
    // zona/puntos de arriba, que siempre se basa en reportes ASENTADO de los
    // últimos 6 meses.
    const params: unknown[] = [];
    let estadoFilterClause = '';
    if (estado) {
        params.push(estado);
        estadoFilterClause = `
            AND EXISTS (
                SELECT 1 FROM reportes re
                WHERE re.usuario_reportado_id = u.user_context_id
                  AND re.estado = $${params.length}
                  AND re.deleted_at IS NULL
            )`;
    }

    const query = `
        SELECT
            u.user_context_id,
            u.nombre,
            u.apellido,
            u.rol_nombre,
            COUNT(r.id) FILTER (WHERE r.categoria = 'NEGATIVO')::int as negativos_puros,
            COUNT(r.id) FILTER (WHERE r.categoria = 'POSITIVO')::int as positivos_puros,
            ${netoFormula} as cantidad_neta,
            (
                SELECT COUNT(*) FROM reportes rd
                WHERE rd.usuario_reportado_id = u.user_context_id
                  AND rd.estado = 'DISPUTA'
                  AND rd.deleted_at IS NULL
            )::int as disputas,
            CASE
                WHEN ${netoFormula} >= 6 THEN 'rojo'
                WHEN ${netoFormula} BETWEEN 3 AND 5 THEN 'amarillo'
                ELSE 'verde'
            END as zona_alerta
        FROM v_interno_users u
        LEFT JOIN reportes r ON u.user_context_id = r.usuario_reportado_id
            AND r.estado = 'ASENTADO'
            AND r.created_at >= NOW() - INTERVAL '6 months'
            AND r.deleted_at IS NULL
        WHERE ${EMPLOYEE_ROLE_FILTER}
        ${estadoFilterClause}
        GROUP BY u.user_context_id, u.nombre, u.apellido, u.rol_nombre
        ORDER BY cantidad_neta DESC;
    `;

    const result = await pool.query(query, params);
    return result.rows;
};

export const getTopPositiveUser = async (): Promise<TopPositiveUserDTO> => {
    const query = `
        SELECT 
            u.user_context_id,
            u.nombre,
            u.apellido,
            COUNT(r.id)::int as total_positivos
        FROM v_interno_users u
        JOIN reportes r ON u.user_context_id = r.usuario_reportado_id
        WHERE r.categoria = 'POSITIVO' 
          AND r.created_at >= NOW() - INTERVAL '6 months' -- El filtro de tiempo
          AND r.deleted_at IS NULL
                    AND ${EMPLOYEE_ROLE_FILTER}
        GROUP BY u.user_context_id, u.nombre, u.apellido
        ORDER BY total_positivos DESC
        LIMIT 1;
    `;

    const { rows } = await pool.query(query);
    return rows[0] || null; // Retorna el primer lugar
};

export const getMostImprovedUser = async (): Promise<MostImprovedUserDTO> => {
    const query = `
        SELECT 
            u.user_context_id,
            u.nombre,
            u.apellido,
            -- Positivos en los últimos 3 meses (Trimestre A)
            COUNT(r.id) FILTER (
                WHERE r.created_at >= NOW() - INTERVAL '3 months'
            )::int as positivos_recientes,
            -- Positivos entre hace 6 y 3 meses (Trimestre B)
            COUNT(r.id) FILTER (
                WHERE r.created_at BETWEEN NOW() - INTERVAL '6 months' AND NOW() - INTERVAL '3 months'
            )::int as positivos_anteriores,
            -- La diferencia (Mejora)
            (
                COUNT(r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '3 months') - 
                COUNT(r.id) FILTER (WHERE r.created_at BETWEEN NOW() - INTERVAL '6 months' AND NOW() - INTERVAL '3 months')
            )::int as mejora_neta
        FROM v_interno_users u
        JOIN reportes r ON u.user_context_id = r.usuario_reportado_id
        WHERE r.categoria = 'POSITIVO' 
          AND r.estado = 'ASENTADO'
          AND r.deleted_at IS NULL
                    AND ${EMPLOYEE_ROLE_FILTER}
        GROUP BY u.user_context_id, u.nombre, u.apellido
        HAVING COUNT(r.id) FILTER (WHERE r.created_at >= NOW() - INTERVAL '3 months') > 0
        ORDER BY mejora_neta DESC
        LIMIT 1;
    `;

    const { rows } = await pool.query(query);
    return rows[0] || null;
};

// Asienta automáticamente los reportes PENDIENTE cuyo reportado no respondió
// en 2 días desde su creación. Usado por el cron de barrido (ver cronJobs.ts).
export const asentarReportesPendientesVencidos = async (): Promise<number> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateQuery = `
            UPDATE reportes
            SET estado = 'ASENTADO'
            WHERE estado = 'PENDIENTE'
              AND created_at <= NOW() - INTERVAL '2 days'
              AND deleted_at IS NULL
            RETURNING id
        `;
        const updateResult = await client.query(updateQuery);
        const ids: number[] = updateResult.rows.map(r => r.id);

        if (ids.length > 0) {
            const actividadQuery = `
                INSERT INTO reporte_actividad (reporte_id, usuario_id, tipo_accion, observacion)
                VALUES ($1, NULL, 'ACEPTACION_AUTOMATICA', 'Asentado automáticamente: sin respuesta durante 2 días.')
            `;
            for (const id of ids) {
                await client.query(actividadQuery, [id]);
            }
        }

        await client.query('COMMIT');
        return ids.length;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

export const reportarAusenciasDelDia = async (): Promise<number> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: claimed } = await client.query(
            `UPDATE planificacion_diaria
             SET reportado_tardanza = true
             WHERE licencia = false
               AND reportado_tardanza = false
               AND DATE(esperado_in) = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
               AND (
                 (esperado_in IS NOT NULL AND esperado_in < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AND marcado_in_at IS NULL)
                 OR (esperado_out IS NOT NULL AND esperado_out < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AND marcado_out_at IS NULL AND marcado_in_at IS NOT NULL)
               )
             RETURNING
               user_context_id AS "userContextId",
               esperado_in AS "esperadoIn",
               esperado_out AS "esperadoOut",
               marcado_in_at AS "marcadoInAt"`
        );

        if (claimed.length === 0) {
            await client.query('COMMIT');
            return 0;
        }

        const values = claimed.map((_: unknown, i: number) => {
            const offset = i * 4;
            return `($${offset + 1}, NULL, $${offset + 2}, $${offset + 3}, 'NEGATIVO', 'ASENTADO', $${offset + 4})`;
        }).join(', ');

        const params = claimed.flatMap((r: { userContextId: number; esperadoIn: string | null; esperadoOut: string | null; marcadoInAt: string | null }) => {
            const sinEntrada = r.marcadoInAt === null;
            const titulo = sinEntrada ? 'Ausencia sin marcar' : 'Salida sin marcar';
            const fecha = sinEntrada ? r.esperadoIn! : r.esperadoOut!;
            const fechaTexto = formatFechaHora(parseTimestampAR(fecha));
            const descripcion = sinEntrada
                ? `No se presentó a trabajar el ${fechaTexto}.`
                : `No marcó la salida de su turno del ${fechaTexto}.`;
            return [r.userContextId, titulo, descripcion, fecha];
        });

        await client.query(
            `INSERT INTO reportes (usuario_reportado_id, creador_id, titulo, descripcion, categoria, estado, fecha_incidente)
             VALUES ${values}`,
            params
        );

        await client.query('COMMIT');
        return claimed.length;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

