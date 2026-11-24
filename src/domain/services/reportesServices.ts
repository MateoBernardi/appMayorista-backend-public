import * as reportesRepo from '../../adapters/db/reportesRepo';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import { getIdRolByUserContextId } from '../../adapters/db/licenciasRepo';
import { CreateReporteDTO, ReporteDTO, EstadoReporte, ReporteStatsDTO, MostImprovedUserDTO, TopPositiveUserDTO, ReportesManagedResult } from '../dto/ReporteDTO';
import { NotFoundError, ConflictError, UnprocessableEntityError, BadRequestError } from '../../adapters/errors/AppError';

const MAX_MANAGED_PAGE_SIZE = 50;

export const getReportesByUser = async (usuarioId: number) => {
    return await reportesRepo.getReportesByUser(usuarioId);
};

export const getReportesPendingByUser = async (id: number): Promise<number> => {
    return await reportesRepo.getReportesPendingByUser(id);
};

export const getReportesPendingForManager = async (userContextId: number): Promise<number> => {
    const roleId = await getIdRolByUserContextId(userContextId);
    if (roleId === null) {
        throw new NotFoundError('No se pudo determinar el rol del usuario.');
    }
    return await reportesRepo.getReportesPendingForManager(roleId);
};

export const getReportesManaged = async (
    userContextId: number,
    { page, pageSize, estado, rol }: { page: number; pageSize: number; estado?: EstadoReporte | undefined; rol?: string | undefined }
): Promise<ReportesManagedResult> => {
    if (page < 1 || pageSize < 1 || pageSize > MAX_MANAGED_PAGE_SIZE) {
        throw new BadRequestError('Parámetros de paginación inválidos.');
    }

    const roleId = await getIdRolByUserContextId(userContextId);
    if (roleId === null) {
        throw new NotFoundError('No se pudo determinar el rol del usuario.');
    }

    const offset = (page - 1) * pageSize;
    const { data, total } = await reportesRepo.getReportesManaged({ roleId, rol, estado, limit: pageSize, offset });

    return { data, total, page, pageSize };
};

export const createReporte = async (data: CreateReporteDTO) => {
    if (data.categoria === 'NEGATIVO') {
        data.estado = 'PENDIENTE';
    } else {
        data.estado = 'ASENTADO';
    }
    const usuario = await usuariosRepo.getUsuarioEntidadByContextId(data.usuario_reportado_id); // Ensure reported user exists
    if (!usuario || (!usuario.rol_nombre.includes('empleado') && usuario.rol_nombre !== 'encargado')) {
        throw new NotFoundError('Usuario reportado no encontrado.');
    }
    return await reportesRepo.createReporte(data);
};

export const updateReporte = async (
    id: number,
    usuarioId: number,
    userRole: string,
    changes: {
        estado?: EstadoReporte;
        observacion?: string;
    }
) => {
    const reporte = await reportesRepo.getReporteById(id);
    if (!reporte) {
        throw new NotFoundError('Reporte no encontrado.');
    }

    // Check if locked by manager
    const isLocked = await reportesRepo.isReporteLockedByManager(id);
    if (isLocked && userRole !== 'gerencia') {
        throw new ConflictError('El reporte ha sido gestionado por un gerente y no puede ser modificado.');
    }

    // Logic for reported user
    if (usuarioId === reporte.usuario_reportado_id) {
        // Cannot change from ASENTADO to another state
        if (reporte.estado === 'ASENTADO' && changes.estado && changes.estado !== 'ASENTADO') {
            throw new ConflictError('El reporte ya está asentado y no puede ser modificado de estado.');
        }

        // Can only accept (ASENTADO) or add observation
        if (changes.estado && !(changes.estado === 'ASENTADO' || changes.estado === 'DISPUTA')) {
            throw new UnprocessableEntityError('El usuario reportado solo puede aceptar el reporte o agregar observaciones.');
        }
    }

    // Determine action type
    let tipo_accion = 'COMENTARIO';
    if (changes.estado === 'ASENTADO') tipo_accion = 'ACEPTACION';
    else if (changes.estado === 'DISPUTA') tipo_accion = 'RECHAZO';
    else if (changes.estado === 'DESESTIMADO') tipo_accion = 'DESESTIMACION';
    else if (changes.estado === 'PENDIENTE') tipo_accion = 'MODIFICACION';

    // If only observation is added and state is not changed
    if (!changes.estado && changes.observacion) {
        tipo_accion = 'COMENTARIO';
    }

    const updateData: { tipo_accion: string; estado?: EstadoReporte; observacion?: string } = { tipo_accion };
    if (changes.estado !== undefined) updateData.estado = changes.estado;
    if (changes.observacion !== undefined) updateData.observacion = changes.observacion;

    return await reportesRepo.updateReporte(id, usuarioId, updateData);
};

export const getReportesRanking = async (estado?: EstadoReporte): Promise<ReporteStatsDTO[]> => {
    return await reportesRepo.getRankingReportes(estado);
};

export const getTopEmployeeByReportes = async (): Promise<TopPositiveUserDTO> => {
    return await reportesRepo.getTopPositiveUser();
};

export const getUpgradedEmployeeByReportes = async (): Promise<MostImprovedUserDTO> => {
    return await reportesRepo.getMostImprovedUser();
}

export const generateLicenciaSinDocumentacionReport = async (userContextId: number, solicitudId: number): Promise<void> => {
    await reportesRepo.createReporte({
        usuario_reportado_id: userContextId,
        creador_id: null, // Sistema
        categoria: 'NEGATIVO',
        titulo: 'Licencia médica sin documentación',
        descripcion: `La solicitud de licencia médica #${solicitudId} quedó sin la documentación requerida.`,
        estado: 'ASENTADO',
        fecha_incidente: new Date()
    });
}

export const ejecutarSweepAsentadoAutomatico = async (): Promise<number> => {
    return await reportesRepo.asentarReportesPendientesVencidos();
}

export const ejecutarSweepAusencias = async (): Promise<number> => {
    return await reportesRepo.reportarAusenciasDelDia();
}