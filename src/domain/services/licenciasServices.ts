import * as licenciasRepo from '../../adapters/db/licenciasRepo';
import { getUserContextById, getUserIdsByRoles } from './usuariosServices';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../adapters/errors/AppError';
import {
    CreateSolicitudDTO,
    SolicitudAusenciaDTO,
    EstadoSolicitud,
    AprobarSolicitudDTO,
    RechazarSolicitudDTO,
    SolicitudFilterDTO,
    TipoLicenciaDTO,
    SaldoAusenciaDTO,
    SaldosUsuarioDTO,
    SolicitudDTO,
    SaldoBloqueado,
    DescuentoSaldo,
    SolicitudDescontada,
    ReintegroSaldo
} from '../dto/LicenciaDTO';
import { getLicenciasAprobadasRepo } from '../../adapters/db/licenciasRepo';
import { getSaldoFrancoByUsuario, getObjetivoMinutosPorUsuarios, getConsumoFrancoBySolicitud } from '../../adapters/db/saldosFrancosRepo';
import { jornadaMinutos, OBJETIVO_JORNADA_COMPLETA_MINUTOS } from './jornada';
import { horasAMinutos, minutosAHoras } from '../../utils/duracion';
import { licenciaAprobadorRoles } from '../../types/roles';
import { generateLicenciaSinDocumentacionReport } from './reportesServices';
import { sendNotificationToMultipleUsers } from './devicesService';
import { emitToUsers } from '../../adapters/realtime/socketServer';
import { aplicarLicencia, revertirLicencia } from './licenciasTurnosServices';

const TIPO_LICENCIA_FRANCO = 2;

// Franco por días: 8 h por día (4 h si el objetivo semanal es menor a 40 h, regla de jornada.ts). `cantidadDias` viene
// en décimas (días × 10). El franco por horas no pasa por acá: lo consume licenciasTurnosServices al aplicarse a los
// turnos (aplicarLicencia), por el solape real con cada turno.
const calcularMinutosFrancoDias = async (usuarioId: number, cantidadDias: number): Promise<number> => {
    const objetivo = (await getObjetivoMinutosPorUsuarios([usuarioId])).get(usuarioId) ?? OBJETIVO_JORNADA_COMPLETA_MINUTOS;
    const minutosPorDia = jornadaMinutos(objetivo);
    return (cantidadDias * minutosPorDia) / 10;
};

const calculateResiduoNuevo = (residuo_db: number, days: number) => {
    let nuevo_residuo = 0;
    let dias_descontados = 0;
    let bloques_semanales = 0;
    let dias_sueltos = 0;

    bloques_semanales = Math.trunc(days / 70);
    dias_sueltos = days - Math.trunc(days / 70) * 70;

    if (dias_sueltos >= 55) {
        bloques_semanales += 1;
        dias_sueltos = dias_sueltos - 55;
    }

    nuevo_residuo = residuo_db + dias_sueltos;

    if (nuevo_residuo >= 55) {
        nuevo_residuo = (nuevo_residuo - 55);
        if (nuevo_residuo > 0) {
            dias_sueltos += 15;
        }
    } else if (nuevo_residuo > 0 && residuo_db === 0) {
        dias_sueltos += 15;
    }

    dias_descontados = bloques_semanales * 70 + dias_sueltos;

    return { dias_descontados, nuevo_residuo };
};

// Estados en los que una solicitud con saldo todavía puede aprobarse (y entonces descontar).
const ESTADOS_PENDIENTES = [EstadoSolicitud.PENDIENTE, EstadoSolicitud.PENDIENTE_DOCUMENTACION, EstadoSolicitud.EXPIRADA];

const decimasADias = (decimas: number): number => decimas / 10;

// Lo que se descontó al aprobar; las aprobadas antes de guardar dias_descontados se recalculan
// con el residuo que tenía el saldo en ese momento.
const descontadoAlAprobar = (s: SolicitudDescontada): number =>
    s.dias_descontados ?? calculateResiduoNuevo(s.residuo_al_aprobar ?? 0, s.cantidad_dias).dias_descontados;

// Descuento de una solicitud sobre el saldo bloqueado. Tira error si no hay saldo o no alcanza.
const calcularDescuento = (fila: SaldoBloqueado | null, cantidadDias: number, tipoNombre: string): DescuentoSaldo => {
    if (!fila) throw new NotFoundError(`No hay saldo asignado para ${tipoNombre}.`);

    const { dias_descontados, nuevo_residuo } = calculateResiduoNuevo(fila.residuo, cantidadDias);
    const disponibles = fila.dias_otorgados - fila.dias_consumidos;
    if (disponibles < dias_descontados) {
        throw new UnprocessableEntityError(
            `Saldo insuficiente al momento de aprobar. Disponibles: ${decimasADias(disponibles)}, Necesarios: ${decimasADias(dias_descontados)}.`
        );
    }
    return { dias: dias_descontados, nuevoResiduo: nuevo_residuo };
};

// Al cancelar: devuelve lo que descontó la cancelada y vuelve a calcular las aprobadas después
// desde el residuo que había antes de ella (el cobro del fin de semana depende del orden).
const calcularReintegro = (cancelada: SolicitudDescontada, posteriores: SolicitudDescontada[]): ReintegroSaldo => {
    let residuo = cancelada.residuo_al_aprobar ?? 0;
    let diasADevolver = descontadoAlAprobar(cancelada);
    const recalculadas: ReintegroSaldo['posteriores'] = [];

    for (const p of posteriores) {
        const { dias_descontados, nuevo_residuo } = calculateResiduoNuevo(residuo, p.cantidad_dias);
        diasADevolver += descontadoAlAprobar(p) - dias_descontados;
        recalculadas.push({ id: p.id, residuo_al_aprobar: residuo, dias_descontados });
        residuo = nuevo_residuo;
    }

    return { diasADevolver, nuevoResiduo: residuo, posteriores: recalculadas };
};

const calcularFechaFin = (fechaInicio: Date, cantidadDias?: number, cantidadHoras?: number): Date => {
    let diasCalendario: number;
    let minutosCalendario: number;
    let fechaFin: Date;

    if (cantidadDias != null) {
        fechaFin = new Date(fechaInicio.getTime());
        fechaFin.setMinutes(fechaFin.getMinutes() + cantidadDias * 24 * 60);
    } else if (cantidadHoras != null) {
        minutosCalendario = cantidadHoras * 60;
        fechaFin = new Date(fechaInicio.getTime());
        fechaFin.setMinutes(fechaFin.getMinutes() + minutosCalendario);
    } else {
        throw new BadRequestError('Debe indicar cantidad de días o cantidad de horas.');
    }

    return fechaFin;
};

const validarFraccionario = (valor: number, campo: string): void => {
    if (valor <= 0) {
        throw new BadRequestError(`${campo} debe ser mayor a 0.`);
    }
    const valorX10 = Math.round(valor * 10);
    if (valorX10 % 5 !== 0) {
        throw new BadRequestError(`${campo} invalido.`);
    }
};

const getRolesDestinoPorCreador = (creatorRole?: string): string[] => {
    const role = String(creatorRole || '').toLowerCase();

    if (role.startsWith('empleado-')) {
        return ['gerencia', 'encargado'];
    }

    if (role === 'encargado') {
        return ['gerencia'];
    }

    if (role === 'gerencia') {
        return ['presidencia'];
    }

    return [];
};

export const getDestinatariosNotificacionNuevaLicencia = async (
    creatorUserContextId: number,
    creatorRole?: string,
): Promise<number[]> => {
    let role = creatorRole;

    if (!role) {
        const userContext = await getUserContextById(creatorUserContextId);
        role = userContext?.rol_nombre;
    }

    const targetRoles = getRolesDestinoPorCreador(role);
    if (targetRoles.length === 0) {
        return [];
    }

    return await getUserIdsByRoles(targetRoles, creatorUserContextId);
};

export const getTiposLicencia = async (): Promise<TipoLicenciaDTO[]> => {
    return await licenciasRepo.getTiposLicencia();
};

export const getSaldosUsuario = async (usuarioId: number): Promise<SaldosUsuarioDTO> => {
    const saldosAusencia = await licenciasRepo.getSaldosByUsuario(usuarioId);
    for (const saldo of saldosAusencia) {
        saldo.dias_disponibles = saldo.dias_otorgados / 10 - saldo.dias_consumidos / 10;
    }

    const francoRaw = await getSaldoFrancoByUsuario(usuarioId);
    const francosMinutos = francoRaw.minutos_disponibles - francoRaw.minutos_consumidos;

    return {
        ausencias: saldosAusencia,
        francos: minutosAHoras(francosMinutos),
        francosMinutos,
    };
};

export const getSaldoFrancosEmpleado = async (userContextId: number): Promise<{ user_context_id: number; horas: number; minutos: number }> => {
    const raw = await getSaldoFrancoByUsuario(userContextId);
    const minutos = raw.minutos_disponibles - raw.minutos_consumidos;
    return {
        user_context_id: userContextId,
        horas: minutosAHoras(minutos),
        minutos,
    };
};

export const getSaldoVacacionesEmpleado = async (usuarioId: number): Promise<SaldoAusenciaDTO[]> => {
    const saldos = await licenciasRepo.getSaldosVacacionesByUsuario(usuarioId);
    for (const saldo of saldos) {
        saldo.dias_disponibles = saldo.dias_otorgados / 10 - saldo.dias_consumidos / 10;
    }
    return saldos;
};

export const getSolicitudes = async (filters: SolicitudFilterDTO, viewerContextId?: number): Promise<SolicitudAusenciaDTO[]> => {
    await licenciasRepo.expirarSolicitudesAusenciaVencidas();

    if (viewerContextId) {
        const idRolViewer = await licenciasRepo.getIdRolByUserContextId(viewerContextId);
        if (idRolViewer !== null) {
            filters.id_rol_max_creador = idRolViewer;
        }
    }
    return await licenciasRepo.getSolicitudes(filters);
};

export const getLicenciasAprobadasService = async (): Promise<SolicitudDTO[]> => {
    return await getLicenciasAprobadasRepo();
}

export const getSolicitudesUnseenByUser = async (usuarioId: number): Promise<number> => {
    const role_id = await licenciasRepo.getIdRolByUserContextId(usuarioId);
    if (role_id === null) {
        throw new Error('No se pudo determinar el rol del usuario.'); // unexpected state: leave as plain Error
    }
    return await licenciasRepo.getSolicitudesPendingNumber(role_id);
};

export const getSolicitudesPendingByUser = async (usuarioId: number): Promise<number> => {
    return await licenciasRepo.getSolicitudesPendingByUser(usuarioId);
};

export const getSolicitudesUsuario = async (usuarioId: number): Promise<SolicitudAusenciaDTO[]> => {
    await licenciasRepo.expirarSolicitudesAusenciaVencidasPorUsuario(usuarioId);
    return await licenciasRepo.getSolicitudes({ usuario_id: usuarioId });
}

export const crearSolicitud = async (userContextId: number, data: CreateSolicitudDTO): Promise<SolicitudAusenciaDTO> => {
    const tieneDias = data.cantidad_dias != null;
    const tieneHoras = data.cantidad_horas != null;
    const fechaInicio = data.fecha_inicio;

    if (!tieneDias && !tieneHoras) {
        throw new BadRequestError('Debe indicar la cantidad de días o la cantidad de horas.');
    }
    if (tieneDias && tieneHoras) {
        throw new BadRequestError('Debe indicar solo días o solo horas, no ambos.');
    }

    if (tieneDias) {
        validarFraccionario(data.cantidad_dias!, 'La cantidad de días');
    }
    if (tieneHoras) {
        validarFraccionario(data.cantidad_horas!, 'La cantidad de horas');
    }

    const tipo = await licenciasRepo.getTipoLicenciaById(data.tipo_licencia_id);
    if (!tipo) throw new UnprocessableEntityError('Tipo de licencia no válido.');

    if (tipo.requiere_saldo && !tieneDias) {
        throw new UnprocessableEntityError('Las licencias que requieren saldo deben indicar cantidad de días.');
    }

    const fechaFin = calcularFechaFin(fechaInicio, data.cantidad_dias, data.cantidad_horas);

    const overlapping = await licenciasRepo.findOverlappingSolicitudes(userContextId, fechaInicio, fechaFin);
    if (overlapping.length > 0) {
        throw new ConflictError('Ya existe una solicitud activa en el rango de fechas seleccionado.');
    }

    if (tipo.requiere_saldo) {
        const saldo = await licenciasRepo.getSaldoEspecifico(userContextId, data.tipo_licencia_id);

        if (!saldo) throw new UnprocessableEntityError(`No tienes saldo asignado para ${tipo.nombre}.`);

        // Las pendientes del mismo tipo se descontarán si se aprueban: se simulan en orden de creación
        // antes de la nueva, partiendo del residuo actual del saldo (todo en décimas).
        const pendientes = (await licenciasRepo.getSolicitudes({ usuario_id: userContextId, tipo_licencia_id: data.tipo_licencia_id }))
            .filter(s => ESTADOS_PENDIENTES.includes(s.estado) && s.cantidad_dias != null)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id);

        let residuo = saldo.residuo ?? 0;
        let comprometidos = 0;
        for (const p of pendientes) {
            const r = calculateResiduoNuevo(residuo, p.cantidad_dias!);
            comprometidos += r.dias_descontados;
            residuo = r.nuevo_residuo;
        }
        const { dias_descontados } = calculateResiduoNuevo(residuo, Math.round(data.cantidad_dias! * 10));

        const disponibles = saldo.dias_otorgados - saldo.dias_consumidos - comprometidos;
        if (disponibles < dias_descontados) {
            const detallePendientes = comprometidos > 0 ? ` (descontando ${decimasADias(comprometidos)} de solicitudes pendientes)` : '';
            throw new UnprocessableEntityError(
                `Saldo insuficiente. Disponibles: ${decimasADias(disponibles)}${detallePendientes}, Solicitados: ${decimasADias(dias_descontados)}.`
            );
        }
    }

    const estadoInicial = (tipo.requiere_adjunto && data.archivosIds === undefined) ? EstadoSolicitud.PENDIENTE_DOCUMENTACION : EstadoSolicitud.PENDIENTE;

    const cantidadDiasDb = tieneDias ? data.cantidad_dias! * 10 : null;
    const cantidadMinutosDb = tieneHoras ? horasAMinutos(data.cantidad_horas!) : null;

    return await licenciasRepo.createSolicitud(
        userContextId,
        data,
        fechaFin,
        cantidadDiasDb,
        cantidadMinutosDb,
        estadoInicial,
    );
};

export const adjuntarArchivo = async (solicitudId: number, usuarioId: number, archivoId: number, role?: string): Promise<void> => {
    await licenciasRepo.expirarSolicitudesAusenciaVencidasPorSolicitud(solicitudId);

    const solicitud = await licenciasRepo.getSolicitudById(solicitudId);
    if (!solicitud) throw new NotFoundError('Solicitud no encontrada.');

    const tipo = await licenciasRepo.getTipoLicenciaById(solicitud.tipo_licencia_id);

    if (solicitud.usuario_id === usuarioId) {
        const estadosBloqueadosDueño = tipo?.requiere_adjunto
            ? [EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA]
            : [EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.EXPIRADA, EstadoSolicitud.CONSUMIDA];

        if (estadosBloqueadosDueño.includes(solicitud.estado)) {
            throw new UnprocessableEntityError('No se pueden adjuntar archivos a una solicitud finalizada.');
        }

        await licenciasRepo.addArchivoToSolicitud(solicitudId, archivoId);

        if ([EstadoSolicitud.PENDIENTE_DOCUMENTACION, EstadoSolicitud.EXPIRADA].includes(solicitud.estado)) {
            await licenciasRepo.updateSolicitudEstado(solicitudId, EstadoSolicitud.PENDIENTE);
        }
    } else if (role && licenciaAprobadorRoles.includes(role)) {
        if (solicitud.estado === EstadoSolicitud.EXPIRADA) {
            await licenciasRepo.addArchivoToSolicitud(solicitudId, archivoId);
            await licenciasRepo.updateSolicitudEstado(solicitudId, EstadoSolicitud.PENDIENTE);
        } else {
            throw new ForbiddenError('No tienes permiso para adjuntar archivos a esta solicitud.');
        }
    } else {
        throw new ForbiddenError('No tienes permiso para adjuntar archivos a esta solicitud.');
    }

};

export const cancelarSolicitud = async (solicitudId: number, usuarioId: number): Promise<void> => {
    await licenciasRepo.expirarSolicitudesAusenciaVencidasPorSolicitud(solicitudId);

    const solicitud = await licenciasRepo.getSolicitudById(solicitudId);
    if (!solicitud) throw new NotFoundError('Solicitud no encontrada.');

    const fechaInicioSolicitud = new Date(solicitud.fecha_inicio);

    if (Number.isNaN(fechaInicioSolicitud.getTime())) {
        throw new UnprocessableEntityError('Fecha de inicio inválida en la solicitud.');
    }

    if (solicitud.usuario_id !== usuarioId) {
        throw new ForbiddenError('No tienes permiso para cancelar esta solicitud.');
    }

    if ([EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.EXPIRADA].includes(solicitud.estado)) {
        throw new UnprocessableEntityError('La solicitud ya está finalizada o cancelada.');
    }

    if (fechaInicioSolicitud <= new Date()) {
        throw new UnprocessableEntityError('No se puede cancelar una solicitud que ya ha comenzado o ha pasado.');
    }

    let saldo = null;
    let francoRefund = null;

    if (solicitud.estado === EstadoSolicitud.APROBADA) {
        const tipo = await licenciasRepo.getTipoLicenciaById(solicitud.tipo_licencia_id);
        if (tipo && tipo.id === TIPO_LICENCIA_FRANCO) {
            const consumido = await getConsumoFrancoBySolicitud(solicitud.id);
            if (consumido != null && consumido > 0) {
                francoRefund = {
                    userContextId: solicitud.usuario_id,
                    minutos: consumido,
                };
            }
        } else if (tipo && tipo.requiere_saldo) {
            saldo = {
                usuarioId: solicitud.usuario_id,
                tipoId: solicitud.tipo_licencia_id,
                recalcular: calcularReintegro,
            };
        }
    }

    await licenciasRepo.executeCancellationTransaction(
        solicitudId,
        saldo,
        francoRefund,
        // Solo una licencia aprobada se aplicó a los turnos.
        solicitud.estado === EstadoSolicitud.APROBADA,
        (client) => revertirLicencia(client, solicitudId).then(() => undefined)
    );
};

export const aprobarSolicitud = async (data: AprobarSolicitudDTO): Promise<void> => {
    await licenciasRepo.expirarSolicitudesAusenciaVencidasPorSolicitud(data.solicitud_id);

    const solicitud = await licenciasRepo.getSolicitudById(data.solicitud_id);
    if (!solicitud) throw new NotFoundError('Solicitud no encontrada.');

    const fechaInicioSolicitud = new Date(solicitud.fecha_inicio);

    if (Number.isNaN(fechaInicioSolicitud.getTime())) {
        throw new UnprocessableEntityError('Fecha de inicio inválida en la solicitud.');
    }

    const estadosAprobables = [EstadoSolicitud.PENDIENTE, EstadoSolicitud.PENDIENTE_DOCUMENTACION, EstadoSolicitud.EXPIRADA];
    if (!estadosAprobables.includes(solicitud.estado)) {
        throw new UnprocessableEntityError('La solicitud no está en un estado aprobable.');
    }

    const [idRolAprobador, idRolCreador] = await Promise.all([
        licenciasRepo.getIdRolByUserContextId(data.aprobador_id),
        licenciasRepo.getIdRolByUserContextId(solicitud.usuario_id),
    ]);
    if (idRolAprobador === null || idRolCreador === null) {
        throw new Error('No se pudo verificar la jerarquía de roles.');
    }
    if (idRolAprobador >= idRolCreador) {
        throw new ForbiddenError('No tenés jerarquía suficiente para aprobar esta solicitud.');
    }

    const tipo = await licenciasRepo.getTipoLicenciaById(solicitud.tipo_licencia_id);
    if (!tipo) throw new UnprocessableEntityError('Tipo de licencia inválido.');

    let saldo = null;
    let francoUpdate = null;

    // El franco por horas lo consume la DB al aplicarse a los turnos; acá solo el de días.
    if (tipo.id === TIPO_LICENCIA_FRANCO && solicitud.cantidad_minutos == null && solicitud.cantidad_dias != null) {
        francoUpdate = {
            userContextId: solicitud.usuario_id,
            minutos: await calcularMinutosFrancoDias(solicitud.usuario_id, solicitud.cantidad_dias),
        };
    } else if (tipo.requiere_saldo) {
        const cantidadDias = solicitud.cantidad_dias;
        if (cantidadDias == null) throw new UnprocessableEntityError('La solicitud no indica cantidad de días.');

        // El saldo se valida y se descuenta sobre la fila bloqueada, dentro de la transacción.
        saldo = {
            usuarioId: solicitud.usuario_id,
            tipoId: solicitud.tipo_licencia_id,
            calcular: (fila: SaldoBloqueado | null) => calcularDescuento(fila, cantidadDias, tipo.nombre),
        };
    }

    await licenciasRepo.executeApprovalTransaction(
        solicitud.id,
        data.aprobador_id,
        data.observacion,
        saldo,
        francoUpdate,
        (client) => aplicarLicencia(client, solicitud.id).then(() => undefined)
    );
};

export const rechazarSolicitud = async (data: RechazarSolicitudDTO): Promise<void> => {
    await licenciasRepo.expirarSolicitudesAusenciaVencidasPorSolicitud(data.solicitud_id);

    const solicitud = await licenciasRepo.getSolicitudById(data.solicitud_id);
    if (!solicitud) throw new NotFoundError('Solicitud no encontrada.');

    // 1. Validate State
    if ([EstadoSolicitud.APROBADA, EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.CONSUMIDA].includes(solicitud.estado)) {
        throw new UnprocessableEntityError('No se puede rechazar una solicitud ya procesada.');
    }

    // 2. Validate Hierarchy: el que rechaza debe tener mayor rango (id_rol menor) que el creador
    const [idRolAprobador, idRolCreador] = await Promise.all([
        licenciasRepo.getIdRolByUserContextId(data.aprobador_id),
        licenciasRepo.getIdRolByUserContextId(solicitud.usuario_id),
    ]);
    if (idRolAprobador === null || idRolCreador === null) {
        throw new Error('No se pudo verificar la jerarquía de roles.');
    }
    if (idRolAprobador >= idRolCreador) {
        throw new ForbiddenError('No tenés jerarquía suficiente para rechazar esta solicitud.');
    }

    await licenciasRepo.updateSolicitudEstado(
        solicitud.id,
        EstadoSolicitud.RECHAZADA,
        data.aprobador_id,
        data.observacion
    );
};

export const getUsuarioIdDeSolicitud = async (solicitudId: number): Promise<number | null> => {
    return await licenciasRepo.getUsuarioIdBySolicitudId(solicitudId);
};

const reportarLicenciaSinDocumentacion = async (usuarioId: number, solicitudId: number): Promise<void> => {
    await generateLicenciaSinDocumentacionReport(usuarioId, solicitudId);

    const destinatarios = await getDestinatariosNotificacionNuevaLicencia(usuarioId);
    const recipients = Array.from(new Set([...destinatarios, usuarioId]));

    const data = {
        type: 'licencia_sin_documentacion',
        solicitud_id: solicitudId,
        domain: 'licencias',
        event: 'status_changed',
        updated_at: new Date().toISOString(),
        entity_id: String(solicitudId),
    };

    emitToUsers(recipients, data);
    await sendNotificationToMultipleUsers(recipients, {
        title: '⚠️ Licencia médica sin documentación',
        body: 'Una licencia médica quedó sin la documentación requerida. Se generó un reporte.',
        data,
        priority: 'high',
    }).catch((notifError) => {
        console.error('Error enviando notificación de licencia sin documentación:', notifError);
    });
};

export const procesarExpiracionesSinDocumentacion = async (expiredSolicitudes: SolicitudAusenciaDTO[]): Promise<void> => {
    for (const s of expiredSolicitudes) {
        await reportarLicenciaSinDocumentacion(s.usuario_id, s.id);
    }
};

export const ejecutarSweepConsumoLicencias = async (): Promise<number> => {
    const candidatos = await licenciasRepo.getSolicitudesAprobadasParaConsumir();
    let procesados = 0;

    for (const c of candidatos) {
        const claimed = await licenciasRepo.marcarSolicitudesConsumidas([c.id]);
        if (claimed === 0) continue;
        procesados++;

        const tipo = await licenciasRepo.getTipoLicenciaById(c.tipo_licencia_id);
        if (!tipo?.requiere_adjunto) continue;

        const fileCount = await licenciasRepo.countArchivosSolicitud(c.id);
        if (fileCount > 0) continue;

        await reportarLicenciaSinDocumentacion(c.usuario_id, c.id);
    }

    return procesados;
};

export const __licenciasTestUtils = { calculateResiduoNuevo, calcularDescuento, calcularReintegro };
