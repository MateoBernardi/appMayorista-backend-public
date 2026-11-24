import { NextFunction, Request, Response } from "express";
import { asAppError, BadRequestError, ConflictError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import { HorariosDTO, HorarioUsuarioDTO, ScanDTO, SedeDTO, HorasSemanalDTO, HorasSemanaProyeccionDTO, SaldoVacacionesDTO, KioskSecretResponseDTO } from "../domain/dto/HorariosDTO";
import { getShiftsService, getShiftsByUserService, updateShiftService, receiveScan, getSedesService, getExtraHorasService, liquidarHorasFrancoService, getMovimientosService, aceptarTurnoService, getFeriadosService, getHorasSemanalesService, getSaldosVacacionesService, getHorasSemanaProyeccionService, marcarFeriadoDiaService, getScanHistoryService, crearTurnoService } from "../domain/services/horariosServices";
import { sendNotificationToUser } from "../domain/services/devicesService";
import { getSedeQrSecret } from "../adapters/db/horariosRepo";
import { parseFechaLocalISO } from "../utils/dateOnly";
import { STEP_SECONDS } from "../utils/qrToken";
import { horasAMinutos } from "../utils/duracion";

export const getSedesController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const sedes: SedeDTO[] = await getSedesService();
        res.status(200).json(sedes);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getShiftsController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const viewerContextId = requireUserContextId(req);
        const dia_fecha = req.query.dia_fecha as string;
        const filter = req.query.filter as string | undefined;

        if (!dia_fecha) {
            throw new BadRequestError('Por favor, especificá el día.');
        }
        const shifts: HorarioUsuarioDTO[] = await getShiftsService(dia_fecha, filter, viewerContextId);
        res.status(200).json(shifts);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getShiftsByUserController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const fechaInicio = req.query.fechaInicio as string;
        const fechaFin = req.query.fechaFin as string;

        if (!fechaInicio || !fechaFin) {
            throw new BadRequestError('Por favor, especificá un rango de fechas.');
        }

        const fechaInicioDate = parseFechaLocalISO(fechaInicio);
        const fechaFinDate = parseFechaLocalISO(fechaFin);
        if (!fechaInicioDate || !fechaFinDate) {
            throw new BadRequestError('Fecha inválida.');
        }

        const shifts: HorarioUsuarioDTO[] = await getShiftsByUserService(userContextId, fechaInicioDate, fechaFinDate);
        res.status(200).json(shifts);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getFeriadosController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const fechaInicio = req.query.fechaInicio as string;
        const fechaFin = req.query.fechaFin as string;
        if (!fechaInicio || !fechaFin) {
            throw new BadRequestError('Por favor, especificá un rango de fechas.');
        }

        const userRaw = req.query.user_context_id as string | undefined;
        const roleRaw = req.query.role as string | undefined;

        const targetUserContextId = userRaw ? Number(userRaw) : undefined;
        if (targetUserContextId !== undefined && isNaN(targetUserContextId)) {
            throw new BadRequestError('user_context_id inválido.');
        }

        const shifts: HorarioUsuarioDTO[] = await getFeriadosService({
            fechaInicio,
            fechaFin,
            userContextId: targetUserContextId,
            rolNombre: roleRaw,
        });
        res.status(200).json(shifts);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getHorasSemanalesController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const viewerContextId = requireUserContextId(req);

        const fechaInicio = req.query.fechaInicio as string;
        const fechaFin = req.query.fechaFin as string;
        if (!fechaInicio || !fechaFin) {
            throw new BadRequestError('Por favor, especificá un rango de fechas.');
        }

        const userRaw = req.query.user_context_id as string | undefined;
        const roleRaw = req.query.role as string | undefined;

        const targetUserContextId = userRaw ? Number(userRaw) : undefined;
        if (targetUserContextId !== undefined && isNaN(targetUserContextId)) {
            throw new BadRequestError('user_context_id inválido.');
        }

        const list: HorasSemanalDTO[] = await getHorasSemanalesService({
            fechaInicio,
            fechaFin,
            userContextId: targetUserContextId,
            rolNombre: roleRaw,
            viewerContextId,
        });
        res.status(200).json(list);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getSaldosVacacionesController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const viewerContextId = requireUserContextId(req);
        const list: SaldoVacacionesDTO[] = await getSaldosVacacionesService({ viewerContextId });
        res.status(200).json(list);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getHorasSemanaProyeccionController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const viewerContextId = requireUserContextId(req);

        const fechaInicio = req.query.fechaInicio as string;
        const fechaFin = req.query.fechaFin as string;
        if (!fechaInicio || !fechaFin) {
            throw new BadRequestError('Por favor, especificá un rango de fechas.');
        }

        const userRaw = req.query.user_context_id as string | undefined;
        const roleRaw = req.query.role as string | undefined;

        const targetUserContextId = userRaw ? Number(userRaw) : undefined;
        if (targetUserContextId !== undefined && isNaN(targetUserContextId)) {
            throw new BadRequestError('user_context_id inválido.');
        }

        const list: HorasSemanaProyeccionDTO[] = await getHorasSemanaProyeccionService({
            fechaInicio,
            fechaFin,
            userContextId: targetUserContextId,
            rolNombre: roleRaw,
            viewerContextId,
        });
        res.status(200).json(list);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const updateShiftController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const { id, turno, horario_in, horario_out, sede_id_in, sede_id_out, licencia, feriado, horario_corrido } = req.body;

        if (!id) {
            throw new BadRequestError('Por favor, especificá el horario a modificar.');
        }

        const datos: HorariosDTO = {
            id,
            userContextId,
            turno,
            horario_in,
            horario_out,
            sede_id_in,
            sede_id_out,
            licencia,
            feriado,
            horarioCorrido: horario_corrido,
        };

        const actualizado = await updateShiftService(datos, userContextId);

        res.status(200).json({ message: 'Turno actualizado correctamente.' });

        // Destinatario y fecha salen del turno en la DB, no del body.
        if (actualizado.userContextId !== userContextId && actualizado.nuevoIn) {
            const fecha = actualizado.nuevoIn.slice(0, 10);
            const [anio, mes, dia] = fecha.split('-');
            sendNotificationToUser(actualizado.userContextId, {
                title: 'Turno actualizado',
                body: `Tu turno del ${dia}/${mes}/${anio} fue modificado.`,
                data: {
                    type: 'turno_actualizado',
                    domain: 'horarios',
                    event: 'updated',
                    fecha,
                    turno: actualizado.turno,
                    updated_at: new Date().toISOString(),
                },
            }).catch(err => console.error('Error enviando notificacion de turno actualizado:', err));
        }
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getScanHistoryController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const planificacionId = Number(req.params.id);
        if (!Number.isInteger(planificacionId) || planificacionId <= 0) {
            throw new BadRequestError('Turno inválido.');
        }

        const scans = await getScanHistoryService(planificacionId);
        res.status(200).json(scans);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const marcarFeriadoDiaController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const { fecha, feriado, turno } = req.body;
        if (!fecha) {
            throw new BadRequestError('Por favor, especificá el día.');
        }

        const result = await marcarFeriadoDiaService(fecha, Boolean(feriado), turno);
        res.status(200).json({ message: 'Turnos actualizados correctamente.', affected: result.affected });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const scanController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const tipo = req.body.tipo;
        if (tipo !== undefined && tipo !== 'IN' && tipo !== 'OUT') {
            throw new BadRequestError('Tipo de escaneo inválido.');
        }

        const scanData: ScanDTO = {
            userContextId,
            fecha: req.body.fecha,
            turno: req.body.turno,
            latitud: req.body.latitud,
            longitud: req.body.longitud,
            deviceId: req.body.device_identifier,
            token: req.body.token,
            tipo
        };

        const result = await receiveScan(scanData);
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

// Secreto QR rotativo de una sede, para que el kiosco lo cachee y compute el código
// localmente. Nota de confianza: cualquier cuenta 'kiosco' puede pedir el secreto de
// cualquier sede (no solo la propia) — aceptable porque las cuentas kiosco son
// provisionadas y controladas por la empresa, no por el usuario final.
export const kioskSecretController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sedeIdRaw = req.query.sedeId as string | undefined;
        const sedeId = Number(sedeIdRaw);

        if (!sedeIdRaw || !Number.isInteger(sedeId) || sedeId <= 0) {
            throw new BadRequestError('sedeId inválido.');
        }

        const sede = await getSedeQrSecret(sedeId);

        if (!sede) {
            throw new NotFoundError('Sede no encontrada.');
        }

        if (sede.qrMode === 'ROTATING' && !sede.qrSecret) {
            throw new ConflictError('La sede no tiene un secreto QR configurado.');
        }

        const response: KioskSecretResponseDTO = { ...sede, timestamp: Date.now(), step: STEP_SECONDS };
        res.status(200).json(response);
    } catch (error) {
        next(asAppError(error, 'No se pudo obtener el secreto de la sede.'));
    }
};

export const getExtraHorasController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const userRaw = req.query.user_context_id as string | undefined;
        const roleRaw = req.query.role as string | undefined;

        const targetUserContextId = userRaw ? Number(userRaw) : undefined;
        if (targetUserContextId !== undefined && isNaN(targetUserContextId)) {
            throw new BadRequestError('user_context_id inválido.');
        }

        const list = await getExtraHorasService({
            userContextId: targetUserContextId,
            rolNombre: roleRaw,
        });

        res.status(200).json(list);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const liquidarHorasController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const targetUserContextId = Number(req.params.id);
        if (isNaN(targetUserContextId)) {
            throw new BadRequestError('Usuario inválido.');
        }

        // `minutos` (entero) es el parámetro actual; `horas` (decimal) queda por compatibilidad
        // con versiones anteriores de la app.
        let minutos: number;
        if (req.query.minutos !== undefined) {
            minutos = Number(req.query.minutos);
            if (!Number.isInteger(minutos) || minutos <= 0) {
                throw new BadRequestError('Por favor, especificá una cantidad de minutos entera y mayor a 0.');
            }
        } else {
            const horas = Number(req.query.horas);
            if (!req.query.horas || isNaN(horas) || horas <= 0) {
                throw new BadRequestError('Por favor, especificá una cantidad de horas mayor a 0.');
            }
            minutos = horasAMinutos(horas);
        }

        const result = await liquidarHorasFrancoService(targetUserContextId, minutos);
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const getMovimientosController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserContextId(req);

        const userRaw = req.query.user_context_id as string | undefined;
        const targetUserContextId = Number(userRaw);
        if (!userRaw || isNaN(targetUserContextId)) {
            throw new BadRequestError('user_context_id inválido.');
        }

        const mes = req.query.mes as string | undefined;
        if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
            throw new BadRequestError('Por favor, especificá el mes en formato YYYY-MM.');
        }

        const list = await getMovimientosService({ userContextId: targetUserContextId, mes });
        res.status(200).json(list);
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const aceptarTurnoController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);

        const id = Number(req.body.id);
        if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
            throw new BadRequestError('Por favor, especificá el turno a aceptar.');
        }

        const row = await aceptarTurnoService(id, userContextId);
        res.status(200).json({ id: row.id, acepted_at: row.acepted_at });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

const TURNOS_VALIDOS = ['Mañana', 'Tarde', 'Noche', 'Rotativo'];
const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

// "YYYY-MM-DDTHH:mm" sin zona → Date en hora local del server (mismo criterio que la carga masiva).
const parseTimestampLocal = (raw: unknown, campo: string): Date => {
    if (typeof raw !== 'string' || !TIMESTAMP_REGEX.test(raw)) {
        throw new BadRequestError(`${campo} inválido (formato esperado YYYY-MM-DDTHH:mm).`);
    }
    const fecha = new Date(raw.replace(' ', 'T'));
    if (isNaN(fecha.getTime())) {
        throw new BadRequestError(`${campo} inválido.`);
    }
    return fecha;
};

export const createShiftController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const editorId = requireUserContextId(req);

        const { user_context_id, turno = 'Rotativo', horario_in, horario_out, sede_id_in, sede_id_out } = req.body;

        const usuarioId = Number(user_context_id);
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
            throw new BadRequestError('Por favor, especificá el usuario.');
        }
        if (!TURNOS_VALIDOS.includes(turno)) {
            throw new BadRequestError('Turno inválido.');
        }
        const sedeIn = Number(sede_id_in);
        const sedeOut = sede_id_out === undefined || sede_id_out === null ? sedeIn : Number(sede_id_out);
        if (!Number.isInteger(sedeIn) || sedeIn <= 0 || !Number.isInteger(sedeOut) || sedeOut <= 0) {
            throw new BadRequestError('Sede inválida.');
        }

        const datos: HorariosDTO = {
            userContextId: usuarioId,
            turno,
            horario_in: parseTimestampLocal(horario_in, 'horario_in'),
            horario_out: parseTimestampLocal(horario_out, 'horario_out'),
            sede_id_in: sedeIn,
            sede_id_out: sedeOut,
            licencia: false,
            feriado: null,
        };

        await crearTurnoService(datos);

        res.status(201).json({ message: 'Turno creado correctamente.' });

        if (usuarioId !== editorId) {
            const [fecha] = String(horario_in).replace(' ', 'T').split('T');
            const [anio, mes, dia] = (fecha as string).split('-');
            sendNotificationToUser(usuarioId, {
                title: 'Turno asignado',
                body: `Se te asignó un turno el ${dia}/${mes}/${anio}.`,
                data: {
                    type: 'turno_actualizado',
                    domain: 'horarios',
                    event: 'created',
                    fecha,
                    turno,
                    updated_at: new Date().toISOString(),
                },
            }).catch(err => console.error('Error enviando notificacion de turno creado:', err));
        }
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
