/**
 * Tests de dominio: horariosServices — procesarShiftsService, updateShiftService
 * Capa: Domain Service
 * Plataforma: Mayorista
 */

jest.mock('../../adapters/db/horariosRepo');
jest.mock('../../adapters/db/licenciasRepo');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../domain/services/reportesServices');
jest.mock('../../domain/services/solicitudesServices');

import { procesarShiftsService, crearTurnoService, calcularResumenSemanalService, updateShiftService, marcarFeriadoDiaService, getScanHistoryService, getSaldosVacacionesService, ejecutarSweepSinMarcar, ejecutarSweepHorasTrabajadas } from '../../domain/services/horariosServices';
import * as horariosRepo from '../../adapters/db/horariosRepo';
import * as licenciasRepo from '../../adapters/db/licenciasRepo';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as solicitudesServices from '../../domain/services/solicitudesServices';
import { HorariosDTO } from '../../domain/dto/HorariosDTO';
import { AppError, NotFoundError } from '../../adapters/errors/AppError';

const mockRepo = jest.mocked(horariosRepo);
const mockLicenciasRepo = jest.mocked(licenciasRepo);
const mockUsuariosRepo = jest.mocked(usuariosRepo);
const mockSolicitudesServices = jest.mocked(solicitudesServices);

// Fechas relativas a "hoy" para que los tests no se rompan con el paso del tiempo
// (la validación de fecha pasada compara contra el día calendario actual).
const addDays = (days: number, hours = 8): Date => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hours, 0, 0, 0);
    return d;
};

const makeDto = (overrides: Partial<HorariosDTO> = {}): HorariosDTO => ({
    userContextId: 1,
    turno: 'Mañana',
    horario_in: addDays(1, 8),
    horario_out: addDays(1, 16),
    sede_id_in: 10,
    sede_id_out: 10,
    licencia: false,
    feriado: false,
    ...overrides,
});

describe('procesarShiftsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLicenciasRepo.findApprovedSolicitudesForUsersInRange.mockResolvedValue([]);
    });

    it('DTO contract — field names propagate to upsertHorarios unchanged', async () => {
        const dtos: HorariosDTO[] = [makeDto(), makeDto({ userContextId: 2 })];
        mockRepo.upsertHorarios.mockResolvedValue(2);

        await procesarShiftsService(dtos);

        expect(mockRepo.upsertHorarios).toHaveBeenCalledWith(dtos, expect.any(Function));
    });

    it('distinct sede_id_in / sede_id_out values are preserved', async () => {
        const dto = makeDto({ sede_id_in: 10, sede_id_out: 20 });
        const dtos: HorariosDTO[] = [dto];
        mockRepo.upsertHorarios.mockResolvedValue(1);

        await procesarShiftsService(dtos);

        const calledWith: HorariosDTO[] = mockRepo.upsertHorarios.mock.calls[0][0];
        expect(calledWith[0].sede_id_in).toBe(10);
        expect(calledWith[0].sede_id_out).toBe(20);
    });

    it('returns the repo-reported count as totalInsertados with zero totalOmitidos', async () => {
        const dtos: HorariosDTO[] = [makeDto(), makeDto({ userContextId: 2 })];
        mockRepo.upsertHorarios.mockResolvedValue(2);

        const result = await procesarShiftsService(dtos);

        expect(result).toEqual({ totalInsertados: 2, totalOmitidos: 0 });
    });

    it('rows with null horario_in are skipped and counted in totalOmitidos', async () => {
        const valido = makeDto();
        const sinHorario = makeDto({ userContextId: 2, horario_in: null, horario_out: null, licencia: true });
        mockRepo.upsertHorarios.mockResolvedValue(1);

        const result = await procesarShiftsService([valido, sinHorario]);

        expect(mockRepo.upsertHorarios).toHaveBeenCalledWith([valido], expect.any(Function));
        expect(result).toEqual({ totalInsertados: 1, totalOmitidos: 1 });
    });

    it('batch dedupe by (user, turno, day) keeps the last occurrence', async () => {
        const primero = makeDto({ sede_id_in: 10 });
        const ultimo = makeDto({ sede_id_in: 99, horario_in: addDays(1, 9) });
        const otroDia = makeDto({
            horario_in: addDays(2, 8),
            horario_out: addDays(2, 16),
        });
        mockRepo.upsertHorarios.mockResolvedValue(2);

        const result = await procesarShiftsService([primero, ultimo, otroDia]);

        const calledWith: HorariosDTO[] = mockRepo.upsertHorarios.mock.calls[0][0];
        expect(calledWith).toHaveLength(2);
        expect(calledWith).toContain(ultimo);
        expect(calledWith).toContain(otroDia);
        expect(calledWith).not.toContain(primero);
        expect(result).toEqual({ totalInsertados: 2, totalOmitidos: 1 });
    });

    it('propagates repo errors to the caller', async () => {
        const dtos: HorariosDTO[] = [makeDto()];
        mockRepo.upsertHorarios.mockRejectedValue(new Error('db down'));

        await expect(procesarShiftsService(dtos)).rejects.toThrow('db down');
    });

    it('rows with a horario_in from a past calendar day are skipped and counted in totalOmitidos', async () => {
        const valido = makeDto();
        const fechaPasada = makeDto({ userContextId: 2, horario_in: addDays(-1, 8), horario_out: addDays(-1, 16) });
        mockRepo.upsertHorarios.mockResolvedValue(1);

        const result = await procesarShiftsService([valido, fechaPasada]);

        expect(mockRepo.upsertHorarios).toHaveBeenCalledWith([valido], expect.any(Function));
        expect(result).toEqual({ totalInsertados: 1, totalOmitidos: 1 });
    });

    it('a shift for today (same calendar day) is NOT treated as past, even if its start hour already passed', async () => {
        const hoyTemprano = makeDto({ horario_in: addDays(0, 0), horario_out: addDays(0, 1) });
        mockRepo.upsertHorarios.mockResolvedValue(1);

        const result = await procesarShiftsService([hoyTemprano]);

        expect(mockRepo.upsertHorarios).toHaveBeenCalledWith([hoyTemprano], expect.any(Function));
        expect(result).toEqual({ totalInsertados: 1, totalOmitidos: 0 });
    });
});

// Timestamp "YYYY-MM-DD HH:MM:SS" en hora argentina, como lo devuelve pg (ver pgClient).
const tsAR = (msDesdeAhora: number): string =>
    new Date(Date.now() + msDesdeAhora - 3 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
const HORA = 60 * 60 * 1000;

const makeTurno = (overrides: Partial<horariosRepo.ShiftUpdateRow> = {}): horariosRepo.ShiftUpdateRow => ({
    userContextId: 5,
    turno: 'Mañana',
    nombre: 'Ana',
    apellido: 'Gómez',
    previoIn: tsAR(24 * HORA),
    previoOut: tsAR(32 * HORA),
    nuevoIn: tsAR(25 * HORA),
    nuevoOut: tsAR(33 * HORA),
    licencia: false,
    ...overrides,
});

// Simula la transacción del repo: corre beforeCommit y propaga su resultado o su error.
const mockUpdateConTurno = (turno: horariosRepo.ShiftUpdateRow | null) => {
    mockRepo.updateShiftsManually.mockImplementation((async (_datos: HorariosDTO, beforeCommit?: (t: horariosRepo.ShiftUpdateRow) => Promise<unknown>) => {
        if (!turno) return null;
        const resultado = beforeCommit ? await beforeCommit(turno) : undefined;
        return { turno, resultado };
    }) as any);
};

const contextoAviso = { editorNombre: 'Carlos Ruiz', kioscoId: 1, gerenciaIds: [7, 8] };

describe('updateShiftService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUsuariosRepo.getContextoAvisoGerencia.mockResolvedValue(contextoAviso);
        mockSolicitudesServices.createSolicitudService.mockResolvedValue({
            created: true,
            solicitudIds: [100, 101],
            notifications: [{ invitadoId: 7, solicitudId: 100 }, { invitadoId: 8, solicitudId: 101 }],
            rangosOcupados: [],
        });
    });

    it('updates a far-away shift without notifying, forwarding the DTO to the repo', async () => {
        const datos = makeDto({ id: 1, licencia: true });
        const turno = makeTurno();
        mockUpdateConTurno(turno);

        await expect(updateShiftService(datos, 99)).resolves.toEqual(turno);

        expect(mockRepo.updateShiftsManually).toHaveBeenCalledWith(expect.objectContaining({ licencia: true }), expect.any(Function));
        expect(mockSolicitudesServices.createSolicitudService).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the shift does not exist', async () => {
        mockUpdateConTurno(null);

        await expect(updateShiftService(makeDto({ id: 999 }), 99)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('notifies gerencia when the current shift starts within 2 hours, and pushes after commit', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(1 * HORA), nuevoIn: tsAR(3 * HORA) }));

        await updateShiftService(makeDto({ id: 1 }), 99);

        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo_actividad: 'CHAT',
                enviar_por_separado: 1,
                created_by: 1,
                invitados: [1, 7, 8],
                titulo: 'Cambio de turno de último momento',
                descripcion: expect.stringContaining('Carlos Ruiz modificó el turno de Ana Gómez a menos de 2 horas'),
            })
        );
        expect(mockSolicitudesServices.sendSolicitudNotifications).toHaveBeenCalledTimes(1);
    });

    it('does not notify when a far-away shift is moved to within 2 hours (only the previous start counts)', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(24 * HORA), nuevoIn: tsAR(1 * HORA) }));

        await updateShiftService(makeDto({ id: 1 }), 99);

        expect(mockSolicitudesServices.createSolicitudService).not.toHaveBeenCalled();
    });

    it('distinguishes a shift that already started', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(-1 * HORA), nuevoIn: tsAR(-1 * HORA) }));

        await updateShiftService(makeDto({ id: 1 }), 99);

        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(
            expect.objectContaining({
                titulo: 'Cambio de turno ya comenzado',
                descripcion: expect.stringContaining('que ya había comenzado'),
            })
        );
    });

    it('sends the licencia message when the shift is set as licencia less than 2 hours before it starts', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(1 * HORA), nuevoIn: tsAR(1 * HORA), licencia: true }));

        await updateShiftService(makeDto({ id: 1, licencia: true }), 99);

        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(
            expect.objectContaining({
                titulo: 'Licencia de último momento',
                descripcion: 'Carlos Ruiz le dio licencia manualmente a Ana Gómez menos de 2 hs antes de comenzar su turno.',
            })
        );
    });

    it('sends the licencia message for a shift that already started', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(-1 * HORA), nuevoIn: tsAR(-1 * HORA), licencia: true }));

        await updateShiftService(makeDto({ id: 1, licencia: true }), 99);

        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(
            expect.objectContaining({
                titulo: 'Licencia en turno ya comenzado',
                descripcion: 'Carlos Ruiz le dio licencia manualmente a Ana Gómez con su turno ya comenzado.',
            })
        );
    });

    it('does not notify when a far-away shift is set as licencia', async () => {
        mockUpdateConTurno(makeTurno({ licencia: true }));

        await updateShiftService(makeDto({ id: 1, licencia: true }), 99);

        expect(mockSolicitudesServices.createSolicitudService).not.toHaveBeenCalled();
    });

    it('rolls back with ConflictError (without mentioning the notification) when no gerente got the message', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(1 * HORA) }));
        mockSolicitudesServices.createSolicitudService.mockResolvedValue({
            created: true, solicitudIds: [], notifications: [], failedInvitados: [7, 8], rangosOcupados: [],
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(updateShiftService(makeDto({ id: 1 }), 99)).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('está por comenzar'),
        });
        expect(mockSolicitudesServices.sendSolicitudNotifications).not.toHaveBeenCalled();
    });

    it('rolls back with ConflictError when there is no kiosco/gerencia account', async () => {
        mockUpdateConTurno(makeTurno({ previoIn: tsAR(-1 * HORA) }));
        mockUsuariosRepo.getContextoAvisoGerencia.mockResolvedValue({ editorNombre: 'Carlos Ruiz', kioscoId: null, gerenciaIds: [] });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(updateShiftService(makeDto({ id: 1 }), 99)).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('ya comenzó'),
        });
        expect(mockSolicitudesServices.createSolicitudService).not.toHaveBeenCalled();
    });
});

describe('marcarFeriadoDiaService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('parses the ISO date and forwards it plus feriado to the repo, returning the affected count', async () => {
        mockRepo.marcarFeriadoDia.mockResolvedValue(5);

        const result = await marcarFeriadoDiaService('2026-06-15', true);

        expect(result).toEqual({ affected: 5 });
        expect(mockRepo.marcarFeriadoDia).toHaveBeenCalledTimes(1);
        const [fechaArg, feriadoArg] = mockRepo.marcarFeriadoDia.mock.calls[0];
        expect(fechaArg).toBeInstanceOf(Date);
        expect(feriadoArg).toBe(true);
    });

    it('rejects with AppError(400) on an invalid date, without touching the repo', async () => {
        await expect(marcarFeriadoDiaService('not-a-date', true)).rejects.toBeInstanceOf(AppError);
        await expect(marcarFeriadoDiaService('not-a-date', true)).rejects.toMatchObject({ statusCode: 400 });
        expect(mockRepo.marcarFeriadoDia).not.toHaveBeenCalled();
    });
});

describe('calcularResumenSemanalService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('when the repo reports the week already executed (-1), logs the skip and does not throw', async () => {
        mockRepo.getHorasExcedentesSemanales.mockResolvedValue([]);
        mockRepo.getHorasExtrasPostSabado.mockResolvedValue([]);
        mockRepo.acreditarHorasFrancos.mockResolvedValue(-1);
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await expect(calcularResumenSemanalService()).resolves.toBeUndefined();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ya ejecutado'));

        logSpy.mockRestore();
    });

    it('merges excedentes + extrasPostSabado, filters to > 0, and credits with the sabado13 week key', async () => {
        mockRepo.getHorasExcedentesSemanales.mockResolvedValue([
            { userContextId: 1, minutos: 300 },
            { userContextId: 2, minutos: -180 },
        ]);
        mockRepo.getHorasExtrasPostSabado.mockResolvedValue([
            { userContextId: 1, minutos: 120 },
            { userContextId: 3, minutos: 240 },
        ]);
        mockRepo.acreditarHorasFrancos.mockResolvedValue(2);
        jest.spyOn(console, 'log').mockImplementation(() => {});

        await calcularResumenSemanalService();

        expect(mockRepo.acreditarHorasFrancos).toHaveBeenCalledTimes(1);
        const [saldosArg, semanaArg] = mockRepo.acreditarHorasFrancos.mock.calls[0];

        // Merge por userContextId (minutos): user1 = 300+120, user2 = -180 (excluido por no ser > 0), user3 = 240
        expect(saldosArg).toEqual([
            { userContextId: 1, minutos: 420 },
            { userContextId: 3, minutos: 240 },
        ]);

        // La semana pasada es el sábado 13:00 calculado por el servicio
        expect(semanaArg).toBeInstanceOf(Date);
        expect(semanaArg.getHours()).toBe(13);
        expect(semanaArg.getDay()).toBe(6); // sábado
    });
});

describe('getScanHistoryService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('throws NotFoundError when the shift does not exist', async () => {
        mockRepo.getShiftTimesById.mockResolvedValue(null);

        await expect(getScanHistoryService(999)).rejects.toBeInstanceOf(NotFoundError);
        expect(mockRepo.getScansByPlanificacionId).not.toHaveBeenCalled();
    });

    it('returns the scan events for an existing shift', async () => {
        mockRepo.getShiftTimesById.mockResolvedValue({
            userContextId: 1,
            nombre: 'Ana',
            apellido: 'Gómez',
            esperadoIn: '2026-06-15 08:00:00',
            esperadoOut: '2026-06-15 16:00:00',
            marcadoInAt: '2026-06-15 08:00:00',
            marcadoOutAt: null,
        });
        const scans = [
            { tipoScan: 'IN' as const, createdAt: addDays(0, 8), latitud: -31.4, longitud: -64.18 },
        ];
        mockRepo.getScansByPlanificacionId.mockResolvedValue(scans);

        await expect(getScanHistoryService(1)).resolves.toEqual(scans);
        expect(mockRepo.getScansByPlanificacionId).toHaveBeenCalledWith(1);
    });
});

describe('ejecutarSweepSinMarcar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUsuariosRepo.getUsuarioIdsByRoles.mockImplementation(async (roles) =>
            roles.includes('kiosco') ? [1] : roles.includes('encargado') ? [20, 21] : roles.includes('gerencia') ? [7] : []
        );
    });

    const sinMarcar = [
        { userContextId: 30, nombre: 'Ana', apellido: 'Gómez', rolNombre: 'empleado-deposito', falta: 'ENTRADA' as const },
        { userContextId: 20, nombre: 'Carlos', apellido: 'Ruiz', rolNombre: 'encargado', falta: 'SALIDA' as const },
    ];

    it('does nothing when everyone clocked in', async () => {
        mockRepo.getUsuariosSinMarcarHoy.mockResolvedValue([]);

        await expect(ejecutarSweepSinMarcar()).resolves.toBe(0);
        expect(mockSolicitudesServices.createSolicitudService).not.toHaveBeenCalled();
    });

    it('sends one chat per tier and pushes the created notifications', async () => {
        mockRepo.getUsuariosSinMarcarHoy.mockResolvedValue(sinMarcar);
        mockSolicitudesServices.createSolicitudService
            .mockResolvedValueOnce({
                created: true, rangosOcupados: [],
                notifications: [{ invitadoId: 20, solicitudId: 100 }, { invitadoId: 21, solicitudId: 101 }],
            })
            .mockResolvedValueOnce({
                created: true, rangosOcupados: [],
                notifications: [{ invitadoId: 7, solicitudId: 102 }],
            });

        await expect(ejecutarSweepSinMarcar()).resolves.toBe(3);

        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(expect.objectContaining({
            titulo: 'Empleados sin marcar', invitados: [1, 20, 21], descripcion: expect.stringContaining('Ana Gómez'),
        }));
        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(expect.objectContaining({
            titulo: 'Encargados sin marcar', invitados: [1, 7], descripcion: expect.stringContaining('Carlos Ruiz'),
        }));
        expect(mockSolicitudesServices.sendSolicitudNotifications).toHaveBeenCalledWith(
            expect.objectContaining({ titulo: 'Empleados sin marcar' }),
            [{ invitadoId: 20, solicitudId: 100 }, { invitadoId: 21, solicitudId: 101 }]
        );
        expect(mockSolicitudesServices.sendSolicitudNotifications).toHaveBeenCalledWith(
            expect.objectContaining({ titulo: 'Encargados sin marcar' }),
            [{ invitadoId: 7, solicitudId: 102 }]
        );
    });

    it('separates missing entrada from missing salida in the message', async () => {
        mockRepo.getUsuariosSinMarcarHoy.mockResolvedValue([
            ...sinMarcar,
            { userContextId: 31, nombre: 'Luis', apellido: 'Paz', rolNombre: 'empleado-deposito', falta: 'SALIDA' as const },
        ]);
        mockSolicitudesServices.createSolicitudService.mockResolvedValue({ created: true, rangosOcupados: [], notifications: [] });

        await ejecutarSweepSinMarcar();

        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(expect.objectContaining({
            descripcion: 'Los siguientes empleados no registraron la entrada hoy: Ana Gómez.\nLos siguientes empleados no registraron la salida hoy: Luis Paz.',
        }));
        expect(mockSolicitudesServices.createSolicitudService).toHaveBeenCalledWith(expect.objectContaining({
            descripcion: 'Los siguientes encargados no registraron la salida hoy: Carlos Ruiz.',
        }));
    });

    it('counts only delivered messages and logs the failed recipients', async () => {
        mockRepo.getUsuariosSinMarcarHoy.mockResolvedValue([sinMarcar[0]!]);
        mockSolicitudesServices.createSolicitudService.mockResolvedValue({
            created: true, rangosOcupados: [],
            notifications: [{ invitadoId: 20, solicitudId: 100 }], failedInvitados: [21],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(ejecutarSweepSinMarcar()).resolves.toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('empleados'), [21]);

        errorSpy.mockRestore();
    });
});

describe('crearTurnoService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLicenciasRepo.findApprovedSolicitudesForUsersInRange.mockResolvedValue([]);
    });

    it('crea el turno con upsertHorarios', async () => {
        mockRepo.upsertHorarios.mockResolvedValue(1);
        const dto = makeDto({ turno: 'Rotativo' });

        await crearTurnoService(dto);

        expect(mockRepo.upsertHorarios).toHaveBeenCalledWith([dto], expect.any(Function));
    });

    it('rechaza una salida anterior o igual a la entrada sin tocar la DB', async () => {
        await expect(crearTurnoService(makeDto({ horario_out: addDays(1, 8) }))).rejects.toMatchObject({ statusCode: 400 });
        expect(mockRepo.upsertHorarios).not.toHaveBeenCalled();
    });

    it('rechaza un turno en una fecha pasada', async () => {
        mockRepo.upsertHorarios.mockResolvedValue(0); // lote vacío: la fecha pasada se omite
        await expect(crearTurnoService(makeDto({ horario_in: addDays(-2, 8), horario_out: addDays(-2, 16) })))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(mockRepo.upsertHorarios).toHaveBeenCalledWith([], expect.any(Function));
    });
});

describe('ejecutarSweepHorasTrabajadas', () => {
    beforeEach(() => jest.clearAllMocks());

    it('delega en el repo (ventana por defecto) y devuelve la cantidad de turnos actualizados', async () => {
        mockRepo.calcularHorasTrabajadasRecientes.mockResolvedValue(12);

        expect(await ejecutarSweepHorasTrabajadas()).toBe(12);
        expect(mockRepo.calcularHorasTrabajadasRecientes).toHaveBeenCalledWith();
    });

    it('propaga el error del repo (el cron lo registra sin frenar el otro barrido)', async () => {
        mockRepo.calcularHorasTrabajadasRecientes.mockRejectedValue(new Error('db caída'));

        await expect(ejecutarSweepHorasTrabajadas()).rejects.toThrow('db caída');
    });
});

describe('getSaldosVacacionesService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('convierte décimas a días y calcula los disponibles', async () => {
        mockLicenciasRepo.getIdRolByUserContextId.mockResolvedValue(2);
        mockLicenciasRepo.getSaldosVacacionesTodos.mockResolvedValue([
            { userContextId: 7, nombre: 'Ana', apellido: 'Gómez', rolNombre: 'empleado-super', diasOtorgados: 140, diasConsumidos: 35 },
        ]);

        const res = await getSaldosVacacionesService({ viewerContextId: 99 });

        expect(res).toEqual([
            { userContextId: 7, nombre: 'Ana', apellido: 'Gómez', rolNombre: 'empleado-super', diasOtorgados: 14, diasConsumidos: 3.5, diasDisponibles: 10.5 },
        ]);
        expect(mockLicenciasRepo.getSaldosVacacionesTodos).toHaveBeenCalledWith({ idRolViewer: 2 });
    });
});
