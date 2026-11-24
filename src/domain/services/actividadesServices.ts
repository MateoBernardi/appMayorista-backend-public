import * as solicitudesRepo from '../../adapters/db/solicitudesRepo';
import * as actividadesRepo from '../../adapters/db/actividadesRepo';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../adapters/errors/AppError';
import { getUsuarioEntidadByContextId } from '../../adapters/db/usuariosRepo';
import { ActividadDTO, CreateActividadResult, UpdateActividadHorariosResult } from '../dto/ActividadDTO';
import { ActividadDetalleDTO } from '../dto/ActividadDTO';
import { addArchivoToActividad, removeArchivoFromActividad, addInvitadosToActividad, esParticipanteDeActividad, getActividadById, removeInvitadosFromActividad } from '../../adapters/db/actividadesRepo';
import { RangoOcupado, validarDisponibilidadParticipantes } from '../validations/datesValidations';

// Actividades Services

export const cancelarActividadService = async (actividadId: number, userId: number) => {
    const actividad = await actividadesRepo.getActividadById(actividadId);
    if (!actividad) {
        throw new NotFoundError('Actividad no encontrada.');
    }

    const esCreador = await actividadesRepo.esCreadorDeActividad(actividadId, userId);

    if (esCreador) {
        await actividadesRepo.eliminarActividadPorId(actividadId);
        return;
    }

    const esParticipante = await actividadesRepo.esParticipanteDeActividad(actividadId, userId);
    if (!esParticipante) {
        return;
    }

    await actividadesRepo.eliminarParticipanteDeActividad(actividadId, userId);
};

export const actualizarHorariosActividadService = async (
    actividadId: number,
    userId: number,
    nuevaFechaInicio: Date,
    nuevaFechaFin?: Date
): Promise<UpdateActividadHorariosResult> => {
    // Validar que las fechas sean válidas
    if (nuevaFechaFin) {
        if (nuevaFechaFin <= nuevaFechaInicio || nuevaFechaInicio < new Date() || (nuevaFechaFin && nuevaFechaFin < new Date())) {
            throw new BadRequestError('Fechas inválidas.');
        }
    }

    // Regla: sólo el creador (host) puede modificar los horarios
    const hostId = await actividadesRepo.getHostDeActividad(actividadId);
    if (!hostId || hostId !== userId) {
        throw new ForbiddenError('No tienes permiso para modificar esta actividad, sólo el creador puede hacerlo.');
    }

    const participantes = await actividadesRepo.getParticipantesByActividadId(actividadId);

    if (nuevaFechaFin) {
        const rangosOcupados = await validarDisponibilidadParticipantes(
            participantes,
            nuevaFechaInicio,
            nuevaFechaFin,
            actividadId,
        );

        if (rangosOcupados.length > 0) {
            return {
                updated: false,
                actividad: null,
                rangosOcupados,
            };
        }
    }

    const actividad = await actividadesRepo.actualizarHorariosActividad(actividadId, userId, nuevaFechaInicio, nuevaFechaFin ?? undefined);
    return {
        updated: true,
        actividad,
        rangosOcupados: [],
    };
};

export const getHostDeActividadService = async (actividadId: number): Promise<number | null> => {
    return await actividadesRepo.getHostDeActividad(actividadId);
};

export const getParticipantesByActividadIdService = async (actividadId: number): Promise<number[]> => {
    return await actividadesRepo.getParticipantesByActividadId(actividadId);
};

export const getActividadDetalleByIdService = async (
    actividadId: number,
    userContextId: number,
): Promise<ActividadDetalleDTO | null> => {
    if (!Number.isInteger(actividadId) || actividadId <= 0) {
        throw new NotFoundError('Actividad no encontrada.');
    }

    const usuarioContexto = await getUsuarioEntidadByContextId(userContextId);
    if (!usuarioContexto) {
        throw new ForbiddenError('No autorizado.');
    }

    return await actividadesRepo.getActividadDetalleByIdConParticipantes(actividadId);
};

export const crearActividadService = async (
    actividadData: Omit<ActividadDTO, 'actividad_id'>,
    userId: number,
): Promise<CreateActividadResult> => {
    const nuevaFechaInicio = actividadData.fecha_inicio;
    const nuevaFechaFin = actividadData.fecha_fin;
    let rangosOcupados: RangoOcupado[] = [];

    if (nuevaFechaFin && (nuevaFechaFin <= nuevaFechaInicio || nuevaFechaInicio < new Date() || nuevaFechaFin < new Date())) {
        throw new BadRequestError('Fechas inválidas.');
    }

    // Si la actividad está vinculada a una solicitud, buscar datos para determinar participantes
    if (actividadData.solicitud_id) {
        const solicitudData = await solicitudesRepo.getSolicitudById(actividadData.solicitud_id);

        if (solicitudData.fecha_inicio && new Date(solicitudData.fecha_inicio) <= new Date()) {
            throw new UnprocessableEntityError('No se puede crear una actividad para una solicitud vencida.');
        }

        // Verificar que la solicitud no tenga ya una actividad creada
        const estadoActual = await solicitudesRepo.getEstadoInvitado(actividadData.solicitud_id, userId);
        if (estadoActual === 'ACTIVIDAD_CREADA') {
            throw new ConflictError('Ya se creó una actividad para esta solicitud.');
        }

        // Obtener todos los invitados de la solicitud (para el gateo de permisos)
        // y solo los que ya aceptaron (para decidir a quién se le crea la actividad).
        const invitados = await solicitudesRepo.getInvitadosBySolicitudId(actividadData.solicitud_id);
        const invitadosAceptados = await solicitudesRepo.getInvitadosAceptadosBySolicitudId(actividadData.solicitud_id);
        const invitadosExcluidos = invitados.filter(id => !invitadosAceptados.includes(id));

        // Para REUNION, solo el creador de la solicitud puede crear la actividad
        if (solicitudData && invitados.length > 2  && nuevaFechaFin) {
            if (solicitudData.created_by !== userId) {
                throw new ForbiddenError('Solo el creador de la solicitud puede crear la actividad para reuniones.');
            }

            const rangosOcupados = await validarDisponibilidadParticipantes(
                [userId, ...invitadosAceptados],
                nuevaFechaInicio,
                nuevaFechaFin,
                undefined,
            );

            if (rangosOcupados.length > 0) {
                return {
                    created: false,
                    actividad: null,
                    rangosOcupados,
                };
            }

            const actividad = await actividadesRepo.createActividadConMultiplesParticipantes(
                actividadData,
                userId,               // hostId (creador)
                invitadosAceptados,   // solo quienes aceptaron la solicitud, como guests
            );
            // Marcar la solicitud como ACTIVIDAD_CREADA
            await solicitudesRepo.marcarSolicitudActividadCreada(actividadData.solicitud_id);
            return {
                created: true,
                actividad,
                rangosOcupados: [],
                excludedInvitados: invitadosExcluidos,
            };
        }

        if (nuevaFechaFin) {
            rangosOcupados = await validarDisponibilidadParticipantes(
                [userId],
                nuevaFechaInicio,
                nuevaFechaFin,
                undefined,
            );
        }

        if (rangosOcupados && rangosOcupados.length > 0) {
            return {
                created: false,
                actividad: null,
                rangosOcupados,
            };
        }

        await solicitudesRepo.marcarSolicitudActividadCreada(actividadData.solicitud_id);

        const actividad = await actividadesRepo.createActividadConParticipante(
            actividadData,
            userId,          // hostId (quien crea la actividad, puede ser invitado o creador)
            'host',       // todos los invitados como guests
        );

        return {
            created: true,
            actividad,
            rangosOcupados: [],
        };
    }

    if (rangosOcupados && rangosOcupados.length > 0) {
        return {
            created: false,
            actividad: null,
            rangosOcupados,
        };
    }

    // Sin solicitud_id o tipo MANDATO: crear actividad solo con el usuario como host
    const actividad = await actividadesRepo.createActividadConParticipante(
        actividadData,
        userId,
        'host',
    );

    return {
        created: true,
        actividad,
        rangosOcupados: [],
    };
};

export const getActividadesByUserService = async (
    userId: number,
    fechaInicio: Date,
    fechaFin: Date,
) => {
    if (fechaFin <= fechaInicio) {
        throw new BadRequestError('Período de fechas inválido.');
    }

    return await actividadesRepo.getActividadesByUser(userId, fechaInicio, fechaFin);
};

export const handleArchivosActividad = async (
    userId: number,
    actividadId: number,
    archivosIds: number[],
    action: 'add' | 'remove'
) => {
    const esParticipante = await esParticipanteDeActividad(actividadId, userId);
    if (!esParticipante) {
        throw new ForbiddenError('No tienes permiso para modificar los archivos de esta actividad.');
    }

    if (action === 'add') {
        await addArchivoToActividad(actividadId, archivosIds);
    } else if (action === 'remove') {
        await removeArchivoFromActividad(actividadId, archivosIds);
    }

    // ← Faltaba devolver el objetivo actualizado
    return await getActividadById(actividadId);
};

export const handleInvitadosActividad = async (
    userId: number,
    actividadId: number,
    invitados: { user_context_id: number; rol: string }[],
    action: 'add' | 'remove'
) => {
    const esParticipante = await esParticipanteDeActividad(actividadId, userId);
    if (!esParticipante) {
        throw new ForbiddenError('No tienes permiso para modificar los archivos de esta actividad.');
    }

    if (action === 'add') {
        await addInvitadosToActividad(actividadId, invitados);

    } else if (action === 'remove') {
        await removeInvitadosFromActividad(actividadId, invitados);
    }

    return getActividadById(actividadId);
};