import { pool } from './pgClient';
import {
    TipoLicenciaDTO,
    SaldoAusenciaDTO,
    SolicitudAusenciaDTO,
    CreateSolicitudDTO,
    EstadoSolicitud,
    SolicitudFilterDTO,
    SolicitudDTO,
    SaldoBloqueado,
    DescuentoSaldo,
    SolicitudDescontada,
    ReintegroSaldo
} from '../../domain/dto/LicenciaDTO';
import { PoolClient } from 'pg';

// Compatibilidad: las versiones instaladas de la app leen `cantidad_horas` en horas × 10. La
// columna ahora es `cantidad_minutos`; se agrega el campo viejo calculado (exacto: la creación
// exige múltiplos de media hora). Quitar cuando no queden versiones viejas.
const conCantidadHorasCompat = <T extends { cantidad_minutos?: number | null }>(row: T): T & { cantidad_horas: number | null } =>
    row && {
        ...row,
        cantidad_horas: row.cantidad_minutos == null ? null : Math.round(Number(row.cantidad_minutos) / 6),
    };

const ESTADOS_EXPIRABLES_AUSENCIA: EstadoSolicitud[] = [
    EstadoSolicitud.PENDIENTE,
];

export const getTiposLicencia = async (): Promise<TipoLicenciaDTO[]> => {
    const result = await pool.query('SELECT * FROM tipos_licencia ORDER BY nombre');
    return result.rows;
};

export const getTipoLicenciaById = async (id: number): Promise<TipoLicenciaDTO | null> => {
    const result = await pool.query('SELECT * FROM tipos_licencia WHERE id = $1', [id]);
    return result.rows[0] || null;
};

export const getLicenciasAprobadasRepo = async (): Promise<SolicitudDTO[]> => {
    const query = `
        SELECT usuario_id, fecha_inicio, fecha_fin
        FROM solicitudes_ausencia
        WHERE estado = 'APROBADO'
    `
    const result = await pool.query(query);
    return result.rows;
}

export const getSaldosByUsuario = async (usuarioId: number): Promise<SaldoAusenciaDTO[]> => {
    const query = `
        SELECT 
            s.id, s.dias_otorgados, s.dias_consumidos, s.residuo,
            t.nombre AS tipo_nombre
        FROM saldos_ausencia s
        LEFT JOIN tipos_licencia t ON s.tipo_licencia_id = t.id
        WHERE s.usuario_id = $1
        ORDER BY s.tipo_licencia_id
    `;
    const result = await pool.query(query, [usuarioId]);
    return result.rows;
};

export const getSaldosVacacionesByUsuario = async (usuarioId: number): Promise<SaldoAusenciaDTO[]> => {
    const query = `
        SELECT
            s.id, s.dias_otorgados, s.dias_consumidos, s.residuo,
            t.nombre AS tipo_nombre
        FROM saldos_ausencia s
        JOIN tipos_licencia t ON s.tipo_licencia_id = t.id
        WHERE s.usuario_id = $1 AND t.codigo = 'VACACIONES'
    `;
    const result = await pool.query(query, [usuarioId]);
    return result.rows;
};

export interface SaldoVacacionesRow {
    userContextId: number;
    nombre: string;
    apellido: string;
    rolNombre: string;
    diasOtorgados: number; // décimas de día
    diasConsumidos: number; // décimas de día
}

// INNER JOIN a propósito: quien no tiene fila de vacaciones no aparece.
export const getSaldosVacacionesTodos = async ({ idRolViewer }: { idRolViewer?: number | undefined }): Promise<SaldoVacacionesRow[]> => {
    const result = await pool.query(
        `SELECT
            vi.user_context_id AS "userContextId",
            vi.nombre,
            vi.apellido,
            vi.rol_nombre AS "rolNombre",
            s.dias_otorgados AS "diasOtorgados",
            s.dias_consumidos AS "diasConsumidos"
         FROM saldos_ausencia s
         JOIN tipos_licencia t ON t.id = s.tipo_licencia_id AND t.codigo = 'VACACIONES'
         JOIN v_interno_users vi ON vi.user_context_id = s.usuario_id
         WHERE ($1::int IS NULL OR vi.id_rol >= $1)
         ORDER BY vi.apellido, vi.nombre`,
        [idRolViewer ?? null]
    );
    return result.rows.map(r => ({
        ...r,
        diasOtorgados: Number(r.diasOtorgados),
        diasConsumidos: Number(r.diasConsumidos),
    }));
};

export const getSaldoEspecifico = async (usuarioId: number, tipoId: number): Promise<SaldoAusenciaDTO | null> => {
    const query = `
        SELECT s.*, t.nombre as tipo_nombre
        FROM saldos_ausencia s
        JOIN tipos_licencia t ON s.tipo_licencia_id = t.id
        WHERE s.usuario_id = $1 AND s.tipo_licencia_id = $2
    `;
    const result = await pool.query(query, [usuarioId, tipoId]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
        ...row,
        dias_disponibles: row.dias_otorgados - row.dias_consumidos
    };
};

export const findOverlappingSolicitudes = async (usuarioId: number, fechaInicio: Date, fechaFin: Date): Promise<SolicitudAusenciaDTO[]> => {
    const query = `
        SELECT * FROM solicitudes_ausencia
        WHERE usuario_id = $1 
        AND estado NOT IN ('RECHAZADA', 'CANCELADA', 'EXPIRADA')
        AND (fecha_inicio <= $3 AND fecha_fin >= $2)
    `;
    const result = await pool.query(query, [usuarioId, fechaInicio, fechaFin]);
    return result.rows;
};

export interface SolicitudUsuarioRow {
    usuario_id: number;
    fecha_inicio: Date;
    fecha_fin: Date;
    nombre: string;
    apellido: string;
}

export const findApprovedSolicitudesForUsersInRange = async (
    userIds: number[],
    desde: Date,
    hasta: Date,
): Promise<SolicitudUsuarioRow[]> => {
    const query = `
        SELECT s.usuario_id, s.fecha_inicio, s.fecha_fin, vi.nombre, vi.apellido
        FROM solicitudes_ausencia s
        JOIN v_interno_users vi ON vi.user_context_id = s.usuario_id
        WHERE s.usuario_id = ANY($1::int[])
          AND s.estado = 'APROBADA'
          AND s.deleted_at IS NULL
          AND s.fecha_inicio <= $3
          AND s.fecha_fin >= $2
    `;
    const result = await pool.query(query, [userIds, desde, hasta]);
    return result.rows;
};

export const findApprovedSolicitudesByDateRange = async (
    usuarioId: number,
    fechaInicio: Date,
    fechaFin: Date,
): Promise<SolicitudAusenciaDTO[]> => {
    const query = `
        SELECT s.*, t.nombre as tipo_nombre
        FROM solicitudes_ausencia s
        LEFT JOIN tipos_licencia t ON t.id = s.tipo_licencia_id
        WHERE s.usuario_id = $1
          AND s.estado = 'APROBADA'
          AND s.deleted_at IS NULL
          AND (s.fecha_inicio <= $3 AND s.fecha_fin >= $2)
        ORDER BY s.fecha_inicio ASC
    `;

    const result = await pool.query(query, [usuarioId, fechaInicio, fechaFin]);
    return result.rows;
};

const expirarSolicitudesAusenciaVencidasConFiltro = async (
    whereSql: string,
    whereValues: any[],
    estadosDesde: EstadoSolicitud[] = ESTADOS_EXPIRABLES_AUSENCIA
): Promise<SolicitudAusenciaDTO[]> => {
    const query = `
        UPDATE solicitudes_ausencia s
        SET estado = $1,
            updated_at = NOW()
        WHERE s.fecha_inicio IS NOT NULL
                    AND s.fecha_inicio <= NOW()
                    AND s.estado::text = ANY($2::text[])
          AND ${whereSql}
        RETURNING s.*
    `;

    const values = [
        EstadoSolicitud.EXPIRADA,
        estadosDesde,
        ...whereValues,
    ];

    const result = await pool.query(query, values);
    return result.rows;
};

export const expirarSolicitudesAusenciaVencidas = async (): Promise<SolicitudAusenciaDTO[]> => {
    return await expirarSolicitudesAusenciaVencidasConFiltro('1=1', []);
};

export const expirarSolicitudesAusenciaVencidasSinDocumentacion = async (): Promise<SolicitudAusenciaDTO[]> => {
    return await expirarSolicitudesAusenciaVencidasConFiltro(
        's.fecha_inicio <= (NOW() - INTERVAL \'24 hours\')',
        [],
        [EstadoSolicitud.PENDIENTE_DOCUMENTACION]
    );
};

export const expirarSolicitudesAusenciaVencidasPorUsuario = async (usuarioId: number): Promise<SolicitudAusenciaDTO[]> => {
    return await expirarSolicitudesAusenciaVencidasConFiltro('s.usuario_id = $3', [usuarioId]);
};

export const expirarSolicitudesAusenciaVencidasPorSolicitud = async (solicitudId: number): Promise<SolicitudAusenciaDTO[]> => {
    return await expirarSolicitudesAusenciaVencidasConFiltro('s.id = $3', [solicitudId]);
};

export const createSolicitud = async (
    userContextId: number,
    data: CreateSolicitudDTO,
    fechaFin: Date,
    cantidadDiasDb: number | null,
    cantidadMinutosDb: number | null,
    estadoInicial: EstadoSolicitud
): Promise<SolicitudAusenciaDTO> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const query = `
            INSERT INTO solicitudes_ausencia (
                usuario_id, tipo_licencia_id, fecha_inicio, fecha_fin, 
                cantidad_dias, cantidad_minutos, estado, observacion_solicitud
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;
        const values = [
            userContextId,
            data.tipo_licencia_id,
            data.fecha_inicio,
            fechaFin,
            cantidadDiasDb,
            cantidadMinutosDb,
            estadoInicial,
            data.observacion
        ];

        const result = await client.query(query, values);
        const nuevaSolicitud = result.rows[0];

        if (data.archivosIds?.length) {
            const insertArchivosQuery = `
            INSERT INTO solicitudes_archivos (solicitud_id, archivo_id)
            VALUES ${data.archivosIds
                    .map((_, i) => `($1, $${i + 2})`)
                    .join(', ')}
            ON CONFLICT DO NOTHING;
            `;

            await client.query(insertArchivosQuery, [
                nuevaSolicitud.id,
                ...data.archivosIds
            ]);
        }

        await client.query('COMMIT');
        return conCantidadHorasCompat(nuevaSolicitud);
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    
};

export const getSolicitudById = async (id: number): Promise<SolicitudAusenciaDTO | null> => {
    const query = `
        SELECT s.*, u.nombre as usuario_nombre, u.apellido as usuario_apellido, t.nombre as tipo_nombre,
        (SELECT COUNT(*) > 0 FROM solicitudes_archivos sa JOIN archivos a2 ON a2.id = sa.archivo_id AND a2.uso = 'LICENCIA' AND a2.deleted_at IS NULL WHERE sa.solicitud_id = s.id) as archivos_adjuntos
        FROM solicitudes_ausencia s
        JOIN v_interno_users u ON s.usuario_id = u.user_context_id
        JOIN tipos_licencia t ON s.tipo_licencia_id = t.id
        WHERE s.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] ? conCantidadHorasCompat(result.rows[0]) : null;
};

export const getSolicitudesPendingNumber = async (role_id: number): Promise<number> => {
    const query = `
        SELECT COUNT(*) as licencias_count
        FROM solicitudes_ausencia s
        JOIN v_interno_users u ON s.usuario_id = u.user_context_id
        WHERE s.estado = 'PENDIENTE' AND u.id_rol > $1
    `;
    const result = await pool.query(query, [role_id]);
    return parseInt(result.rows[0].licencias_count);
};

// "Unseen" para licencias, del lado del solicitante: no hay tabla de lectura,
// así que se define como "no está en un estado final" (mismo criterio que reportes).
export const getSolicitudesPendingByUser = async (usuarioId: number): Promise<number> => {
    const query = `
        SELECT COUNT(*) as licencias_count
        FROM solicitudes_ausencia
        WHERE usuario_id = $1
          AND estado IN ('PENDIENTE', 'PENDIENTE_DOCUMENTACION', 'PENDIENTE_APROBACION')
    `;
    const result = await pool.query(query, [usuarioId]);
    return parseInt(result.rows[0].licencias_count);
};

export const updateSolicitudEstado = async (
    id: number,
    estado: EstadoSolicitud,
    aprobadorId?: number,
    observacionRespuesta?: string,
    client: PoolClient | typeof pool = pool
): Promise<SolicitudAusenciaDTO> => {
    let query = 'UPDATE solicitudes_ausencia SET estado = $2, updated_at = NOW()';
    const values: any[] = [id, estado];
    let paramIndex = 3;

    if (aprobadorId) {
        query += `, aprobador_id = $${paramIndex++}`;
        values.push(aprobadorId);
        query += `, fecha_respuesta = NOW()`;
    }

    if (observacionRespuesta) {
        query += `, observacion_respuesta = $${paramIndex++}`;
        values.push(observacionRespuesta);
    }

    query += ' WHERE id = $1 RETURNING *';

    const result = await client.query(query, values);
    return conCantidadHorasCompat(result.rows[0]);
};

export const addArchivoToSolicitud = async (solicitudId: number, archivoId: number): Promise<void> => {
    await pool.query(
        'INSERT INTO solicitudes_archivos (solicitud_id, archivo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [solicitudId, archivoId]
    );
};

export const countArchivosSolicitud = async (solicitudId: number): Promise<number> => {
    const result = await pool.query(
        'SELECT COUNT(*) as count FROM solicitudes_archivos WHERE solicitud_id = $1',
        [solicitudId]
    );
    return parseInt(result.rows[0].count);
};

export const getIdRolByUserContextId = async (userContextId: number): Promise<number | null> => {
    const result = await pool.query(
        'SELECT id_rol FROM v_interno_users WHERE user_context_id = $1',
        [userContextId]
    );
    return result.rows.length > 0 ? result.rows[0].id_rol : null;
};

export const getSolicitudes = async (filters: SolicitudFilterDTO): Promise<SolicitudAusenciaDTO[]> => {
    let query = `
        SELECT s.*,
               u.nombre as usuario_nombre,
               u.apellido as usuario_apellido,
               u.id_rol as usuario_id_rol,
               t.nombre as tipo_nombre,
               ap.nombre as aprobador_nombre,
               ap.apellido as aprobador_apellido,
               COALESCE(
                   JSON_AGG(
                       JSON_BUILD_OBJECT(
                           'id', a.id,
                           'nombre', a.nombre,
                           'ruta_r2', a.ruta_r2,
                           'tamaño', a.tamaño,
                           'tipo', at.nombre,
                           'created_at', a.created_at
                       )
                   ) FILTER (WHERE a.id IS NOT NULL),
                   '[]'
               ) as archivos
        FROM solicitudes_ausencia s
        JOIN v_interno_users u ON s.usuario_id = u.user_context_id
        JOIN tipos_licencia t ON s.tipo_licencia_id = t.id
        LEFT JOIN v_interno_users ap ON s.aprobador_id = ap.user_context_id
        LEFT JOIN solicitudes_archivos sa ON s.id = sa.solicitud_id
        LEFT JOIN archivos a ON sa.archivo_id = a.id AND a.deleted_at IS NULL AND a.uso = 'LICENCIA'
        LEFT JOIN archivos_tipos at ON a.id_tipo = at.id
        WHERE 1=1
    `;
    const values: any[] = [];
    let paramIndex = 1;

    if (filters.exclude_usuario_id) {
        query += ` AND s.usuario_id != $${paramIndex++}`;
        values.push(filters.exclude_usuario_id);
    }
    if (filters.usuario_id) {
        query += ` AND s.usuario_id = $${paramIndex++}`;
        values.push(filters.usuario_id);
    }
    if (filters.id_rol_max_creador !== undefined) {
        // Solo solicitudes de usuarios con rango menor al aprobador (id_rol más grande)
        query += ` AND u.id_rol > $${paramIndex++}`;
        values.push(filters.id_rol_max_creador);
    }
    if (filters.estado) {
        query += ` AND s.estado = $${paramIndex++}`;
        values.push(filters.estado);
    }
    if (filters.tipo_licencia_id) {
        query += ` AND s.tipo_licencia_id = $${paramIndex++}`;
        values.push(filters.tipo_licencia_id);
    }
    if (filters.fecha_desde) {
        query += ` AND s.fecha_inicio >= $${paramIndex++}`;
        values.push(filters.fecha_desde);
    }
    if (filters.fecha_hasta) {
        query += ` AND s.fecha_fin <= $${paramIndex++}`;
        values.push(filters.fecha_hasta);
    }

    query += ' GROUP BY s.id, u.nombre, u.apellido, u.id_rol, t.nombre, ap.nombre, ap.apellido';
    query += ' ORDER BY s.created_at DESC';

    const result = await pool.query(query, values);
    return result.rows.map(conCantidadHorasCompat);
};

export const getSolicitudesByUsuario = async (usuarioId: number): Promise<SolicitudAusenciaDTO[]> => {
    const query = `
        SELECT s.*, 
               t.nombre as tipo_nombre,
               COALESCE(
                   JSON_AGG(
                       JSON_BUILD_OBJECT(
                           'id', a.id,
                           'nombre', a.nombre,
                           'ruta_r2', a.ruta_r2,
                           'tamaño', a.tamaño,
                           'tipo', at.nombre,
                           'created_at', a.created_at
                       )
                   ) FILTER (WHERE a.id IS NOT NULL),
                   '[]'
               ) as archivos
        FROM solicitudes_ausencia s
        JOIN tipos_licencia t ON s.tipo_licencia_id = t.id
        LEFT JOIN solicitudes_archivos sa ON s.id = sa.solicitud_id
        LEFT JOIN archivos a ON sa.archivo_id = a.id AND a.deleted_at IS NULL AND a.uso = 'LICENCIA'
        LEFT JOIN archivos_tipos at ON a.id_tipo = at.id
        WHERE s.usuario_id = $1
        GROUP BY s.id, t.nombre
        ORDER BY s.created_at DESC
    `;
    const result = await pool.query(query, [usuarioId]);
    return result.rows.map(conCantidadHorasCompat);
};

const bloquearSaldo = async (client: PoolClient, usuarioId: number, tipoId: number): Promise<SaldoBloqueado | null> => {
    const result = await client.query(
        `SELECT dias_otorgados, dias_consumidos, residuo
         FROM saldos_ausencia
         WHERE usuario_id = $1 AND tipo_licencia_id = $2
         FOR UPDATE`,
        [usuarioId, tipoId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        dias_otorgados: Number(row.dias_otorgados),
        dias_consumidos: Number(row.dias_consumidos),
        residuo: Number(row.residuo ?? 0),
    };
};

// Aprueba la solicitud. Con `saldo`, bloquea la fila del saldo y calcula el descuento sobre la fila
// bloqueada (regla en licenciasServices); `calcular` puede tirar error para abortar.
export const executeApprovalTransaction = async (
    solicitudId: number,
    aprobadorId: number,
    observacion: string | undefined,
    saldo: { usuarioId: number, tipoId: number, calcular: (fila: SaldoBloqueado | null) => DescuentoSaldo } | null,
    // Franco por días (el de horas lo consume la aplicación de la licencia según el solape con los turnos).
    francoUpdate: { userContextId: number, minutos: number } | null,
    // Aplica la licencia a los turnos (regla en licenciasTurnosServices); corre en esta transacción.
    aplicarLicenciaATurnos: (client: PoolClient) => Promise<void>
): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (francoUpdate) {
            const minutosAConsumir = Math.max(0, francoUpdate.minutos);

            if (minutosAConsumir > 0) {
                const francoResult = await client.query(
                    `INSERT INTO saldos_francos (user_context_id, minutos_disponibles, minutos_consumidos, updated_at)
                     VALUES ($1, 0, $2, now())
                     ON CONFLICT (user_context_id) DO UPDATE
                       SET minutos_consumidos = saldos_francos.minutos_consumidos + EXCLUDED.minutos_consumidos,
                           updated_at         = now()
                     RETURNING minutos_disponibles, minutos_consumidos`,
                    [francoUpdate.userContextId, minutosAConsumir]
                );
                const francoRow = francoResult.rows[0];
                await client.query(
                    `INSERT INTO saldos_francos_movimientos
                       (user_context_id, tipo_movimiento, minutos,
                        minutos_disponibles_resultante, minutos_consumidos_resultante, solicitud_ausencia_id)
                     VALUES ($1, 'consumo', $2, $3, $4, $5)`,
                    [
                        francoUpdate.userContextId,
                        minutosAConsumir,
                        francoRow?.minutos_disponibles ?? null,
                        francoRow?.minutos_consumidos ?? null,
                        solicitudId,
                    ]
                );
            }
        }

        let residuoAlAprobar: number | null = null;
        let diasDescontados: number | null = null;

        if (saldo) {
            const fila = await bloquearSaldo(client, saldo.usuarioId, saldo.tipoId);
            const descuento = saldo.calcular(fila);

            await client.query(
                `UPDATE saldos_ausencia
                 SET dias_consumidos = dias_consumidos + $3, residuo = $4, updated_at = NOW()
                 WHERE usuario_id = $1 AND tipo_licencia_id = $2`,
                [saldo.usuarioId, saldo.tipoId, descuento.dias, descuento.nuevoResiduo]
            );
            residuoAlAprobar = fila?.residuo ?? 0;
            diasDescontados = descuento.dias;
        }

        const updateQuery = `
            UPDATE solicitudes_ausencia
            SET estado = $2,
                aprobador_id = $3,
                observacion_respuesta = $4,
                fecha_respuesta = NOW(),
                residuo_al_aprobar = $5,
                dias_descontados = $6,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        await client.query(updateQuery, [
            solicitudId,
            EstadoSolicitud.APROBADA,
            aprobadorId,
            observacion,
            residuoAlAprobar,
            diasDescontados,
        ]);

        // Aplica la licencia a los turnos existentes (por días marca los turnos cubiertos; por horas
        // recorta/marca y consume el franco por el solape).
        await aplicarLicenciaATurnos(client);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// Transaction helper for cancellation (refund with residuo rollback)
export const executeCancellationTransaction = async (
    solicitudId: number,
    // Con `saldo`, bloquea la fila del saldo, lee la solicitud cancelada y las aprobadas después
    // (mismo usuario y tipo, en orden de aprobación) y aplica el reintegro que calcula `recalcular`.
    saldo: {
        usuarioId: number,
        tipoId: number,
        recalcular: (cancelada: SolicitudDescontada, posteriores: SolicitudDescontada[]) => ReintegroSaldo,
    } | null,
    francoRefund: { userContextId: number, minutos: number } | null,
    revertirTurnos: boolean,
    // Revierte la licencia en los turnos (regla en licenciasTurnosServices); corre en esta transacción.
    revertirLicenciaEnTurnos: (client: PoolClient) => Promise<void>
): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 0. Reintegrar saldo de francos si corresponde (minutos)
        if (francoRefund) {
            await client.query(
                `SELECT 1 FROM saldos_francos WHERE user_context_id = $1 FOR UPDATE`,
                [francoRefund.userContextId]
            );
            const francoResult = await client.query(
                `UPDATE saldos_francos
                 SET minutos_disponibles = minutos_disponibles + $2,
                     updated_at          = now()
                 WHERE user_context_id = $1
                 RETURNING minutos_disponibles, minutos_consumidos`,
                [francoRefund.userContextId, francoRefund.minutos]
            );
            const francoRow = francoResult.rows[0];
            await client.query(
                `INSERT INTO saldos_francos_movimientos
                   (user_context_id, tipo_movimiento, minutos,
                    minutos_disponibles_resultante, minutos_consumidos_resultante, solicitud_ausencia_id)
                 VALUES ($1, 'reintegro', $2, $3, $4, $5)`,
                [
                    francoRefund.userContextId,
                    francoRefund.minutos,
                    francoRow?.minutos_disponibles ?? null,
                    francoRow?.minutos_consumidos ?? null,
                    solicitudId,
                ]
            );
        }

        // 1. Reintegrar el saldo de días
        if (saldo) {
            await bloquearSaldo(client, saldo.usuarioId, saldo.tipoId);

            const columnas = `id, cantidad_dias, residuo_al_aprobar, dias_descontados, fecha_respuesta`;
            const canceladaRes = await client.query(
                `SELECT ${columnas} FROM solicitudes_ausencia WHERE id = $1 FOR UPDATE`,
                [solicitudId]
            );
            const cancelada = canceladaRes.rows[0];
            if (cancelada) {
                const posterioresRes = await client.query(
                    `SELECT ${columnas}
                     FROM solicitudes_ausencia
                     WHERE usuario_id = $1 AND tipo_licencia_id = $2
                       AND estado IN ('${EstadoSolicitud.APROBADA}', '${EstadoSolicitud.CONSUMIDA}')
                       AND id <> $3
                       AND (fecha_respuesta, id) > ($4::timestamp, $3)
                     ORDER BY fecha_respuesta, id
                     FOR UPDATE`,
                    [saldo.usuarioId, saldo.tipoId, solicitudId, cancelada.fecha_respuesta]
                );
                const aDescontada = (r: any): SolicitudDescontada => ({
                    id: Number(r.id),
                    cantidad_dias: Number(r.cantidad_dias ?? 0),
                    residuo_al_aprobar: r.residuo_al_aprobar == null ? null : Number(r.residuo_al_aprobar),
                    dias_descontados: r.dias_descontados == null ? null : Number(r.dias_descontados),
                });
                const reintegro = saldo.recalcular(aDescontada(cancelada), posterioresRes.rows.map(aDescontada));

                await client.query(
                    `UPDATE saldos_ausencia
                     SET dias_consumidos = dias_consumidos - $3, residuo = $4, updated_at = NOW()
                     WHERE usuario_id = $1 AND tipo_licencia_id = $2`,
                    [saldo.usuarioId, saldo.tipoId, reintegro.diasADevolver, reintegro.nuevoResiduo]
                );
                for (const p of reintegro.posteriores) {
                    await client.query(
                        `UPDATE solicitudes_ausencia
                         SET residuo_al_aprobar = $2, dias_descontados = $3, updated_at = NOW()
                         WHERE id = $1`,
                        [p.id, p.residuo_al_aprobar, p.dias_descontados]
                    );
                }
            }
        }

        // 3. Update solicitud estado
        await updateSolicitudEstado(solicitudId, EstadoSolicitud.CANCELADA, undefined, undefined, client);

        // 4. Revertir la licencia en los turnos: solo si estaba aprobada, que es cuando se aplicó.
        if (revertirTurnos) {
            await revertirLicenciaEnTurnos(client);
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
 * Obtiene el usuario_id de una solicitud de ausencia
 */
export const getUsuarioIdBySolicitudId = async (solicitudId: number): Promise<number | null> => {
    const query = `
        SELECT usuario_id
        FROM solicitudes_ausencia
        WHERE id = $1
    `;

    const result = await pool.query(query, [solicitudId]);
    return result.rows.length > 0 ? result.rows[0].usuario_id : null;
};

export interface SolicitudParaConsumirRow {
    id: number;
    usuario_id: number;
    tipo_licencia_id: number;
}

// Candidatas APROBADA cuya fecha_fin ya pasó: aún no fueron marcadas CONSUMIDA.
export const getSolicitudesAprobadasParaConsumir = async (): Promise<SolicitudParaConsumirRow[]> => {
    const result = await pool.query(
        `SELECT id, usuario_id, tipo_licencia_id
         FROM solicitudes_ausencia
         WHERE estado = 'APROBADA' AND fecha_fin <= NOW()`
    );
    return result.rows;
};

// Claim atómico: solo actualiza (y devuelve > 0) las que siguen APROBADA, para que
// corridas concurrentes o repetidas del sweep no reprocesen la misma solicitud.
export const marcarSolicitudesConsumidas = async (ids: number[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const result = await pool.query(
        `UPDATE solicitudes_ausencia SET estado = 'CONSUMIDA', updated_at = NOW()
         WHERE id = ANY($1::int[]) AND estado = 'APROBADA'`,
        [ids]
    );
    return result.rowCount || 0;
};
