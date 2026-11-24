import * as kanbanRepo from '../../adapters/db/kanbanRepo';
import { CreateObjetivoDTO, ObjetivoDTO } from '../dto/ObjetivoDTO';
import { LexoRank } from 'lexorank';
import * as solicitudesRepo from '../../adapters/db/solicitudesRepo';
import { ConflictError, NotFoundError } from '../../adapters/errors/AppError';

export const getAllObjetivos = async (userContextId: number) => {
    return await kanbanRepo.getObjetivos(userContextId);
};

export const getObjetivoByIdService = async (id: number) => {
    return await kanbanRepo.getObjetivoById(id);
};

export const getInvitadosByObjetivoId = async (objetivoId: number) => {
    return await kanbanRepo.getInvitadosByObjetivoId(objetivoId);
};

export const createObjetivo = async (data: CreateObjetivoDTO, userId: number) => {
    let rank;

    if (data.estado === 'PRIORIDAD') {
        const minRank = await kanbanRepo.getMinRank();
        if (!minRank) {
            rank = LexoRank.middle().toString();
        } else {
            rank = LexoRank.parse(minRank).genPrev().toString();
        }
    } else {
        // Default: add to bottom
        const maxRank = await kanbanRepo.getMaxRank();
        if (!maxRank) {
            rank = LexoRank.middle().toString();
        } else {
            rank = LexoRank.parse(maxRank).genNext().toString();
        }
    }

    if (data.solicitud_id) {
        const solicitud = await solicitudesRepo.getSolicitudById(data.solicitud_id);
        if (!solicitud) {
            throw new NotFoundError('Solicitud no encontrada.');
        }

        const estadoActual = await solicitudesRepo.getEstadoInvitado(data.solicitud_id, userId);
        if (estadoActual === 'ACTIVIDAD_CREADA') {
            throw new ConflictError('Ya se creó una actividad para esta solicitud.');
        }
        
        const objetivo = await kanbanRepo.createObjetivo(data, rank, userId);
        await solicitudesRepo.marcarSolicitudActividadCreada(data.solicitud_id);

        return objetivo;
    }

    const objetivo = await kanbanRepo.createObjetivo(data, rank, userId);
    return objetivo;
};

export const updateObjetivo = async (id: number, data: Partial<ObjetivoDTO> & { observacion?: string }, userId: number) => {
    const currentObjetivo = await kanbanRepo.getObjetivoById(id);
    if (!currentObjetivo) {
        throw new NotFoundError('Objetivo no encontrado.');
    }

    // Si cambia el estado, o si hay una observación explícita
    if ((data.estado && data.estado !== currentObjetivo.estado) || data.observacion) {
        await kanbanRepo.addBitacora({
            objetivo_id: id,
            usuario_id: userId,
            estado_anterior: currentObjetivo.estado,
            estado_nuevo: data.estado || currentObjetivo.estado,
            observacion: data.observacion || (data.estado ? 'Cambio de estado' : 'Observación agregada')
        });
    }

    // Regla de negocio: Si se mueve a PRIORIDAD y no se especifica rank, mover al principio
    let newRank = data.rank_position;
    if (data.estado === 'PRIORIDAD' && currentObjetivo.estado !== 'PRIORIDAD' && !newRank) {
        const minRank = await kanbanRepo.getMinRank();
        if (!minRank) {
            newRank = LexoRank.middle().toString();
        } else {
            newRank = LexoRank.parse(minRank).genPrev().toString();
        }
    }

    // Remove observacion from data before updating objective table as it is not a column there
    const { observacion, ...updateData } = data;

    if (newRank) {
        updateData.rank_position = newRank;
    }

    const updated = await kanbanRepo.updateObjetivo(id, { ...updateData, updated_by: userId });
    return updated;
};

export const editObjetivoService = async (id: number, field: 'titulo' | 'descripcion', value: string, userId: number) => {
    if (field === 'titulo') {
        return await kanbanRepo.editTituloObjetivo(id, value, userId);
    } else if (field === 'descripcion') {
        return await kanbanRepo.editDescripcionObjetivo(id, value, userId);
    }
    setTimeout(() => {
    }, 500); // Simulate async operation
};

export const handleArchivosObjetivo = async (
    objetivoId: number,
    archivosIds: number[],
    action: 'add' | 'remove'
) => {
    if (action === 'add') {
        await kanbanRepo.addArchivoToObjetivo(objetivoId, archivosIds);
    } else if (action === 'remove') {
        await kanbanRepo.removeArchivoFromObjetivo(objetivoId, archivosIds);
    }

    // ← Faltaba devolver el objetivo actualizado
    return kanbanRepo.getObjetivoById(objetivoId);
};

export const handleInvitadosObjetivo = async (
    creadorId: number,
    objetivoId: number,
    invitados: { user_id: number; rol: string }[],
    action: 'add' | 'remove'
) => {
    if (action === 'add') {
        const actuales = await kanbanRepo.getInvitadosByObjetivoId(objetivoId);
        const actualesMap = new Map(actuales.map(a => [a.user_id, a.rol]));

        await kanbanRepo.addInvitadosToObjetivo(objetivoId, invitados);

        // Nuevos o que cambiaron a ASSIGNEE → ASSIGN en bitácora
        const nuevosAsignados = invitados
            .filter(i => i.rol === 'ASSIGNEE')
            .filter(i => {
                const rolActual = actualesMap.get(i.user_id);
                return rolActual === undefined || rolActual !== 'ASSIGNEE';
            })
            .map(i => i.user_id);

        // Que bajaron de ASSIGNEE a VISUALIZER → DISCHARGE en bitácora
        const descargados = invitados
            .filter(i => i.rol === 'VISUALIZER')
            .filter(i => actualesMap.get(i.user_id) === 'ASSIGNEE')
            .map(i => i.user_id);

        if (nuevosAsignados.length > 0) {
            await kanbanRepo.addAsignadosToBitacora(objetivoId, nuevosAsignados, creadorId, 'ASSIGN');
        }
        if (descargados.length > 0) {
            await kanbanRepo.addAsignadosToBitacora(objetivoId, descargados, creadorId, 'DISCHARGE');
        }
    } else if (action === 'remove') {
        await kanbanRepo.removeInvitadosFromObjetivo(objetivoId, invitados);
    }

    return kanbanRepo.getObjetivoById(objetivoId);
};

export const deleteObjetivo = async (id: number, userId: number) => {
    return await kanbanRepo.deleteObjetivo(id, userId);
};

export const markObjetivoAsSeen = async (objetivoId: number, userId: number) => {
    await kanbanRepo.markObjetivoAsSeen(objetivoId, userId);
};
