import { Request, Response, NextFunction } from 'express';
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import {
    obtenerEncuestasPorCategoria,
    crearEncuestaCompletaService,
    crearRespuestasService,
    obtenerRespuestasEncuesta,
    eliminarEncuesta,
    handleParticipantesEncuesta,
    crearConvocatoriasService,
    getEncuestaByIdService,
    eliminarOpcionService,
    getTipoPreguntaByIdService,
    getEncuestaIdByPreguntaIdService,
    getParticipantesEncuestaIdsService
} from '../domain/services/encuestasServices';
import { CrearRespuestaInput } from '../domain/dto/EncuestasDTO';
import { TipoCategoria } from '../types/encuestas';
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { getUserIdsByEntorno } from '../domain/services/usuariosServices';
import { emitToUsers } from '../adapters/realtime/socketServer';

// Se usa para "se creó una encuesta nueva" y para "te convocaron a una encuesta existente".
// La encuesta puede ser una encuesta común o una de tipo horario (elegir un turno/franja),
// así que el mensaje no puede asumir cuál de las dos es: el título ya lo deja en claro.
const buildEncuestaNotification = (encuestaId: number, titulo: string) => ({
    title: '🔔 Tenés algo pendiente por responder',
    body: `"${titulo}" te está esperando.`,
    link: 'https://interno.italoarg.com.ar',
    data: { type: 'nueva_encuesta', encuesta_id: encuestaId }
});

/**
 * Emite en vivo, a los demás participantes de la encuesta, qué turnos/franjas
 * (preguntas de tipo 'horario') acaban de quedar tomados en esta respuesta.
 */
const notifyHorarioPicks = async (respuestas: CrearRespuestaInput[], actorUserId: number): Promise<void> => {
    const picks: { pregunta_id: number; opcion_id: number }[] = [];

    for (const respuesta of respuestas) {
        if (!respuesta.opcion_id) continue;
        const tipo = await getTipoPreguntaByIdService(respuesta.pregunta_id);
        if (tipo === 'horario') {
            picks.push({ pregunta_id: respuesta.pregunta_id, opcion_id: respuesta.opcion_id });
        }
    }

    const primerPick = picks[0];
    if (!primerPick) {
        return;
    }

    const encuestaId = await getEncuestaIdByPreguntaIdService(primerPick.pregunta_id);
    if (!encuestaId) {
        return;
    }

    const participantes = await getParticipantesEncuestaIdsService(encuestaId);
    const destinatarios = participantes.filter((id) => id !== actorUserId);
    if (destinatarios.length === 0) {
        return;
    }

    emitToUsers(destinatarios, {
        type: 'horario_opcion_tomada',
        domain: 'encuestas',
        event: 'updated',
        entity_id: String(encuestaId),
        updated_at: new Date().toISOString(),
        picks,
    });
};

/**
 * Obtener encuestas por categoría
 * GET /encuestas/categoria/:categoria
 */
export const getEncuestasPorCategoriaController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { categoria } = req.params;
        const userContextId = requireUserContextId(req);

        // Validar que la categoría sea válida
        const categoriasValidas: TipoCategoria[] = ['interna', 'externa', 'feedback_empleado'];
        if (!categoriasValidas.includes(categoria as TipoCategoria)) {
            throw new NotFoundError('No se encontró ninguna encuesta.');
        }

        const encuestas = await obtenerEncuestasPorCategoria(categoria as TipoCategoria, userContextId);

        res.status(200).json({
            success: true,
            data: encuestas
        });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Crear una encuesta completa con sus preguntas
 * POST /encuestas/completa
 */
export const crearEncuestaCompletaController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { encuesta, preguntas, invitados } = req.body;

        if (!encuesta || !preguntas) {
            throw new NotFoundError('No se encontró ninguna encuesta.');
        }

        const userContextId = requireUserContextId(req);

        const invitadosIds: number[] = Array.isArray(invitados) ? invitados : [];
        const encuestaCreada = await crearEncuestaCompletaService(encuesta, preguntas, userContextId, invitadosIds);

        // Enviar notificación a usuarios según categoría y audiencia
        try {
            let targetUserIds: number[] = [];

            if (encuesta.categoria === 'interna') {
                targetUserIds = invitadosIds.length > 0
                    ? invitadosIds
                    : await getUserIdsByEntorno('interno');
            }

            if (targetUserIds.length > 0) {
                await sendNotificationToMultipleUsers(
                    targetUserIds,
                    buildEncuestaNotification(encuestaCreada.id, encuesta.titulo)
                );
            }
        } catch (notifError) {
            console.error('Error enviando notificación:', notifError);
        }

        res.status(201).json({
            success: true,
            message: 'Encuesta creada exitosamente',
            data: encuestaCreada
        });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Crear múltiples respuestas (responder encuesta)
 * POST /encuestas/respuestas/multiple
 */
export const crearRespuestasController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { respuestas } = req.body;
        const userContextId = requireUserContextId(req);

        if (!respuestas || !Array.isArray(respuestas) || respuestas.length === 0) {
            throw new BadRequestError('Por favor, complete las respuestas que sean obligatorias.');
        }

        const respuestasCreadas = await crearRespuestasService(respuestas, userContextId);

        res.status(201).json({
            success: true,
            message: 'Respuestas registradas exitosamente.',
            data: respuestasCreadas
        });

        notifyHorarioPicks(respuestas, userContextId)
            .catch((err) => console.error('Error emitiendo actualizacion de horario:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Obtener encuesta con todas sus respuestas
 * GET /encuestas/respuestas
 */
export const getEncuestaConRespuestasController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limit = Math.min(10, Math.max(1, parseInt(req.query.limit as string, 10) || 5));

        const { encuestas, hasMore } = await obtenerRespuestasEncuesta(page, limit);

        res.status(200).json({
            success: true,
            data: encuestas,
            pagination: { page, limit, hasMore }
        });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Registrar convocatorias de una encuesta
 * POST /encuestas/:id/convocatorias
 */
export const crearConvocatoriasController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id as string);
        const invitados: number[] = req.body.invitados ?? [];

        if (isNaN(id)) {
            throw new NotFoundError('Encuesta no encontrada.');
        }

        if (!Array.isArray(invitados) || invitados.length === 0) {
            throw new BadRequestError('invitados debe ser un array no vacío.');
        }

        await crearConvocatoriasService(id, invitados);

        res.status(201).json({ success: true });

        getEncuestaByIdService(id)
            .then((encuesta) => {
                if (!encuesta) {
                    return;
                }
                return sendNotificationToMultipleUsers(invitados, buildEncuestaNotification(id, encuesta.titulo));
            })
            .catch((err) => console.error('Error enviando notificacion de convocatoria:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Agregar o quitar participantes de una encuesta
 * PATCH /encuestas/:id/participantes?action=add|remove
 */
export const participantesEncuestaController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id as string);
        const action = req.query.action as 'add' | 'remove';
        const invitados: number[] = req.body.invitados ?? [];

        if (isNaN(id)) {
            throw new NotFoundError('Encuesta no encontrada.');
        }

        if (action !== 'add' && action !== 'remove') {
            throw new BadRequestError('El parámetro action debe ser "add" o "remove".');
        }

        if (!Array.isArray(invitados) || invitados.length === 0) {
            throw new BadRequestError('invitados debe ser un array no vacío.');
        }

        await handleParticipantesEncuesta(id, invitados, action);

        res.status(200).json({ success: true });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Eliminar una opción de una pregunta (solo el creador, solo si no tiene respuestas)
 * DELETE /encuestas/opciones/:opcionId
 */
export const eliminarOpcionController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const opcionId = parseInt(req.params.opcionId as string);

        if (isNaN(opcionId)) {
            throw new NotFoundError('Opción no encontrada.');
        }

        const userContextId = requireUserContextId(req);

        await eliminarOpcionService(opcionId, userContextId);

        res.status(200).json({
            success: true,
            message: 'Opción eliminada exitosamente.'
        });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Eliminar encuesta (soft delete)
 * DELETE /encuestas/:id
 */
export const eliminarEncuestaController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id as string);

        if (isNaN(id)) {
            throw new NotFoundError('Encuesta no encontrada.');
        }

        const userContextId = requireUserContextId(req);

        await eliminarEncuesta(id, userContextId);

        res.status(200).json({
            success: true,
            message: 'Encuesta eliminada exitosamente.'
        });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
