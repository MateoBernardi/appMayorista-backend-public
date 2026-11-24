/**
 * Tests de controllers: planificacionControllers y createShiftController.
 * Capa: Controller
 * Plataforma: Interno
 */

jest.mock('../../domain/services/planificacionServices', () => ({
  previsualizarPlanificacionService: jest.fn(),
  confirmarPlanificacionService: jest.fn(),
  getInfoPlanificacionService: jest.fn(),
}));
jest.mock('../../domain/services/horariosServices');
jest.mock('../../domain/services/devicesService');
jest.mock('../../adapters/db/horariosRepo');

import * as planificacion from '../../domain/services/planificacionServices';
import * as horariosServices from '../../domain/services/horariosServices';
import { sendNotificationToUser } from '../../domain/services/devicesService';
import { createMockReqRes } from '../helpers/testHelpers';
import { confirmarPlanificacionController, getInfoPlanificacionController, previsualizarPlanificacionController } from '../../controllers/planificacionControllers';
import { createShiftController } from '../../controllers/horariosControllers';

const planService = jest.mocked(planificacion);
const horarios = jest.mocked(horariosServices);
const notify = jest.mocked(sendNotificationToUser);

beforeEach(() => {
  jest.clearAllMocks();
  notify.mockResolvedValue(undefined as any);
});

describe('previsualizarPlanificacionController', () => {
  it('devuelve el preview del usuario autenticado', async () => {
    planService.previsualizarPlanificacionService.mockResolvedValue({ ok: true, snapshotId: 4 } as any);
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 } });

    await previsualizarPlanificacionController(req, res, next);

    expect(planService.previsualizarPlanificacionService).toHaveBeenCalledWith(9);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, snapshotId: 4 });
  });

  it('propaga el error del servicio a next', async () => {
    planService.previsualizarPlanificacionService.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 422 }));
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 } });

    await previsualizarPlanificacionController(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('confirmarPlanificacionController', () => {
  it.each([undefined, 0, -1, 'abc', 1.5])('responde 400 si previewId es %p', async (previewId) => {
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 }, body: { previewId } });

    await confirmarPlanificacionController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(planService.confirmarPlanificacionService).not.toHaveBeenCalled();
  });

  it('confirma el preview y devuelve el resumen', async () => {
    planService.confirmarPlanificacionService.mockResolvedValue({
      ok: true, snapshotId: 4, altas: 2, modificaciones: 1, bajas: 0, omitidos: 5, usuariosAfectados: [1, 2],
    });
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 }, body: { previewId: '4' } });

    await confirmarPlanificacionController(req, res, next);

    expect(planService.confirmarPlanificacionService).toHaveBeenCalledWith(4, 9);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 4, altas: 2, omitidos: 5 }));
  });
});

describe('createShiftController', () => {
  const body = {
    user_context_id: 5,
    horario_in: '2026-06-16T09:00',
    horario_out: '2026-06-16T17:00',
    sede_id_in: 2,
  };

  it('crea el turno Rotativo con sede de salida igual a la de entrada y notifica al usuario', async () => {
    horarios.crearTurnoService.mockResolvedValue(undefined);
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 }, body });

    await createShiftController(req, res, next);

    expect(horarios.crearTurnoService).toHaveBeenCalledWith(expect.objectContaining({
      userContextId: 5, turno: 'Rotativo', sede_id_in: 2, sede_id_out: 2, licencia: false,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(notify).toHaveBeenCalledWith(5, expect.objectContaining({ body: 'Se te asignó un turno el 16/06/2026.' }));
  });

  it('no se notifica a sí mismo', async () => {
    horarios.crearTurnoService.mockResolvedValue(undefined);
    const { req, res, next } = createMockReqRes({ user: { userContextId: 5 }, body });

    await createShiftController(req, res, next);

    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['usuario faltante', { user_context_id: undefined }],
    ['turno inválido', { turno: 'Siesta' }],
    ['horario_in con formato inválido', { horario_in: '16/06/2026 09:00' }],
    ['sede inválida', { sede_id_in: 'x' }],
  ])('responde 400 por %s', async (_caso, cambio) => {
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 }, body: { ...body, ...cambio } });

    await createShiftController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(horarios.crearTurnoService).not.toHaveBeenCalled();
  });
});

describe('getInfoPlanificacionController', () => {
  it('devuelve la info de publicación', async () => {
    planService.getInfoPlanificacionService.mockResolvedValue({ planillaUrl: 'https://x', ultimaPublicacion: null });
    const { req, res, next } = createMockReqRes({ user: { userContextId: 9 } });

    await getInfoPlanificacionController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ planillaUrl: 'https://x', ultimaPublicacion: null });
  });

  it('responde 401 vía next si no hay usuario autenticado', async () => {
    const { req, res, next } = createMockReqRes({});

    await getInfoPlanificacionController(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(planService.getInfoPlanificacionService).not.toHaveBeenCalled();
  });
});
