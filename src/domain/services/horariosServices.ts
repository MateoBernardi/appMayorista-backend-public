import { HorariosDTO, HorarioUsuarioDTO, ScanDTO, ScanResult, SedeDTO, ResumenHorasUsuarioDTO, HorasSemanalDTO, HorasSemanaProyeccionDTO, EstadoTurnoProyeccion, SaldoVacacionesDTO } from '../dto/HorariosDTO';
import { aplicarLicenciasATurnos } from './licenciasTurnosServices';
import { getShifts, getUserShiftsByUser, upsertHorarios, updateShiftsManually, getDataToCheckScan, registerScan, getSedes, getHorasExcedentesSemanales, getHorasExtrasPostSabado, acreditarHorasFrancos, aceptarTurno, AceptarTurnoRow, getFeriadosByRange, getHorasSemanalesVsObjetivo, getTurnosSemanaProyeccion, ProyeccionTurnoRow, marcarFeriadoDia, getUsuariosSinMarcarHoy, calcularHorasTrabajadasRecientes, getShiftTimesById, getScansByPlanificacionId, ScanEventRow, ShiftUpdateRow } from '../../adapters/db/horariosRepo';
import { registerDevice } from '../../adapters/db/horariosRepo';
import { getExtraHorasSaldoActual, liquidarHorasFranco, getMovimientosByUsuario, ExtraHorasItem, MovimientoItem } from '../../adapters/db/saldosFrancosRepo';
import { findApprovedSolicitudesForUsersInRange, getIdRolByUserContextId, getSaldosVacacionesTodos } from '../../adapters/db/licenciasRepo';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as solicitudesServices from './solicitudesServices';
import { sendNotificationToUser } from './devicesService';
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../adapters/errors/AppError';
import { isValidRotatingToken } from '../../utils/qrToken';
import { parseFechaLocalISO, formatFechaHora, parseTimestampAR } from '../../utils/dateOnly';
import { SolicitudDTO } from '../dto/SolicitudDTO';
import { minutosAHoras } from '../../utils/duracion';


const extractRotatingCode = (rawToken: string): string | null => {
    try {
        const parsed = JSON.parse(rawToken);
        return typeof parsed?.c === 'string' ? parsed.c : null;
    } catch {
        return null;
    }
};

const esFechaPasada = (horario: Date | string | null): boolean => {
    if (!horario) return false;
    const fecha = new Date(horario);
    if (isNaN(fecha.getTime())) return false;
    const soloFecha = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const hoy = new Date();
    const soloHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    return soloFecha < soloHoy;
};

export const procesarShiftsService = async (horarios: HorariosDTO[]): Promise<{ totalInsertados: number; totalOmitidos: number }> => {
    const conHorario = horarios.filter(h => h.horario_in !== null);
    const omitidosSinHorario = horarios.length - conHorario.length;

    const sinFechaPasada = conHorario.filter(h => !esFechaPasada(h.horario_in));
    const omitidosFechaPasada = conHorario.length - sinFechaPasada.length;

    const porClave = new Map<string, HorariosDTO>();
    for (const h of sinFechaPasada) {
        const dia = new Date(h.horario_in as Date).toISOString().slice(0, 10);
        porClave.set(`${h.userContextId}|${h.turno}|${dia}`, h);
    }
    const batch = [...porClave.values()];
    const omitidosDuplicados = sinFechaPasada.length - batch.length;

    const conHorarioOut = batch.filter(h => h.horario_out !== null);
    if (conHorarioOut.length > 0) {
        const userIds = [...new Set(conHorarioOut.map(h => h.userContextId))];
        const fechas = conHorarioOut.flatMap(h => [h.horario_in as Date, h.horario_out as Date]);
        const desde = new Date(Math.min(...fechas.map(d => d.getTime())));
        const hasta = new Date(Math.max(...fechas.map(d => d.getTime())));

        const solicitudes = await findApprovedSolicitudesForUsersInRange(userIds, desde, hasta);

        const conflictos = conHorarioOut.filter(h =>
            solicitudes.some(s =>
                s.usuario_id === h.userContextId &&
                new Date(s.fecha_inicio) <= (h.horario_in as Date) &&
                new Date(s.fecha_fin) >= (h.horario_out as Date)
            )
        );

        if (conflictos.length > 0) {
            const detalle = conflictos
                .map(h => {
                    const s = solicitudes.find(s => s.usuario_id === h.userContextId)!;
                    const dia = (h.horario_in as Date).toISOString().slice(0, 10);
                    return `${s.nombre} ${s.apellido}, día ${dia}`;
                })
                .join('. ');
            throw new BadRequestError(
                `Algunos turnos coinciden con una licencia aprobada. Corregí el archivo (sacá esos turnos) y volvé a subirlo. Turnos a corregir: ${detalle}.`
            );
        }
    }

    const totalInsertados = await upsertHorarios(batch, aplicarLicenciasATurnos);
    return { totalInsertados, totalOmitidos: omitidosSinHorario + omitidosFechaPasada + omitidosDuplicados };
};

export const crearTurnoService = async (datos: HorariosDTO): Promise<void> => {
    if (!datos.horario_in || !datos.horario_out || datos.horario_out <= datos.horario_in) {
        throw new BadRequestError('El horario de salida debe ser posterior al de entrada.');
    }

    const { totalInsertados } = await procesarShiftsService([datos]);
    if (!totalInsertados) {
        throw new BadRequestError('No se pudo crear el turno: la fecha ya pasó.');
    }
};

export const getSedesService = async (): Promise<SedeDTO[]> => {
    return await getSedes();
};

export const getShiftsService = async (diaFecha: string, filter?: string, viewerContextId?: number): Promise<HorarioUsuarioDTO[]> => {
  try {
    const idRolViewer = viewerContextId !== undefined ? await getIdRolByUserContextId(viewerContextId) : null;
    const shifts: HorarioUsuarioDTO[] = await getShifts(diaFecha, filter, idRolViewer ?? undefined);
    return shifts;
  } catch (error) {
    console.error('Error en getShiftsService:', error);
    throw error;
  }
};

export const getShiftsByUserService = async (userContextId: number, fechaInicio: Date, fechaFin: Date): Promise<HorarioUsuarioDTO[]> => {
    try {
        const shifts: HorarioUsuarioDTO[] = await getUserShiftsByUser(userContextId, fechaInicio, fechaFin);
        return shifts;
    } catch (error) {
        console.error('Error en getShiftsByUserService:', error);
        throw error;
    }
};

interface GetFeriadosParams {
    fechaInicio: string;
    fechaFin: string;
    userContextId?: number | undefined;
    rolNombre?: string | undefined;
}

export const getFeriadosService = async (params: GetFeriadosParams): Promise<HorarioUsuarioDTO[]> => {
    try {
        return await getFeriadosByRange(params);
    } catch (error) {
        console.error('Error en getFeriadosService:', error);
        throw error;
    }
};

interface GetHorasSemanalesParams {
    fechaInicio: string;
    fechaFin: string;
    userContextId?: number | undefined;
    rolNombre?: string | undefined;
    viewerContextId?: number | undefined;
}


export const getHorasSemanalesService = async (params: GetHorasSemanalesParams): Promise<HorasSemanalDTO[]> => {
    try {
        const { viewerContextId, ...filtros } = params;
        const idRolViewer = viewerContextId !== undefined ? await getIdRolByUserContextId(viewerContextId) : null;
        const filas = await getHorasSemanalesVsObjetivo({ ...filtros, idRolViewer: idRolViewer ?? undefined });
        return filas.map(f => ({
            userContextId: f.userContextId,
            nombre: f.nombre,
            apellido: f.apellido,
            horasObjetivo: minutosAHoras(f.minutosObjetivo),
            horasObjetivoPendiente: f.minutosObjetivoPendiente === null ? null : minutosAHoras(f.minutosObjetivoPendiente),
            horasTrabajadas: minutosAHoras(f.minutosTrabajados),
            minutosObjetivo: f.minutosObjetivo,
            minutosObjetivoPendiente: f.minutosObjetivoPendiente,
            minutosTrabajados: f.minutosTrabajados,
        }));
    } catch (error) {
        console.error('Error en getHorasSemanalesService:', error);
        throw error;
    }
};

/** Saldo de vacaciones de todos los empleados que tienen fila de vacaciones (en días). */
export const getSaldosVacacionesService = async (params: { viewerContextId?: number | undefined }): Promise<SaldoVacacionesDTO[]> => {
    const idRolViewer = params.viewerContextId !== undefined ? await getIdRolByUserContextId(params.viewerContextId) : null;
    const filas = await getSaldosVacacionesTodos({ idRolViewer: idRolViewer ?? undefined });
    // Las cantidades están en décimas de día.
    return filas.map(f => ({
        userContextId: f.userContextId,
        nombre: f.nombre,
        apellido: f.apellido,
        rolNombre: f.rolNombre,
        diasOtorgados: f.diasOtorgados / 10,
        diasConsumidos: f.diasConsumidos / 10,
        diasDisponibles: (f.diasOtorgados - f.diasConsumidos) / 10,
    }));
};

/**
 * Cuánto aporta un turno a la proyección semanal, según en qué momento está respecto de `ahora`
 * (hora argentina de la DB):
 * - con licencia (turno entero): 0;
 * - todavía no empezó: el turno esperado;
 * - en curso (empezó, no terminó, sin salida marcada): el turno esperado completo;
 * - terminó sin entrada marcada: ausente, 0;
 * - con salida marcada, o terminado con entrada: lo realizado según las marcas.
 */
// Timestamp sin zona de la DB ('YYYY-MM-DD HH:MM:SS', hora argentina) → Date local.
const aFechaLocal = (v: Date | string): Date => (v instanceof Date ? v : new Date(String(v).replace(' ', 'T')));

export const clasificarTurno = (
    turno: Pick<ProyeccionTurnoRow, 'esperadoIn' | 'fin' | 'licencia' | 'marcadoInAt' | 'marcadoOutAt' | 'minutosEsperados' | 'minutosRealizados'>
        & Partial<Pick<ProyeccionTurnoRow, 'minutosPostSabadoEsperados' | 'minutosPostSabadoRealizados'>>,
    ahora: Date
): { estado: EstadoTurnoProyeccion; minutos: number } => {
    // Lo trabajado desde el sábado 13 hs es hora extra: no cuenta en la semana.
    const esperados = Math.max(0, turno.minutosEsperados - (turno.minutosPostSabadoEsperados ?? 0));
    const realizados = Math.max(0, turno.minutosRealizados - (turno.minutosPostSabadoRealizados ?? 0));
    if (turno.licencia) return { estado: 'licencia', minutos: 0 };
    if (turno.marcadoOutAt) return { estado: 'realizado', minutos: realizados };
    if (aFechaLocal(turno.esperadoIn) > ahora) return { estado: 'proyectado', minutos: esperados };
    if (ahora < aFechaLocal(turno.fin)) return { estado: 'en_curso', minutos: esperados };
    if (!turno.marcadoInAt) return { estado: 'ausente', minutos: 0 };
    return { estado: 'realizado', minutos: realizados };
};

export const getHorasSemanaProyeccionService = async (params: GetHorasSemanalesParams): Promise<HorasSemanaProyeccionDTO[]> => {
    const { viewerContextId, ...filtros } = params;
    const idRolViewer = viewerContextId !== undefined ? await getIdRolByUserContextId(viewerContextId) : null;
    const { ahora, usuarios, turnos } = await getTurnosSemanaProyeccion({ ...filtros, idRolViewer: idRolViewer ?? undefined });
    const ahoraDate = aFechaLocal(ahora);

    return usuarios.map(u => {
        const propios = turnos
            .filter(t => t.userContextId === u.userContextId)
            .map(t => ({ fecha: t.fecha, turno: t.turno, ...clasificarTurno(t, ahoraDate), feriado: t.feriado }));
        const minutosRealizados = propios
            .filter(t => t.estado === 'realizado')
            .reduce((acc, t) => acc + t.minutos, 0);
        const minutosProyectados = propios.reduce((acc, t) => acc + t.minutos, 0);
        const minutosFeriado = propios.filter(t => t.feriado).reduce((acc, t) => acc + t.minutos, 0);

        return {
            userContextId: u.userContextId,
            nombre: u.nombre,
            apellido: u.apellido,
            // Mismo descuento que el resumen semanal: las licencias por horas bajan el objetivo.
            minutosObjetivo: Math.max(0, u.minutosObjetivo - u.minutosLicencia),
            minutosObjetivoPendiente: u.minutosObjetivoPendiente,
            minutosRealizados,
            minutosProyectados,
            minutosSaldoFrancos: u.minutosSaldoFrancos,
            minutosFeriado,
            turnos: propios,
        };
    });
};

const UMBRAL_AVISO_MS = 2 * 60 * 60 * 1000;

const avisarGerenciaCambioTurno = async (
    turno: ShiftUpdateRow,
    editorUserContextId: number,
    yaComenzo: boolean
): Promise<{ solicitud: SolicitudDTO; notifications: { invitadoId: number; solicitudId: number }[] }> => {
    const { editorNombre, kioscoId, gerenciaIds } = await usuariosRepo.getContextoAvisoGerencia(editorUserContextId);
    if (!kioscoId || gerenciaIds.length === 0) {
        throw new Error('No hay cuenta kiosco o gerencia para avisar el cambio de turno.');
    }

    const fmt = (ts: string | null) => (ts ? formatFechaHora(parseTimestampAR(ts)) : '-');
    const empleado = `${turno.nombre ?? ''} ${turno.apellido ?? ''}`.trim();
    const editor = editorNombre ?? 'Un usuario';

    const { titulo, descripcion } = turno.licencia
        ? {
            titulo: yaComenzo ? 'Licencia en turno ya comenzado' : 'Licencia de último momento',
            descripcion: yaComenzo
                ? `${editor} le dio licencia manualmente a ${empleado} con su turno ya comenzado.`
                : `${editor} le dio licencia manualmente a ${empleado} menos de 2 hs antes de comenzar su turno.`,
        }
        : {
            titulo: yaComenzo ? 'Cambio de turno ya comenzado' : 'Cambio de turno de último momento',
            descripcion:
                `${editor} modificó el turno de ${empleado} ${yaComenzo ? 'que ya había comenzado' : 'a menos de 2 horas de su inicio'}. \n` +
                `Entrada: ${fmt(turno.previoIn)} → ${fmt(turno.nuevoIn)}. \n` +
                `Salida: ${fmt(turno.previoOut)} → ${fmt(turno.nuevoOut)}.`,
        };

    const solicitud: SolicitudDTO = {
        titulo,
        descripcion,
        created_by: kioscoId,
        tipo_actividad: 'CHAT',
        es_grupo: false,
        enviar_por_separado: 1,
        invitados: [kioscoId, ...gerenciaIds],
        fecha_inicio: null,
        fecha_fin: null,
        crear_de_todos_modos: 1,
    };

    const { notifications = [], failedInvitados = [] } = await solicitudesServices.createSolicitudService(solicitud);
    if (notifications.length === 0) {
        throw new Error(`Ningún gerente recibió el aviso de cambio de turno (fallidos: ${failedInvitados.join(', ')}).`);
    }
    if (failedInvitados.length > 0) {
        console.error('Aviso de cambio de turno no entregado a algunos gerentes:', failedInvitados);
    }

    return { solicitud, notifications };
};

export const updateShiftService = async (datos: HorariosDTO, editorUserContextId: number): Promise<ShiftUpdateRow> => {
    const actualizado = await updateShiftsManually(datos, async (turno) => {
        if (!turno.previoIn) return null;

        const hastaInicio = parseTimestampAR(turno.previoIn).getTime() - Date.now();
        if (hastaInicio > UMBRAL_AVISO_MS) return null;

        const yaComenzo = hastaInicio <= 0;
        try {
            return await avisarGerenciaCambioTurno(turno, editorUserContextId, yaComenzo);
        } catch (err) {
            console.error('Error avisando a gerencia cambio de turno:', err);
            throw new ConflictError(
                yaComenzo
                    ? 'Este turno ya comenzó y no se pudo registrar el cambio. Intentá de nuevo en unos minutos.'
                    : 'Este turno está por comenzar y no se pudo registrar el cambio. Intentá de nuevo en unos minutos.'
            );
        }
    });

    if (!actualizado) {
        throw new NotFoundError('No se encontró el turno a modificar.');
    }

    if (actualizado.resultado) {
        const { solicitud, notifications } = actualizado.resultado;
        solicitudesServices.sendSolicitudNotifications(solicitud, notifications);
    }

    return actualizado.turno;
};

export const marcarFeriadoDiaService = async (fechaISO: string, feriado: boolean, turno?: string): Promise<{ affected: number }> => {
    const fecha = parseFechaLocalISO(fechaISO);
    if (!fecha) {
        throw new BadRequestError('Fecha inválida.');
    }

    const affected = await marcarFeriadoDia(fecha, feriado, turno);
    return { affected };
};

export const receiveScan = async (scanData: ScanDTO): Promise<ScanResult> => {
    const { planificacion } = await getDataToCheckScan(scanData);

    if (!planificacion.deviceId) {
        await registerDevice(scanData.deviceId, scanData.userContextId);
    }

    if (planificacion.tipo_scan === 'DONE') {
        return { success: false, message: 'Ya registraste entrada y salida para este turno.' };
    }

    // El backend es la fuente de la verdad: si el cliente creía estar marcando la entrada pero
    // ya está marcada, no se registra nada y se le avisa que marque la salida.
    if (scanData.tipo && scanData.tipo !== planificacion.tipo_scan) {
        if (planificacion.tipo_scan === 'OUT') {
            return {
                success: false,
                code: 'ENTRADA_YA_MARCADA',
                message: 'Tu entrada ya está marcada. Marcá tu salida cuando termine el turno.'
            };
        }
        // El cliente quiere marcar salida pero la entrada nunca se marcó.
        return { success: false, message: 'Todavía no marcaste tu entrada para este turno.' };
    }

    // Salida demasiado pegada a la entrada: casi seguro un reintento/doble escaneo. Se ignora.
    if (planificacion.tipo_scan === 'OUT' && planificacion.dentroMargenSalida) {
        return {
            success: false,
            code: 'SALIDA_IGNORADA',
            message: 'Tu entrada ya está marcada. Marcá tu salida cuando termine el turno.'
        };
    }

    if (planificacion.geofence === false) {
        return { success: false, message: 'Escaneo fuera del área permitida.' };
    }

    const rotatingCode = planificacion.qrMode === 'ROTATING' ? extractRotatingCode(scanData.token) : null;

    const qrValido = planificacion.qrMode === 'ROTATING'
        ? !!planificacion.qrSecret && !!rotatingCode && isValidRotatingToken(planificacion.qrSecret, rotatingCode)
        : planificacion.codigoQr === scanData.token;

    if (!qrValido) {
        return { success: false, message: 'Token QR inválido.' };
    }

    const resultado = await registerScan(scanData, planificacion.tipo_scan, planificacion.planificacionId, planificacion.deviceRowId);

    // Otro escaneo (concurrente o un reintento) marcó entre la validación y la escritura: no se
    // escribió nada, así que no se puede responder éxito. Se informa con el mismo `code` que el
    // desfase de tipo para que el cliente refresque el estado del turno.
    if (!resultado.registrado) {
        return planificacion.tipo_scan === 'IN'
            ? { success: false, code: 'ENTRADA_YA_MARCADA', message: 'Tu entrada ya está marcada. Marcá tu salida cuando termine el turno.' }
            : { success: false, code: 'SALIDA_YA_MARCADA', message: 'Tu salida ya está marcada.' };
    }

    const { reporte } = resultado;
    if (reporte) {
        // Fire-and-forget: el escaneo ya quedó registrado aunque falle la push
        sendNotificationToUser(scanData.userContextId, {
            title: '⚠️ Nuevo Reporte',
            body: `Se te ha generado un reporte: ${reporte.titulo}`,
            link: 'https://interno.italoarg.com.ar/mis-reportes',
            data: {
                type: 'nuevo_reporte',
                reporte_id: reporte.id,
                usuario_reportado_id: scanData.userContextId,
                domain: 'reportes',
                event: 'created',
                updated_at: new Date().toISOString(),
                entity_id: String(reporte.id)
            },
            priority: 'high'
        }).catch(err => console.error('Error enviando notificación de reporte por escaneo:', err));
    }

    return { success: true, message: 'Escaneo registrado correctamente.' };
};

export const getScanHistoryService = async (planificacionId: number): Promise<ScanEventRow[]> => {
    const shift = await getShiftTimesById(planificacionId);
    if (!shift) {
        throw new NotFoundError('Turno no encontrado.');
    }
    return getScansByPlanificacionId(planificacionId);
};

export const calcularResumenSemanalService = async (): Promise<void> => {
    const now = new Date();

    const sabado13 = new Date(now);
    sabado13.setDate(sabado13.getDate() - ((sabado13.getDay() + 1) % 7)); 
    sabado13.setHours(13, 0, 0, 0);
    if (sabado13 > now) {
        sabado13.setDate(sabado13.getDate() - 7);
    }

    const lunes00 = new Date(sabado13);
    lunes00.setDate(lunes00.getDate() - 5);
    lunes00.setHours(0, 0, 0, 0);

    const [excedentes, extrasPostSabado] = await Promise.all([
        getHorasExcedentesSemanales(lunes00, sabado13),
        getHorasExtrasPostSabado(sabado13, now)
    ]);

    const acumulado = new Map<number, number>();
    for (const { userContextId, minutos } of [...excedentes, ...extrasPostSabado]) {
        acumulado.set(userContextId, (acumulado.get(userContextId) ?? 0) + minutos);
    }

    const saldos: ResumenHorasUsuarioDTO[] = [...acumulado.entries()]
        .filter(([, minutos]) => minutos > 0)
        .map(([userContextId, minutos]) => ({ userContextId, minutos }));

    const resultado = await acreditarHorasFrancos(saldos, sabado13);

    if (resultado === -1) {
        console.log(`[CRON] ⏭ Resumen semanal ya ejecutado para la semana ${sabado13.toISOString().slice(0, 10)}, se omite`);
        return;
    }

    console.log(`[CRON] ✔ Resumen semanal calculado correctamente. Usuarios acreditados: ${saldos.length}`);
};

/** `horas` (2 decimales) se mantiene por compatibilidad; el valor exacto es `minutos`. */
export interface ExtraHorasResponseItem {
    userContextId: number;
    nombre: string;
    apellido: string;
    horas: number;
    minutos: number;
}

interface GetExtraHorasParams {
    userContextId?: number | undefined;
    rolNombre?: string | undefined;
}

export const getExtraHorasService = async ({ userContextId, rolNombre }: GetExtraHorasParams): Promise<ExtraHorasResponseItem[]> => {
    try {
        const filas: ExtraHorasItem[] = await getExtraHorasSaldoActual({ userContextId, rolNombre });

        return filas.map(f => ({
            userContextId: f.userContextId,
            nombre: f.nombre,
            apellido: f.apellido,
            horas: minutosAHoras(f.minutos),
            minutos: f.minutos,
        }));
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error('Error en getExtraHorasService:', error);
        throw error;
    }
};

export interface LiquidarHorasResponse {
    horasDisponibles: number;
    horasConsumidas: number;
    minutosDisponibles: number;
    minutosConsumidos: number;
}

export const liquidarHorasFrancoService = async (
    userContextId: number,
    minutos: number
): Promise<LiquidarHorasResponse> => {
    if (!Number.isInteger(minutos) || minutos <= 0) {
        throw new BadRequestError('La cantidad a liquidar debe ser mayor a 0.');
    }

    const saldo = await liquidarHorasFranco(userContextId, minutos);

    return {
        horasDisponibles: minutosAHoras(saldo.minutos_disponibles),
        horasConsumidas: minutosAHoras(saldo.minutos_consumidos),
        minutosDisponibles: saldo.minutos_disponibles,
        minutosConsumidos: saldo.minutos_consumidos,
    };
};

/** `cantidad` y `saldoResultante` en horas (compatibilidad); los exactos son los de minutos. */
export interface MovimientoResponseItem {
    id: number;
    tipo: string;
    cantidad: number;
    saldoResultante: number | null;
    cantidadMinutos: number;
    saldoResultanteMinutos: number | null;
    createdAt: string;
}

interface GetMovimientosParams {
    userContextId: number;
    mes: string;
}

const MES_REGEX = /^\d{4}-\d{2}$/;

export const getMovimientosService = async ({ userContextId, mes }: GetMovimientosParams): Promise<MovimientoResponseItem[]> => {
    try {
        if (!MES_REGEX.test(mes)) {
            throw new BadRequestError('El formato de mes debe ser YYYY-MM.');
        }

        const [anioStr, mesStr] = mes.split('-');
        const anio = Number(anioStr);
        const mesNum = Number(mesStr);

        if (mesNum < 1 || mesNum > 12) {
            throw new BadRequestError('El formato de mes debe ser YYYY-MM.');
        }

        const desde = new Date(anio, mesNum - 1, 1);
        const hasta = new Date(anio, mesNum, 1);

        const filas: MovimientoItem[] = await getMovimientosByUsuario(userContextId, desde, hasta);

        return filas.map(f => {
            const saldoMinutos =
                f.minutosDisponiblesResultante === null || f.minutosConsumidosResultante === null
                    ? null
                    : f.minutosDisponiblesResultante - f.minutosConsumidosResultante;
            return {
                id: f.id,
                tipo: f.tipoMovimiento,
                cantidad: minutosAHoras(f.minutos),
                saldoResultante: saldoMinutos === null ? null : minutosAHoras(saldoMinutos),
                cantidadMinutos: f.minutos,
                saldoResultanteMinutos: saldoMinutos,
                createdAt: new Date(f.createdAt).toISOString(),
            };
        });
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error('Error en getMovimientosService:', error);
        throw error;
    }
};

export const aceptarTurnoService = async (planificacionId: number, userContextId: number): Promise<AceptarTurnoRow> => {
    const result = await aceptarTurno(planificacionId, userContextId);
    if (result.status === 'not_found') {
        throw new NotFoundError('Turno no encontrado.');
    }
    if (result.status === 'passed') {
        throw new ConflictError('El horario de entrada ya pasó.');
    }
    return result.row;
};

export const ejecutarSweepSinMarcar = async (): Promise<number> => {
    const sinMarcar = await getUsuariosSinMarcarHoy();
    if (sinMarcar.length === 0) return 0;

    const kioscoId = (await usuariosRepo.getUsuarioIdsByRoles(['kiosco']))[0];
    if (!kioscoId) {
        console.error('[Cron sin-marcar] No hay ninguna cuenta con rol kiosco; se omite el envío.');
        return 0;
    }

    const tiers: { origen: (rol: string) => boolean; destinoRoles: string[]; etiqueta: string }[] = [
        { origen: (r) => r.startsWith('empleado-'), destinoRoles: ['encargado'], etiqueta: 'empleados' },
        { origen: (r) => r === 'encargado', destinoRoles: ['gerencia'], etiqueta: 'encargados' },
    ];

    let mensajesEnviados = 0;

    for (const tier of tiers) {
        const delTier = sinMarcar.filter((u) => tier.origen(u.rolNombre));
        if (delTier.length === 0) continue;

        const destinatarios = await usuariosRepo.getUsuarioIdsByRoles(tier.destinoRoles, kioscoId);
        if (destinatarios.length === 0) continue;

        const listar = (falta: 'ENTRADA' | 'SALIDA') =>
            [...new Set(delTier.filter((u) => u.falta === falta).map((u) => `${u.nombre} ${u.apellido}`))].join(', ');
        const sinEntrada = listar('ENTRADA');
        const sinSalida = listar('SALIDA');

        const descripcion = [
            sinEntrada && `Los siguientes ${tier.etiqueta} no registraron la entrada hoy: ${sinEntrada}.`,
            sinSalida && `Los siguientes ${tier.etiqueta} no registraron la salida hoy: ${sinSalida}.`,
        ].filter(Boolean).join('\n');

        const solicitud: SolicitudDTO = {
            titulo: `${tier.etiqueta === 'empleados' ? 'Empleados' : 'Encargados'} sin marcar`,
            descripcion,
            created_by: kioscoId,
            tipo_actividad: 'CHAT',
            es_grupo: false,
            enviar_por_separado: 1,
            invitados: [kioscoId, ...destinatarios],
            fecha_inicio: null,
            fecha_fin: null,
            crear_de_todos_modos: 1,
        };

        const { notifications = [], failedInvitados = [] } = await solicitudesServices.createSolicitudService(solicitud);
        if (failedInvitados.length > 0) {
            console.error(`[Cron sin-marcar] No se pudo enviar el aviso de ${tier.etiqueta} a:`, failedInvitados);
        }
        solicitudesServices.sendSolicitudNotifications(solicitud, notifications);
        mensajesEnviados += notifications.length;
    }

    return mensajesEnviados;
};

export const ejecutarSweepHorasTrabajadas = async (): Promise<number> => {
    return await calcularHorasTrabajadasRecientes();
};
