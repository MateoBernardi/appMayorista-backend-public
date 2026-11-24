import * as encuestasRepo from '../../adapters/db/encuestasRepo';
import {
    CrearEncuestaInput,
    CrearPreguntaInput,
    CrearRespuestaInput,
    EncuestaConPreguntasDTO,
    EncuestaConRespuestasDTO,
    RespuestaDTO,
    EncuestaDTO
} from '../dto/EncuestasDTO';
import { TipoCategoria, TipoPregunta } from '../../types/encuestas';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../adapters/errors/AppError';
import { getUserIdsByEntorno } from './usuariosServices';

/**
 * Obtener encuestas por categoría
 */
export const obtenerEncuestasPorCategoria = async (categoria: TipoCategoria, userContextId: number): Promise<EncuestaDTO[]> => {
    return await encuestasRepo.getEncuestasPorCategoria(categoria, userContextId);
};

/**
 * Crear una encuesta completa con sus preguntas.
 */
export const crearEncuestaCompletaService = async (
    encuesta: CrearEncuestaInput,
    preguntas: Omit<CrearPreguntaInput, 'encuesta_id'>[],
    createdBy?: number,
    invitados: number[] = []
): Promise<EncuestaConPreguntasDTO> => {
    // Asignar el creador
    if (createdBy) {
        encuesta.created_by = createdBy;
    }
    // Validaciones
    if (!encuesta.titulo || encuesta.titulo.trim() === '') {
        throw new BadRequestError('El título de la encuesta es requerido.');
    }

    if (!preguntas || preguntas.length === 0) {
        throw new BadRequestError('La encuesta debe tener al menos una pregunta.');
    }

    // Validar que las preguntas tengan orden único
    const ordenes = preguntas.map(p => p.orden);
    const ordenesUnicos = new Set(ordenes);
    if (ordenes.length !== ordenesUnicos.size) {
        throw new BadRequestError('Las preguntas deben tener números de orden únicos.');
    }

    // Validar que las preguntas de tipo multiple_choice tengan opciones
    for (const pregunta of preguntas) {
        if (pregunta.tipo_pregunta === 'multiple_choice') {
            if (!pregunta.opciones || pregunta.opciones.length < 2) {
                throw new BadRequestError(`La pregunta "${pregunta.titulo}" debe tener al menos 2 opciones.`);
            }
        }
    }

    return await encuestasRepo.crearEncuestaCompleta(encuesta, preguntas, invitados);
};

/**
 * Crear múltiples respuestas (completar encuesta)
 * Verifica que el usuario no haya respondido ya la encuesta
 */
export const crearRespuestasService = async (
    respuestas: CrearRespuestaInput[],
    usuarioId: number
): Promise<RespuestaDTO[]> => {
    if (!respuestas || respuestas.length === 0) {
        throw new BadRequestError('Debe proporcionar al menos una respuesta');
    }

    // Verificar que el usuario no haya respondido ya
    if (usuarioId) {
        // Obtener la encuesta_id de la primera pregunta (asumimos que todas son de la misma encuesta)
        const primeraRespuesta = respuestas[0];

        if (!primeraRespuesta || !primeraRespuesta.pregunta_id) {
            throw new BadRequestError('Las respuestas deben pertenecer a una pregunta válida');
        }

        // Buscar la encuesta a través de la pregunta
        const todasRespuestas = await encuestasRepo.getRespuestasPorPregunta(primeraRespuesta.pregunta_id);

        if (todasRespuestas.length > 0) {
            // Verificar en el repositorio directamente
            const yaRespondio = await verificarSiUsuarioRespondioEncuesta(
                usuarioId,
                primeraRespuesta.pregunta_id
            );

            if (yaRespondio) {
                throw new ConflictError('Ya has respondido esta encuesta');
            }
        }
    }

    // Validar que cada respuesta tenga al menos un tipo de contenido.
    // La verificación de cupo para preguntas de tipo 'horario' se hace de forma
    // atómica dentro de la transacción de encuestasRepo.crearRespuestas.
    for (const respuesta of respuestas) {
        if (!respuesta.opcion_id && !respuesta.respuesta_texto && respuesta.valor_rating === undefined) {
            throw new BadRequestError('Todas las respuestas deben tener al menos un tipo de respuesta');
        }
    }

    return await encuestasRepo.crearRespuestas(usuarioId, respuestas);
};

/**
 * Obtener encuestas con todas sus respuestas (paginado)
 */
export const obtenerRespuestasEncuesta = async (
    page: number,
    limit: number
): Promise<{ encuestas: EncuestaConRespuestasDTO[]; hasMore: boolean }> => {
    return await encuestasRepo.getRespuestasEncuesta(page, limit);
};

/**
 * Obtener respuestas de una pregunta específica
 */
export const obtenerRespuestasPorPregunta = async (preguntaId: number): Promise<RespuestaDTO[]> => {
    return await encuestasRepo.getRespuestasPorPregunta(preguntaId);
};

/**
 * Verificar si un usuario ya respondió una encuesta
 */
export const verificarSiUsuarioRespondioEncuesta = async (
    usuarioId: number,
    encuestaId: number
): Promise<boolean> => {
    return await encuestasRepo.usuarioRespondioEncuesta(usuarioId, encuestaId);
};

export const getEncuestaByIdService = async (id: number): Promise<EncuestaDTO | null> => {
    return await encuestasRepo.getEncuestaById(id);
};

export const getTipoPreguntaByIdService = async (preguntaId: number): Promise<TipoPregunta | null> => {
    return await encuestasRepo.getTipoPreguntaById(preguntaId);
};

export const getEncuestaIdByPreguntaIdService = async (preguntaId: number): Promise<number | null> => {
    return await encuestasRepo.getEncuestaIdByPreguntaId(preguntaId);
};

/**
 * Resuelve los participantes de una encuesta (convocados + con visibilidad).
 * Si no hay ninguno registrado (encuesta interna abierta a todos), cae al
 * mismo fallback que ya usa la notificación de creación de encuestas.
 */
export const getParticipantesEncuestaIdsService = async (encuestaId: number): Promise<number[]> => {
    const participantes = await encuestasRepo.getParticipantesEncuestaIds(encuestaId);
    if (participantes.length > 0) {
        return participantes;
    }
    return await getUserIdsByEntorno('interno');
};

export const crearConvocatoriasService = async (encuestaId: number, usuarioIds: number[]): Promise<void> => {
    const encuesta = await encuestasRepo.getEncuestaById(encuestaId);
    if (!encuesta) throw new NotFoundError('Encuesta no encontrada.');
    await encuestasRepo.insertarConvocatorias(encuestaId, usuarioIds);
};

export const handleParticipantesEncuesta = async (
    encuestaId: number,
    usuarioIds: number[],
    action: 'add' | 'remove'
): Promise<void> => {
    const encuesta = await encuestasRepo.getEncuestaById(encuestaId);
    if (!encuesta) throw new NotFoundError('Encuesta no encontrada.');

    if (action === 'add') {
        await encuestasRepo.addParticipantesEncuesta(encuestaId, usuarioIds);
    } else {
        await encuestasRepo.removeParticipantesEncuesta(encuestaId, usuarioIds);
    }
};

/**
 * Eliminar una opción de una pregunta.
 * Solo el creador de la encuesta puede hacerlo y solo si nadie la eligió como respuesta.
 */
export const eliminarOpcionService = async (opcionId: number, userContextId: number): Promise<void> => {
    const opcion = await encuestasRepo.getOpcionConCreador(opcionId);
    if (!opcion) {
        throw new NotFoundError('Opción no encontrada.');
    }
    if (opcion.created_by !== userContextId) {
        throw new ForbiddenError('Solo el creador de la encuesta puede eliminar sus opciones.');
    }
    if (opcion.tipo_pregunta === 'multiple_choice' && opcion.opciones_count <= 2) {
        throw new ConflictError('La pregunta debe conservar al menos 2 opciones.');
    }
    const eliminada = await encuestasRepo.deleteOpcionSinRespuestas(opcionId);
    if (!eliminada) {
        throw new ConflictError('La opción ya tiene respuestas y no puede eliminarse.');
    }
};

/**
 * Eliminar encuesta (soft delete)
 */
export const eliminarEncuesta = async (id: number, userContextId: number): Promise<void> => {
    const encuesta = await encuestasRepo.getEncuestaById(id);
    if (!encuesta) {
        throw new NotFoundError('Encuesta no encontrada.');
    }
    if (encuesta.created_by !== userContextId) {
        throw new ForbiddenError('Solo el creador de la encuesta puede eliminarla.');
    }
    await encuestasRepo.softDeleteEncuesta(id, userContextId);
};
