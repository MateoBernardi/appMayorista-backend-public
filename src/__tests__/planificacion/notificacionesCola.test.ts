/**
 * Tests de domain: notificacionesColaService — despacho de la cola de notificaciones.
 * Capa: Domain
 */

jest.mock('../../adapters/db/notificacionesPendientesRepo');
jest.mock('../../domain/services/devicesService');

import * as repo from '../../adapters/db/notificacionesPendientesRepo';
import { sendNotificationToMultipleUsers } from '../../domain/services/devicesService';
import { procesarColaNotificaciones } from '../../domain/services/notificacionesColaService';

const colaRepo = jest.mocked(repo);
const enviar = jest.mocked(sendNotificationToMultipleUsers);

const payload = { title: 'Horarios actualizados', body: 'Tu planificación fue actualizada.', data: { type: 'turnos_actualizados_masivo' } };
const fila = (id: number, userContextId: number, p = payload) => ({ id, userContextId, tipo: 't', payload: p, intentos: 1 });

beforeEach(() => jest.resetAllMocks());

describe('procesarColaNotificaciones', () => {
  it('no hace nada si no hay notificaciones pendientes', async () => {
    colaRepo.reclamarNotificaciones.mockResolvedValue([]);

    expect(await procesarColaNotificaciones()).toEqual({ enviadas: 0, fallidas: 0 });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('agrupa por payload: una sola llamada de envío para todos los usuarios', async () => {
    colaRepo.reclamarNotificaciones.mockResolvedValue([fila(1, 10), fila(2, 11)]);
    enviar.mockResolvedValue({
      success: true, totalSent: 2,
      results: new Map([[10, { sentCount: 1, errors: [] }], [11, { sentCount: 1, errors: [] }]]),
    });

    const result = await procesarColaNotificaciones();

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith([10, 11], expect.objectContaining({ title: 'Horarios actualizados' }));
    expect(colaRepo.marcarNotificacionesEnviadas).toHaveBeenCalledWith([1, 2]);
    expect(result).toEqual({ enviadas: 2, fallidas: 0 });
  });

  it('un usuario sin dispositivos cuenta como enviado (no hay nada que reintentar)', async () => {
    colaRepo.reclamarNotificaciones.mockResolvedValue([fila(1, 10)]);
    enviar.mockResolvedValue({ success: true, totalSent: 0, results: new Map([[10, { sentCount: 0, errors: [] }]]) });

    const result = await procesarColaNotificaciones();

    expect(result).toEqual({ enviadas: 1, fallidas: 0 });
    expect(colaRepo.marcarNotificacionesFallidas).toHaveBeenCalledWith([], expect.any(String));
  });

  it('marca para reintento a quien tuvo errores sin ningún envío exitoso, y como enviado al resto', async () => {
    colaRepo.reclamarNotificaciones.mockResolvedValue([fila(1, 10), fila(2, 11)]);
    enviar.mockResolvedValue({
      success: false, totalSent: 1,
      results: new Map([[10, { sentCount: 0, errors: ['DeviceNotRegistered'] }], [11, { sentCount: 1, errors: [] }]]),
    });

    const result = await procesarColaNotificaciones();

    expect(colaRepo.marcarNotificacionesEnviadas).toHaveBeenCalledWith([2]);
    expect(colaRepo.marcarNotificacionesFallidas).toHaveBeenCalledWith([1], 'DeviceNotRegistered');
    expect(result).toEqual({ enviadas: 1, fallidas: 1 });
  });

  it('si el envío entero falla, reintenta todo el grupo', async () => {
    colaRepo.reclamarNotificaciones.mockResolvedValue([fila(1, 10), fila(2, 11)]);
    enviar.mockRejectedValue(new Error('timeout'));

    const result = await procesarColaNotificaciones();

    expect(colaRepo.marcarNotificacionesFallidas).toHaveBeenCalledWith([1, 2], 'timeout');
    expect(result).toEqual({ enviadas: 0, fallidas: 2 });
  });

  it('envía un grupo por cada payload distinto', async () => {
    colaRepo.reclamarNotificaciones.mockResolvedValue([fila(1, 10), fila(2, 11, { ...payload, body: 'otro' })]);
    enviar.mockImplementation(async (ids) => ({
      success: true, totalSent: 1, results: new Map(ids.map(id => [id, { sentCount: 1, errors: [] }])),
    }));

    await procesarColaNotificaciones();

    expect(enviar).toHaveBeenCalledTimes(2);
  });
});
