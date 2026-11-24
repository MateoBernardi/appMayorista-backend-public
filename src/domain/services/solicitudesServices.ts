import * as solicitudesRepo from '../../adapters/db/solicitudesRepo';
import { BadRequestError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../adapters/errors/AppError';
import {
    SolicitudDTO,
    CreateSolicitudResult,
    SolicitudInfoDTO,
    SolicitudBitacoraDTO,
    UpdateSolicitudResult,
    PaginatedResult,
    PaginacionParams,
    PaginatedBitacoraResult,
} from '../dto/SolicitudDTO';
import { validarDisponibilidadParticipantes } from '../validations/datesValidations';
import { ArchivoDTO } from '../dto/ArchivoDTO';
import { sendNotificationToMultipleUsers } from './devicesService';
import { emitToUser } from '../../adapters/realtime/socketServer';

const validateSolicitudData = async (solicitudData: SolicitudDTO) => {
    if (!solicitudData.titulo) {
        throw new BadRequestError('Por favor, completá todos los campos requeridos.');
    }

    const tieneFechas = !!(solicitudData.fecha_inicio || solicitudData.fecha_fin);
    const tieneArchivos = !!(solicitudData.archivosIds && solicitudData.archivosIds.length > 0);

    if (!solicitudData.descripcion && !tieneFechas && !tieneArchivos) {
        throw new BadRequestError('Por favor, completá todos los campos requeridos.');
    }

    if (solicitudData.crear_de_todos_modos === 1) {
        return;
    }

    if (solicitudData.fecha_inicio || solicitudData.fecha_fin && isValidDates(solicitudData.fecha_inicio!, solicitudData.fecha_fin!)) {
        const rangosOcupados = await validarDisponibilidadParticipantes(
            solicitudData.invitados,
            solicitudData.fecha_inicio!,
            solicitudData.fecha_fin!,
        );
        if (rangosOcupados.length > 0) {
            return {
                created: false,
                solicitudIds: [],
                rangosOcupados,
            }
        }
    }
} 

const validateChatData = async (solicitudData: SolicitudDTO) => {
    if (solicitudData.fecha_inicio || solicitudData.fecha_fin) {
        throw new BadRequestError('No se pueden asignar fechas a un chat.');
    }   

    if (solicitudData.es_grupo){
        if (!solicitudData.titulo){
            throw new BadRequestError('Por favor, dale un nombre a este grupo.')
        }
    } else if (solicitudData.invitados.length > 2 && !solicitudData.enviar_por_separado) {
        throw new BadRequestError('No se pueden crear chats privados con más de 2 participantes. Si querés enviar un mensaje a varios usuarios, creá un chat grupal o enviá los mensajes por separado.');
    } else if (!solicitudData.descripcion) {
        throw new BadRequestError('Por favor, escribí un mensaje para enviar.');
    }
}

const isValidDates = (fecha_inicio: Date, fecha_fin: Date): boolean => {
    if (fecha_fin <= fecha_inicio || fecha_inicio < new Date() || fecha_fin < new Date()) {
        throw new BadRequestError('Fechas inválidas.');
    }
    return true;
}

const processSingleSolicitud = async (solicitudData: SolicitudDTO): Promise<number | null> => {
    const isPrivateChat =
        solicitudData.tipo_actividad === 'CHAT' &&
        !solicitudData.es_grupo &&
        solicitudData.invitados?.length === 2;

    if (isPrivateChat) {
        const [user1, user2] = solicitudData.invitados;
        const existingChatId = await solicitudesRepo.existeSolicitudChatActiva(user1!, user2!);

        if (existingChatId) {
            await solicitudesRepo.updateSolicitudInvitadoEstado(existingChatId, solicitudData.created_by, 'MODIFIED', solicitudData.descripcion, solicitudData.archivosIds);
            return existingChatId;
        }
    }

    return await solicitudesRepo.createSolicitud(solicitudData);
};

const resolveSolicitudCreation = async (
    solicitudData: SolicitudDTO
): Promise<{ solicitudIds: number[]; notifications: { invitadoId: number; solicitudId: number }[]; failedInvitados: number[] }> => {
    const solicitudIds: number[] = [];
    const notifications: { invitadoId: number; solicitudId: number }[] = [];
    const failedInvitados: number[] = [];
    const creadorId = solicitudData.created_by;

    if (!solicitudData.enviar_por_separado) {
        const id = await processSingleSolicitud(solicitudData);
        if (id !== null) {
            solicitudIds.push(id);
            for (const invitado of solicitudData.invitados.filter((invId) => invId !== creadorId)) {
                notifications.push({ invitadoId: invitado, solicitudId: id });
            }
        }
    } else {
        const destinatarios = solicitudData.invitados.filter((id) => id !== creadorId);

        if (destinatarios.length > 10) {
            throw new BadRequestError('No se pueden enviar más de 10 solicitudes diferentes a la vez.');
        }

        for (const invitado of destinatarios) {
            try {
                const id = await processSingleSolicitud({
                    ...solicitudData,
                    invitados: creadorId ? [creadorId, invitado] : [invitado],
                    es_grupo: false,
                });

                if (id !== null) {
                    solicitudIds.push(id);
                    notifications.push({ invitadoId: invitado, solicitudId: id });
                }
            } catch (error) {
                console.error(`Error creando solicitud para invitado ${invitado}:`, error);
                failedInvitados.push(invitado);
            }
        }
    }

    return { solicitudIds, notifications, failedInvitados };
};

export const sendSolicitudNotifications = (
    solicitud: SolicitudDTO,
    notifications: { invitadoId: number; solicitudId: number }[]
): void => {
    notifications.forEach(({ invitadoId, solicitudId }) => {
        const data = {
            type: 'nueva_solicitud',
            solicitud_id: solicitudId,
            domain: 'solicitudesActividades',
            event: 'created',
            updated_at: new Date().toISOString(),
            entity_id: String(solicitudId),
            observacion: solicitud.descripcion,
        };

        sendNotificationToMultipleUsers([invitadoId], {
            title: 'Tenés un nuevo mensaje',
            body: `"${solicitud.titulo}"`,
            link: `https://interno.italoarg.com.ar/solicitud?id=${solicitudId}&type=recibida`,
            data,
        }).catch((err) =>
            console.error('Error enviando notificación de nueva solicitud:', err)
        );

        emitToUser(invitadoId, data);
    });
};

export const createSolicitudService = async (
    solicitudData: SolicitudDTO
): Promise<CreateSolicitudResult> => {
    if (solicitudData.invitados.filter((id) => id !== solicitudData.created_by).length === 0) {
        throw new BadRequestError('Por favor, seleccioná al menos un destinatario.');
    }

    if (!solicitudData.tipo_actividad || !['MANDATO', 'CHAT', 'REUNION', 'SOLICITUD'].includes(solicitudData.tipo_actividad)) {
        throw new BadRequestError('Por favor, especificá un tipo de mensaje válido.');
    }
    const validationResult = solicitudData.tipo_actividad === 'CHAT'
        ? await validateChatData(solicitudData)
        : await validateSolicitudData(solicitudData);

    if (validationResult) {
        return validationResult;
    }

    const { solicitudIds, notifications, failedInvitados } = await resolveSolicitudCreation(solicitudData);

    return {
        created: true,
        solicitudIds,
        notifications,
        ...(failedInvitados.length > 0 ? { failedInvitados } : {}),
        rangosOcupados: []
    }
};

export const buscarSolicitudesService = async (
    searchTerm: string,
    userId: number,
    type?: 'MANDATO' | 'CHAT' | 'REUNION',
): Promise<SolicitudInfoDTO[]> => {
    const results = await solicitudesRepo.buscarSolicitudes(searchTerm, userId, type);
    const vectorResults = results.filter(r => r.match_priority <= 3);
    const finalResults = vectorResults.length > 0 ? vectorResults : results;
    return finalResults.map(({ match_priority, ...rest }) => rest as SolicitudInfoDTO);
};

export const getSolicitudesByUserService = async (
    userId: number,
    paginacion: PaginacionParams,
    type?: string
): Promise<PaginatedResult<SolicitudInfoDTO>> => {
    const { page, pageSize } = paginacion;
    const offset = (page - 1) * pageSize;

    if (page < 1 || pageSize < 1 || pageSize > 20) {
        throw new BadRequestError('Parámetros de la petición inválidos.');
    }

    const { data, total } = await solicitudesRepo.getSolicitudesByParticipante(userId, { limit: pageSize, offset }, type);

    return {
        data,
        total,
        page,
        pageSize,
    };
};

export const getSolicitudesUnseenByUserService = async (userId: number, type?: string): Promise<number> => {
    return await solicitudesRepo.getSolicitudesUnseenByUser(userId, type);
};

export const getSolicitudDetalleByIdService = async (solicitudId: number, userId: number): Promise<SolicitudInfoDTO | null> => {
    const solicitud = await solicitudesRepo.getSolicitudDetalleById(solicitudId, userId);
    if (!solicitud) {
        return null;
    }
    return solicitud;
};

export const getSolicitudBitacoraByIdService = async (
    userId: number,
    solicitudId: number,
    { limit, cursor, direction }: { limit: number; cursor?: number; direction?: 'older' | 'newer' },
): Promise<PaginatedBitacoraResult> => {
    const pagination: { limit: number; cursor?: number; direction?: 'older' | 'newer' } = {
        limit,
        ...(cursor !== undefined ? { cursor } : {}),
        ...(direction !== undefined ? { direction } : {}),
    };
    return await solicitudesRepo.getSolicitudesBitacoraById(userId, solicitudId, pagination);
};

export const getChatSolicitudArchivosService = async (
    solicitudId: number,
    userId: number,
): Promise<ArchivoDTO[]> => {
    return await solicitudesRepo.getArchivosBySolicitudChatId(solicitudId, userId);
};

export const buscarBitacoraService = async (
    userId: number,
    params: { q?: string; solicitudId?: number; limit: number; cursor?: number },
): Promise<PaginatedBitacoraResult> => {
    return await solicitudesRepo.buscarBitacora(userId, params);
};

export const marcarBitacoraVistoService = async (
    solicitudId: number,
    userId: number,
    hastaId?: number,
): Promise<void> => {
    const esParticipante = await solicitudesRepo.esParticipanteDeSolicitud(solicitudId, userId);
    if (!esParticipante) {
        throw new ForbiddenError('Solicitud no encontrada.');
    }

    await solicitudesRepo.marcarBitacoraVisto(solicitudId, userId, { hastaId });
};

const resolveReplyToId = async (
    solicitudId: number,
    replyToId: number | null | undefined
): Promise<number | null> => {
    if (!replyToId) return null;

    const target = await solicitudesRepo.getBitacoraEntryRefById(replyToId);
    if (!target || target.solicitud_id !== solicitudId) {
        throw new BadRequestError('El mensaje al que respondés no existe en esta conversación.');
    }

    return target.reply_to_id ?? target.id;
};

const updateSolicitudInvitadoEstadoHelper = async (
    solicitudId: number,
    userId: number,
    estado: string,
    observacion: string,
    archivosIds?: number[],
    replyToId?: number | null
) => {
    const estadoActual = await solicitudesRepo.getEstadoInvitado(solicitudId, userId);
    if (estadoActual === 'ACTIVIDAD_CREADA') {
        throw new UnprocessableEntityError('No se puede modificar el estado de una solicitud con una actividad ya creada.');
    }
    if (estado === 'ACCEPTED' && (estadoActual === 'MODIFIED')) {
        throw new UnprocessableEntityError('Debes esperar a que el creador de la solicitud revise tu respuesta antes de aceptarla.');
    }
    if (estado === 'ACCEPTED' && (estadoActual === 'ACCEPTED')) {
        throw new UnprocessableEntityError('Ya aceptaste esta solicitud.');
    }
    if (estado === 'REJECTED' && (estadoActual === 'REJECTED')) {
        throw new UnprocessableEntityError('Ya rechazaste esta solicitud.');
    }
    if (estado === 'ACCEPTED' || estado === 'REJECTED') {
        const solicitudData = await solicitudesRepo.getSolicitudById(solicitudId);
        if (solicitudData.created_by === userId) {
            throw new ForbiddenError('El creador no puede aceptar o rechazar su propia solicitud.');
        }
    }
    if (estado === 'SEEN') {
        await solicitudesRepo.marcarBitacoraVisto(solicitudId, userId);
    }

    await solicitudesRepo.updateSolicitudInvitadoEstado(solicitudId, userId, estado, observacion, archivosIds, replyToId);
};

const modificarFechasSolicitudHelper = async (
    solicitudId: number,
    userId: number,
    nuevaFechaInicio: Date,
    nuevaFechaFin: Date,
    observacion: string,
    replyToId?: number | null,
) => {
    const solicitudData = await solicitudesRepo.getSolicitudById(solicitudId);

    if (isValidDates(nuevaFechaInicio, nuevaFechaFin) === false) {
        throw new BadRequestError('Fechas inválidas.');
    }

    // Regla: no se pueden modificar fechas si algún invitado ya aceptó o rechazó
    const tieneFinal = await solicitudesRepo.tieneInvitadosConEstadoFinal(solicitudId);
    if (tieneFinal) {
        throw new UnprocessableEntityError('No se pueden modificar las fechas porque ya se creó una actividad para esta solicitud.');
    }

    let estado: string;
    if (solicitudData.created_by !== userId) {
        estado = 'MODIFIED';
    } else {
        estado = 'MODIFIED_BY_HOST';
    }

    const numero_invitados = await solicitudesRepo.getNumeroInvitadosBySolicitudId(solicitudId);
    if (numero_invitados > 2 && solicitudData.created_by !== userId) {
        throw new UnprocessableEntityError('No puedes modificar las fechas de una solicitud con múltiples invitados, sólo el creador de la solicitud puede hacerlo.');
    }

    // Validar disponibilidad de fechas para todos los participantes (creador + invitados)
    const invitados = await solicitudesRepo.getInvitadosBySolicitudId(solicitudId);
    const rangosOcupados = await validarDisponibilidadParticipantes(
        [Number(solicitudData.created_by), ...invitados],
        new Date(nuevaFechaInicio),
        new Date(nuevaFechaFin),
        solicitudId,
    );

    if (rangosOcupados.length > 0) {
        return rangosOcupados;
    }

    await solicitudesRepo.updateSolicitudFechas(
        solicitudId,
        nuevaFechaInicio,
        nuevaFechaFin,
        userId,
        observacion,
        estado,
        replyToId
    );

    return [];
};

const aceptarModificacionesHelper = async (
    solicitudId: number,
    userId: number,
    observacion?: string,
) => {
    const solicitudData = await solicitudesRepo.getSolicitudById(solicitudId);

    if (solicitudData.created_by !== userId) {
        throw new ForbiddenError('Sólo creador de la solicitud puede aceptar las modificaciones.');
    }

    if (solicitudData.estado !== 'MODIFIED') {
        throw new UnprocessableEntityError('No se pueden aceptar modificaciones porque la solicitud no fue revisada por ningún invitado.');
    }

    // Validar disponibilidad de fechas para el usuario que acepta
    const nuevaFechaInicio = solicitudData.fecha_inicio ? new Date(solicitudData.fecha_inicio) : null;
    const nuevaFechaFin = solicitudData.fecha_fin ? new Date(solicitudData.fecha_fin) : null;
    if ((nuevaFechaFin && nuevaFechaInicio) && (nuevaFechaFin <= nuevaFechaInicio || nuevaFechaInicio < new Date() || nuevaFechaFin < new Date())) {
        throw new BadRequestError('Fechas inválidas.');
    }

    return await solicitudesRepo.aceptarCambiosBySolicitud(solicitudId, observacion);
};

const updateByHostHelper = async (
    solicitudId: number,
    userId: number,
    estado: string,
    observacion: string,
    archivosIds?: number[],
    replyToId?: number | null
) => {
    await solicitudesRepo.updateByHost(solicitudId, userId, estado, observacion, archivosIds, replyToId);
};

export const updateSolicitudService = async (payload: SolicitudBitacoraDTO): Promise<UpdateSolicitudResult> => {
    if (!payload.solicitud_id || !payload.usuario_id || !payload.estado) {
        throw new BadRequestError('Datos incompletos para actualizar la solicitud.');
    }

    const replyToId = await resolveReplyToId(payload.solicitud_id, payload.reply_to_id);

    if (payload.titulo) {
        await solicitudesRepo.updateSolicitudTitulo(payload.solicitud_id, payload.titulo);
    }

    if (payload.fecha_inicio_nueva && payload.fecha_fin_nueva) {
        const rangosOcupados = await modificarFechasSolicitudHelper(
            payload.solicitud_id,
            payload.usuario_id,
            payload.fecha_inicio_nueva,
            payload.fecha_fin_nueva,
            payload.observacion ?? '',
            replyToId,
        );
        return {
            updated: rangosOcupados.length === 0,
            rangosOcupados,
        };
    }

    if (payload.estado === 'ACCEPTED_BY_HOST') {
        await aceptarModificacionesHelper(payload.solicitud_id, payload.usuario_id, payload.observacion ?? '');
        return {
            updated: true,
            rangosOcupados: [],
        };
    }

    if (payload.estado === 'MODIFIED_BY_HOST') {
        await updateByHostHelper(payload.solicitud_id, payload.usuario_id, payload.estado, payload.observacion ?? '', payload.archivosIds, replyToId);
        return {
            updated: true,
            rangosOcupados: [],
        };
    }

    await updateSolicitudInvitadoEstadoHelper(payload.solicitud_id, payload.usuario_id, payload.estado, payload.observacion ?? '', payload.archivosIds, replyToId);
    return {
        updated: true,
        rangosOcupados: [],
    };
};

export const modificarFechasSolicitudService = async (
    solicitudId: number,
    userId: number,
    nuevaFechaInicio: Date,
    nuevaFechaFin: Date,
    observacion: string,
) => {
    await updateSolicitudService({
        solicitud_id: solicitudId,
        usuario_id: userId,
        estado: 'MODIFIED',
        fecha_inicio_nueva: nuevaFechaInicio,
        fecha_fin_nueva: nuevaFechaFin,
        observacion,
    });
};

export const aceptarModificacionesService = async (
    solicitudId: number,
    userId: number,
) => {
    await updateSolicitudService({
        solicitud_id: solicitudId,
        usuario_id: userId,
        estado: 'ACCEPTED_BY_HOST',
    });
};

/**
 * Obtiene los IDs de todos los participantes de una solicitud (creador + invitados)
 */
export const getParticipantesDeSolicitud = async (solicitudId: number): Promise<number[]> => {
    return await solicitudesRepo.getParticipantesBySolicitudId(solicitudId);
};

/**
 * Obtiene los IDs de los usuarios invitados a una solicitud
 */
export const getInvitadosDeSolicitud = async (solicitudId: number): Promise<number[]> => {
    return await solicitudesRepo.getInvitadosBySolicitudId(solicitudId);
};

export const reenviarSolicitudService = async (
    solicitudId: number,
    nuevosInvitadosIds: number[]
) => {
    const solicitud = await solicitudesRepo.getSolicitudById(solicitudId); // Verificar que el usuario tenga acceso a la solicitud

    const fecha = solicitud.fecha_inicio;
    if (fecha && fecha <= new Date()) {
        throw new UnprocessableEntityError('No se pueden reenviar solicitudes cuya fecha de inicio ya ha pasado');
    }

    if (solicitud.estado === 'ACTIVIDAD_CREADA') {
        throw new UnprocessableEntityError('No se pueden reenviar solicitudes de las cuales ya se creó una actividad');
    }

    return await solicitudesRepo.reenviarSolicitud(solicitudId, nuevosInvitadosIds, solicitud.estado);
};

export const getSolicitudResumenService = async (
    solicitudId: number
): Promise<{ created_by: number; titulo: string, descripcion: string } | null> => {
    const solicitud = await solicitudesRepo.getSolicitudById(solicitudId);
    if (!solicitud) {
        return null;
    }

    return {
        created_by: Number(solicitud.created_by),
        titulo: String(solicitud.titulo ?? ''),
        descripcion: String(solicitud.descripcion ?? ''),
    };
};

export const cancelarSolicitudService = async (solicitudId: number, userContextId: number) => {
    const solicitud = await solicitudesRepo.getSolicitudById(solicitudId);
    if (!solicitud) {
        throw new NotFoundError('Solicitud no encontrada');
    }
    if (solicitud.created_by !== userContextId) {
        throw new ForbiddenError('No tienes permiso para cancelar esta solicitud');
    }
    if (solicitud.estado !== 'SENT') {
        throw new UnprocessableEntityError('Solo se pueden cancelar solicitudes pendientes');
    }
    if (solicitud.fecha_inicio && solicitud.fecha_inicio <= new Date()) {
        throw new UnprocessableEntityError('No se pueden cancelar solicitudes cuya fecha de inicio ya ha pasado');
    }
    return await solicitudesRepo.cancelarSolicitud(solicitudId);
};

export const ocultarSolicitudDeInvitadoService = async (solicitudId: number, userContextId: number): Promise<void> => {
    const ocultada = await solicitudesRepo.ocultarSolicitudDeInvitado(solicitudId, userContextId);
    if (!ocultada) {
        throw new NotFoundError('Solicitud no encontrada para este invitado o ya estaba oculta.');
    }
};

export const handleInvitadosSolicitud = async (
    userId: number,
    solicitudId: number,
    invitados: number[],
    action: 'add' | 'remove'
) => {
    const esParticipante = await solicitudesRepo.esParticipanteDeSolicitud(solicitudId, userId);
    if (!esParticipante) {
        throw new ForbiddenError('No tienes permiso para modificar los invitados de esta solicitud.');
    }

    if (action === 'add') {
        await solicitudesRepo.addInvitadosToSolicitud(solicitudId, invitados);
    } else {
        const removed = await solicitudesRepo.removeInvitadosFromSolicitud(solicitudId, invitados);
        if (!removed) {
            throw new NotFoundError('Ningún invitado fue eliminado.');
        }
    }

    return solicitudesRepo.getSolicitudById(solicitudId);
};
