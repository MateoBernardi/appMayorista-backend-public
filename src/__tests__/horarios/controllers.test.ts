/**
 * Tests de controllers: horariosControllers — updateShiftController, liquidarHorasController
 * Capa: Controller
 * Plataforma: Interno
 */

jest.mock('../../domain/services/horariosServices');
jest.mock('../../domain/services/devicesService');
jest.mock('../../adapters/db/horariosRepo');

import * as horariosServices from '../../domain/services/horariosServices';
import { sendNotificationToUser } from '../../domain/services/devicesService';
import { ConflictError } from '../../adapters/errors/AppError';
import { createMockReqRes } from '../helpers/testHelpers';
import { updateShiftController, liquidarHorasController, getSaldosVacacionesController } from '../../controllers/horariosControllers';

const service = jest.mocked(horariosServices);
const mockedSendNotificationToUser = jest.mocked(sendNotificationToUser);

const turnoActualizado = {
    userContextId: 5,
    turno: 'Mañana',
    nombre: 'Ana',
    apellido: 'Gómez',
    previoIn: '2026-06-15 08:00:00',
    previoOut: '2026-06-15 16:00:00',
    nuevoIn: '2026-06-16 09:00:00',
    nuevoOut: '2026-06-16 17:00:00',
    licencia: false,
};

const body = {
    id: 1,
    turno: 'Mañana',
    horario_in: '2026-06-16T09:00:00',
    horario_out: '2026-06-16T17:00:00',
    sede_id_in: 10,
    sede_id_out: 10,
    licencia: 0,
    feriado: 0,
};

describe('updateShiftController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedSendNotificationToUser.mockResolvedValue(undefined as any);
    });

    it('responde 400 si falta el id del turno', async () => {
        const { req, res, next } = createMockReqRes({ user: { userContextId: 99 }, body: { ...body, id: undefined } });

        await updateShiftController(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        expect(service.updateShiftService).not.toHaveBeenCalled();
    });

    it('notifica al dueño del turno según la DB, ignorando targetUserContextId/fecha del body', async () => {
        service.updateShiftService.mockResolvedValue(turnoActualizado);
        const { req, res, next } = createMockReqRes({
            user: { userContextId: 99 },
            body: { ...body, targetUserContextId: 42, fecha: '2030-01-01' },
        });

        await updateShiftController(req, res, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockedSendNotificationToUser).toHaveBeenCalledTimes(1);
        expect(mockedSendNotificationToUser).toHaveBeenCalledWith(5, expect.objectContaining({
            body: 'Tu turno del 16/06/2026 fue modificado.',
            data: expect.objectContaining({ fecha: '2026-06-16', turno: 'Mañana' }),
        }));
    });

    it('no notifica cuando el editor modifica su propio turno', async () => {
        service.updateShiftService.mockResolvedValue({ ...turnoActualizado, userContextId: 99 });
        const { req, res, next } = createMockReqRes({ user: { userContextId: 99 }, body });

        await updateShiftController(req, res, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockedSendNotificationToUser).not.toHaveBeenCalled();
    });

    it('propaga el error del service (p. ej. 409 de turno por comenzar) sin notificar', async () => {
        service.updateShiftService.mockRejectedValue(new ConflictError('Este turno está por comenzar y no se pudo registrar el cambio.'));
        const { req, res, next } = createMockReqRes({ user: { userContextId: 99 }, body });

        await updateShiftController(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
        expect(res.status).not.toHaveBeenCalled();
        expect(mockedSendNotificationToUser).not.toHaveBeenCalled();
    });
});

describe('liquidarHorasController', () => {
    const saldo = { horasDisponibles: 10, horasConsumidas: 1.25, minutosDisponibles: 600, minutosConsumidos: 75 };

    beforeEach(() => {
        jest.clearAllMocks();
        service.liquidarHorasFrancoService.mockResolvedValue(saldo);
    });

    it('liquida los minutos exactos de ?minutos=', async () => {
        const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: '7' }, query: { minutos: '75' } });

        await liquidarHorasController(req, res, next);

        expect(service.liquidarHorasFrancoService).toHaveBeenCalledWith(7, 75);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(saldo);
    });

    it('acepta ?horas= (versiones anteriores de la app) y lo convierte a minutos', async () => {
        const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: '7' }, query: { horas: '1.25' } });

        await liquidarHorasController(req, res, next);

        expect(service.liquidarHorasFrancoService).toHaveBeenCalledWith(7, 75);
    });

    it('responde 400 si los minutos no son un entero positivo', async () => {
        const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: '7' }, query: { minutos: '7.5' } });

        await liquidarHorasController(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        expect(service.liquidarHorasFrancoService).not.toHaveBeenCalled();
    });
});

describe('getSaldosVacacionesController', () => {
    beforeEach(() => jest.clearAllMocks());

    it('pasa viewerContextId al servicio y responde 200', async () => {
        const lista = [{ userContextId: 7, nombre: 'Ana', apellido: 'Gómez', rolNombre: 'empleado-super', diasOtorgados: 14, diasConsumidos: 3.5, diasDisponibles: 10.5 }];
        service.getSaldosVacacionesService.mockResolvedValue(lista);
        const { req, res, next } = createMockReqRes({ user: { userContextId: 99 } });

        await getSaldosVacacionesController(req, res, next);

        expect(service.getSaldosVacacionesService).toHaveBeenCalledWith({ viewerContextId: 99 });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(lista);
    });
});
