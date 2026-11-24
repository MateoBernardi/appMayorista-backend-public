import { pool } from './pgClient';
import { EncuestaDTO, EncuestaConPreguntasDTO, EncuestaConRespuestasDTO } from '../../domain/dto/EncuestasDTO';
import { PreguntaDTO } from '../../domain/dto/EncuestasDTO';
import { OpcionDTO } from '../../domain/dto/EncuestasDTO';
import { RespuestaDTO } from '../../domain/dto/EncuestasDTO';
import { CrearEncuestaInput, CrearPreguntaInput, CrearRespuestaInput } from '../../domain/dto/EncuestasDTO';
import { TipoCategoria, TipoPregunta, TipoEvaluado } from '../../types/encuestas';
import { ConflictError } from '../errors/AppError';

const EMPLOYEE_ROLE_FILTER = "(u.rol_nombre IN ('empleado', 'encargado', 'presidencia', 'consejo', 'gerencia') OR u.rol_nombre LIKE 'empleado-%')";

/**
 * Crear una encuesta nueva
 */
export const crearEncuesta = async (data: CrearEncuestaInput): Promise<EncuestaDTO> => {
    const result = await pool.query(
        `INSERT INTO encuestas (titulo, descripcion, categoria, es_anonima, fecha_fin)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.titulo, data.descripcion, data.categoria, data.es_anonima, data.fecha_fin]
    );
    return result.rows[0];
};

/**
 * Obtener todas las encuestas
 */
export const getEncuestas = async (): Promise<EncuestaDTO[]> => {
    const result = await pool.query(
        `SELECT * FROM encuestas WHERE deleted_at IS NULL ORDER BY fecha_creacion DESC`
    );
    return result.rows;
};

/**
 * Obtener una encuesta por ID
 */
export const getEncuestaById = async (id: number): Promise<EncuestaDTO | null> => {
    const result = await pool.query(
        `SELECT * FROM encuestas WHERE id = $1 AND deleted_at IS NULL`,
        [id]
    );
    return result.rows[0] || null;
};

/**
 * Obtener encuestas por categoría
 */
export const getEncuestasPorCategoria = async (categoria: TipoCategoria, userContextId: number): Promise<any[]> => {
    // Devuelve encuestas de la categoría donde el usuario NO haya respondido ninguna pregunta,
    // incluyendo las preguntas (no respondidas) y sus opciones en una sola query
    // Solo para usuarios con rol_nombre = 'empleado' o 'encargado' en v_usuario_entidad_completo
    const result = await pool.query(
        `SELECT 
            e.*, 
            COALESCE(json_agg(
                DISTINCT jsonb_build_object(
                    'id', p.id,
                    'encuesta_id', p.encuesta_id,
                    'titulo', p.titulo,
                    'tipo_pregunta', p.tipo_pregunta,
                    'orden', p.orden,
                    'es_obligatoria', p.es_obligatoria,
                    'opciones', (
                        SELECT COALESCE(json_agg(jsonb_build_object('id', o.id, 'pregunta_id', o.pregunta_id, 'texto_opcion', o.texto_opcion, 'respuestas_count', (SELECT COUNT(*) FROM respuestas r WHERE r.opcion_id = o.id))), '[]'::json)
                        FROM opciones o WHERE o.pregunta_id = p.id
                    )
                )
            ) FILTER (WHERE p.id IS NOT NULL), '[]') AS preguntas
        FROM encuestas e
        LEFT JOIN preguntas p ON p.encuesta_id = e.id
            AND p.id NOT IN (
                SELECT r.pregunta_id FROM respuestas r WHERE r.usuario_id = $2
            )
        LEFT JOIN v_usuario_entidad_completo u ON u.user_context_id = $2
        WHERE (e.categoria = $1 AND e.fecha_fin > NOW() AND e.deleted_at IS NULL)
        AND ${EMPLOYEE_ROLE_FILTER}
        AND (
            NOT EXISTS (SELECT 1 FROM encuestas_usuarios_visibilidad WHERE encuesta_id = e.id)
            OR EXISTS (SELECT 1 FROM encuestas_usuarios_visibilidad WHERE encuesta_id = e.id AND usuario_id = $2)
        )
        AND NOT EXISTS (
            SELECT 1 FROM preguntas p2
            JOIN respuestas r2 ON r2.pregunta_id = p2.id
            WHERE p2.encuesta_id = e.id AND r2.usuario_id = $2
        )
        GROUP BY e.id
        ORDER BY e.fecha_creacion DESC`,
        [categoria, userContextId]
    );
    return result.rows;
};

/**
 * Crear una pregunta con sus opciones (si aplica)
 */
export const crearPregunta = async (data: CrearPreguntaInput): Promise<PreguntaDTO> => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Crear la pregunta
        const preguntaResult = await client.query(
            `INSERT INTO preguntas (encuesta_id, titulo, tipo_pregunta, orden, es_obligatoria)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [data.encuesta_id, data.titulo, data.tipo_pregunta, data.orden, data.es_obligatoria ?? true]
        );
        
        const pregunta = preguntaResult.rows[0];
        
        // Si tiene opciones (para preguntas de opción múltiple), crearlas
        if (data.opciones && data.opciones.length > 0) {
            for (const textoOpcion of data.opciones) {
                await client.query(
                    `INSERT INTO opciones (pregunta_id, texto_opcion)
                     VALUES ($1, $2)`,
                    [pregunta.id, textoOpcion]
                );
            }
        }
        
        await client.query('COMMIT');
        return pregunta;
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Crear una encuesta completa con sus preguntas
 */
export const crearEncuestaCompleta = async (
    encuesta: CrearEncuestaInput,
    preguntas: Omit<CrearPreguntaInput, 'encuesta_id'>[],
    invitados: number[] = []
): Promise<EncuestaConPreguntasDTO> => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Crear la encuesta
        const encuestaResult = await client.query(
            `INSERT INTO encuestas (titulo, descripcion, categoria, es_anonima, fecha_fin, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [encuesta.titulo, encuesta.descripcion, encuesta.categoria, encuesta.es_anonima, encuesta.fecha_fin, encuesta.created_by ?? null]
        );
        
        const encuestaCreada = encuestaResult.rows[0];
        const preguntasCreadas: (PreguntaDTO & { opciones?: OpcionDTO[] })[] = [];
        
        // Crear todas las preguntas
        for (const preguntaData of preguntas) {
            const preguntaResult = await client.query(
                `INSERT INTO preguntas (encuesta_id, titulo, tipo_pregunta, orden, es_obligatoria)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [encuestaCreada.id, preguntaData.titulo, preguntaData.tipo_pregunta, preguntaData.orden, preguntaData.es_obligatoria ?? true]
            );
            
            const pregunta = preguntaResult.rows[0];
            
            // Si tiene opciones, crearlas
            if (preguntaData.opciones && preguntaData.opciones.length > 0) {
                const opciones: OpcionDTO[] = [];
                for (const textoOpcion of preguntaData.opciones) {
                    const opcionResult = await client.query(
                        `INSERT INTO opciones (pregunta_id, texto_opcion)
                         VALUES ($1, $2)
                         RETURNING *`,
                        [pregunta.id, textoOpcion]
                    );
                    opciones.push(opcionResult.rows[0]);
                }
                pregunta.opciones = opciones;
            }
            
            preguntasCreadas.push(pregunta);
        }
        
        if (invitados.length > 0) {
            for (const usuarioId of invitados) {
                await client.query(
                    `INSERT INTO encuestas_usuarios_visibilidad (encuesta_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [encuestaCreada.id, usuarioId]
                );
            }
        }

        await client.query('COMMIT');

        return {
            ...encuestaCreada,
            preguntas: preguntasCreadas
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Crear múltiples respuestas (para completar una encuesta completa)
 */
export const crearRespuestas = async (usuario_id: number, respuestas: CrearRespuestaInput[]): Promise<RespuestaDTO[]> => {
    const client = await pool.connect();

    // Ordenar por opcion_id para que dos transacciones concurrentes que tocan
    // los mismos slots los bloqueen siempre en el mismo orden y no generen deadlock.
    const respuestasOrdenadas = [...respuestas].sort((a, b) => (a.opcion_id ?? Infinity) - (b.opcion_id ?? Infinity));

    try {
        await client.query('BEGIN');

        const respuestasCreadas: RespuestaDTO[] = [];

        for (const respuesta of respuestasOrdenadas) {
            if (respuesta.opcion_id) {
                const tipoResult = await client.query(
                    `SELECT tipo_pregunta FROM preguntas WHERE id = $1`,
                    [respuesta.pregunta_id]
                );
                if (tipoResult.rows[0]?.tipo_pregunta === 'horario') {
                    await client.query(`SELECT id FROM opciones WHERE id = $1 FOR UPDATE`, [respuesta.opcion_id]);
                    const countResult = await client.query(
                        `SELECT COUNT(*) AS total FROM respuestas WHERE opcion_id = $1`,
                        [respuesta.opcion_id]
                    );
                    if (parseInt(countResult.rows[0].total, 10) > 0) {
                        throw new ConflictError('Opción ya elegida por otro usuario, por favor seleccioná otra.');
                    }
                }
            }

            const result = await client.query(
                `INSERT INTO respuestas (usuario_id, pregunta_id, opcion_id, respuesta_texto, valor_rating, evaluado_id, evaluado_tipo)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [usuario_id, respuesta.pregunta_id, respuesta.opcion_id, respuesta.respuesta_texto, respuesta.valor_rating, respuesta.evaluado_id, respuesta.evaluado_tipo]
            );
            respuestasCreadas.push(result.rows[0]);
        }

        await client.query('COMMIT');
        return respuestasCreadas;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Obtener encuestas con todas sus respuestas (paginado)
 */
export const getRespuestasEncuesta = async (
    page: number,
    limit: number
): Promise<{ encuestas: EncuestaConRespuestasDTO[]; hasMore: boolean }> => {
    const offset = (page - 1) * limit;

    const result = await pool.query(
        `SELECT
            e.*,
            c.nombre AS creador_nombre, c.apellido AS creador_apellido,
            COALESCE((
                SELECT json_agg(usuario_id) FROM encuesta_convocatorias WHERE encuesta_id = e.id
            ), '[]') AS convocados,
            COALESCE((
                SELECT json_agg(jsonb_build_object('user_context_id', u.user_context_id, 'nombre', u.nombre, 'apellido', u.apellido))
                FROM encuestas_usuarios_visibilidad v
                JOIN v_usuario_entidad_completo u ON u.user_context_id = v.usuario_id
                WHERE v.encuesta_id = e.id
            ), '[]') AS participantes,
            COALESCE((
                SELECT json_agg(jsonb_build_object(
                    'id', p.id,
                    'encuesta_id', p.encuesta_id,
                    'titulo', p.titulo,
                    'tipo_pregunta', p.tipo_pregunta,
                    'orden', p.orden,
                    'es_obligatoria', p.es_obligatoria,
                    'opciones', (
                        SELECT COALESCE(json_agg(o.*), '[]') FROM opciones o WHERE o.pregunta_id = p.id
                    ),
                    'respuestas', (
                        SELECT COALESCE(json_agg(
                            CASE WHEN e.es_anonima THEN
                                jsonb_build_object(
                                    'id', r.id, 'pregunta_id', r.pregunta_id, 'opcion_id', r.opcion_id,
                                    'respuesta_texto', r.respuesta_texto, 'valor_rating', r.valor_rating,
                                    'evaluado_id', r.evaluado_id, 'evaluado_tipo', r.evaluado_tipo,
                                    'fecha_respuesta', r.fecha_respuesta
                                )
                            ELSE
                                jsonb_build_object(
                                    'id', r.id, 'pregunta_id', r.pregunta_id, 'opcion_id', r.opcion_id,
                                    'respuesta_texto', r.respuesta_texto, 'valor_rating', r.valor_rating,
                                    'evaluado_id', r.evaluado_id, 'evaluado_tipo', r.evaluado_tipo,
                                    'fecha_respuesta', r.fecha_respuesta, 'usuario_id', r.usuario_id,
                                    'nombre', u2.nombre, 'apellido', u2.apellido
                                )
                            END
                            ORDER BY r.fecha_respuesta DESC
                        ), '[]')
                        FROM respuestas r
                        LEFT JOIN v_usuario_entidad_completo u2 ON r.usuario_id = u2.user_context_id
                        WHERE r.pregunta_id = p.id
                    )
                ) ORDER BY p.orden)
                FROM preguntas p WHERE p.encuesta_id = e.id
            ), '[]') AS preguntas
         FROM encuestas e
         LEFT JOIN v_usuario_entidad_completo c ON e.created_by = c.user_context_id
         WHERE e.deleted_at IS NULL
         ORDER BY e.fecha_creacion DESC
         LIMIT $1 OFFSET $2`,
        [limit + 1, offset]
    );

    const hasMore = result.rows.length > limit;
    const encuestas = result.rows.slice(0, limit);

    return { encuestas, hasMore };
};

/**
 * Obtener respuestas por usuario_entidad (para encuestas no anónimas)
 */
export const getRespuestasPorUsuario = async (usuarioId: number): Promise<RespuestaDTO[]> => {
    const result = await pool.query(
        `SELECT r.*, p.titulo as pregunta_titulo, e.titulo as encuesta_titulo
         FROM respuestas r
         JOIN preguntas p ON r.pregunta_id = p.id
         JOIN encuestas e ON p.encuesta_id = e.id
         WHERE r.usuario_id = $1 AND e.es_anonima = false
         ORDER BY r.fecha_respuesta DESC`,
        [usuarioId]
    );
    return result.rows;
};

/**
 * Obtener respuestas por evaluado (empleado, sucursal, etc.)
 */
export const getRespuestasPorEvaluado = async (evaluadoId: number, evaluadoTipo: TipoEvaluado): Promise<RespuestaDTO[]> => {
    const result = await pool.query(
        `SELECT r.*, p.titulo as pregunta_titulo, p.tipo_pregunta, e.titulo as encuesta_titulo
         FROM respuestas r
         JOIN preguntas p ON r.pregunta_id = p.id
         JOIN encuestas e ON p.encuesta_id = e.id
         WHERE r.evaluado_id = $1 AND r.evaluado_tipo = $2
         ORDER BY r.fecha_respuesta DESC`,
        [evaluadoId, evaluadoTipo]
    );
    return result.rows;
};

/**
 * Obtener todas las respuestas de una pregunta específica
 */
export const getRespuestasPorPregunta = async (preguntaId: number): Promise<RespuestaDTO[]> => {
    const result = await pool.query(
        `SELECT * FROM respuestas WHERE pregunta_id = $1 ORDER BY fecha_respuesta DESC`,
        [preguntaId]
    );
    return result.rows;
};

export const getTipoPreguntaById = async (preguntaId: number): Promise<TipoPregunta | null> => {
    const result = await pool.query(
        `SELECT tipo_pregunta FROM preguntas WHERE id = $1`,
        [preguntaId]
    );
    return result.rows[0]?.tipo_pregunta ?? null;
};

export const getEncuestaIdByPreguntaId = async (preguntaId: number): Promise<number | null> => {
    const result = await pool.query(
        `SELECT encuesta_id FROM preguntas WHERE id = $1`,
        [preguntaId]
    );
    return result.rows[0]?.encuesta_id ?? null;
};

export const getParticipantesEncuestaIds = async (encuestaId: number): Promise<number[]> => {
    const result = await pool.query(
        `SELECT usuario_id FROM encuesta_convocatorias WHERE encuesta_id = $1
         UNION
         SELECT usuario_id FROM encuestas_usuarios_visibilidad WHERE encuesta_id = $1`,
        [encuestaId]
    );
    return result.rows.map((r: { usuario_id: number }) => r.usuario_id);
};

/**
 * Verificar si un usuario ya respondió una encuesta
 */
export const usuarioRespondioEncuesta = async (usuarioId: number, encuestaId: number): Promise<boolean> => {
    const result = await pool.query(
        `SELECT COUNT(*) as total
         FROM respuestas r
         JOIN preguntas p ON r.pregunta_id = p.id
         WHERE r.usuario_id = $1 AND p.encuesta_id = $2`,
        [usuarioId, encuestaId]
    );
    return parseInt(result.rows[0].total) > 0;
};

/**
 * Estadísticas de una pregunta de rating
 */
export const getEstadisticasRating = async (preguntaId: number) => {
    const result = await pool.query(
        `SELECT 
            COUNT(*) as total_respuestas,
            AVG(valor_rating) as promedio,
            MIN(valor_rating) as minimo,
            MAX(valor_rating) as maximo
         FROM respuestas
         WHERE pregunta_id = $1 AND valor_rating IS NOT NULL`,
        [preguntaId]
    );
    return result.rows[0];
};

/**
 * Estadísticas de una pregunta de opción múltiple
 */
export const getEstadisticasOpcionMultiple = async (preguntaId: number) => {
    const result = await pool.query(
        `SELECT 
            o.id,
            o.texto_opcion,
            COUNT(r.id) as cantidad_votos,
            ROUND(COUNT(r.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM respuestas WHERE pregunta_id = $1), 0), 2) as porcentaje
         FROM opciones o
         LEFT JOIN respuestas r ON o.id = r.opcion_id
         WHERE o.pregunta_id = $1
         GROUP BY o.id, o.texto_opcion
         ORDER BY cantidad_votos DESC`,
        [preguntaId]
    );
    return result.rows;
};

/**
 * Soft delete de una encuesta (marca deleted_at)
 */
export const softDeleteEncuesta = async (id: number, userContextId: number): Promise<EncuestaDTO | null> => {
    const result = await pool.query(
        `UPDATE encuestas SET deleted_at = NOW() WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL RETURNING *`,
        [id, userContextId]
    );
    return result.rows[0] || null;
};

/**
 * Obtener una opción junto al creador de su encuesta, el tipo de pregunta
 * y cuántas opciones tiene la pregunta
 */
export const getOpcionConCreador = async (opcionId: number): Promise<{ id: number; created_by: number | null; tipo_pregunta: TipoPregunta; opciones_count: number } | null> => {
    const result = await pool.query(
        `SELECT o.id, e.created_by, p.tipo_pregunta,
            (SELECT COUNT(*)::int FROM opciones o2 WHERE o2.pregunta_id = p.id) AS opciones_count
         FROM opciones o
         JOIN preguntas p ON p.id = o.pregunta_id
         JOIN encuestas e ON e.id = p.encuesta_id
         WHERE o.id = $1 AND e.deleted_at IS NULL`,
        [opcionId]
    );
    return result.rows[0] || null;
};

/**
 * Eliminar una opción solo si ningún usuario la eligió como respuesta.
 * Devuelve false si la opción tenía respuestas y no se eliminó.
 */
export const deleteOpcionSinRespuestas = async (opcionId: number): Promise<boolean> => {
    const result = await pool.query(
        `DELETE FROM opciones WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM respuestas WHERE opcion_id = $1)`,
        [opcionId]
    );
    return (result.rowCount ?? 0) > 0;
};

export const addParticipantesEncuesta = async (encuestaId: number, usuarioIds: number[]): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const usuarioId of usuarioIds) {
            await client.query(
                `INSERT INTO encuestas_usuarios_visibilidad (encuesta_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [encuestaId, usuarioId]
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

export const removeParticipantesEncuesta = async (encuestaId: number, usuarioIds: number[]): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const usuarioId of usuarioIds) {
            await client.query(
                `DELETE FROM encuestas_usuarios_visibilidad WHERE encuesta_id = $1 AND usuario_id = $2`,
                [encuestaId, usuarioId]
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

export const insertarConvocatorias = async (encuestaId: number, usuarioIds: number[]): Promise<void> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const usuarioId of usuarioIds) {
            await client.query(
                `INSERT INTO encuesta_convocatorias (encuesta_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [encuestaId, usuarioId]
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

