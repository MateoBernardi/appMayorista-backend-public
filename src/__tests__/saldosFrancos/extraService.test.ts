/**
 * Tests de dominio: getExtraHorasService + liquidarHorasFrancoService (horariosServices).
 * Capa: Domain Service
 *
 * Interno se guarda en minutos; la API expone minutos y, por compatibilidad, horas con 2 decimales.
 */

jest.mock('../../adapters/db/saldosFrancosRepo');

import {
  getExtraHorasService,
  liquidarHorasFrancoService,
  getMovimientosService,
} from '../../domain/services/horariosServices';
import * as saldosRepo from '../../adapters/db/saldosFrancosRepo';
import { AppError, NotFoundError } from '../../adapters/errors/AppError';

const saldos = jest.mocked(saldosRepo);

beforeEach(() => jest.clearAllMocks());

describe('getExtraHorasService', () => {
  it('siempre usa el saldo actual (puede ser negativo) y expone minutos + horas', async () => {
    saldos.getExtraHorasSaldoActual.mockResolvedValue([
      { userContextId: 2, nombre: 'Beto', apellido: 'Gómez', minutos: -150 },
    ]);

    const result = await getExtraHorasService({ rolNombre: 'encargado' });

    expect(saldos.getExtraHorasSaldoActual).toHaveBeenCalledWith({
      userContextId: undefined,
      rolNombre: 'encargado',
    });
    expect(result).toEqual([{ userContextId: 2, nombre: 'Beto', apellido: 'Gómez', horas: -2.5, minutos: -150 }]);
  });
});

describe('liquidarHorasFrancoService', () => {
  it('liquida los minutos exactos y devuelve el saldo en minutos y horas', async () => {
    saldos.liquidarHorasFranco.mockResolvedValue({ minutos_disponibles: 600, minutos_consumidos: 75 });

    const result = await liquidarHorasFrancoService(7, 75);

    expect(saldos.liquidarHorasFranco).toHaveBeenCalledWith(7, 75);
    expect(result).toEqual({ horasDisponibles: 10, horasConsumidas: 1.25, minutosDisponibles: 600, minutosConsumidos: 75 });
  });

  it('minutos <= 0 o no enteros lanzan AppError(400) sin llamar al repo', async () => {
    await expect(liquidarHorasFrancoService(7, 0)).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 400,
    });
    await expect(liquidarHorasFrancoService(7, -3)).rejects.toBeInstanceOf(AppError);
    await expect(liquidarHorasFrancoService(7, 2.5)).rejects.toBeInstanceOf(AppError);
    expect(saldos.liquidarHorasFranco).not.toHaveBeenCalled();
  });

  it('propaga el AppError(404) del repo cuando no hay saldo', async () => {
    saldos.liquidarHorasFranco.mockRejectedValue(new NotFoundError('El usuario no tiene saldo de francos.'));

    await expect(liquidarHorasFrancoService(999, 60)).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 404,
    });
  });
});

describe('getMovimientosService', () => {
  it('parsea "YYYY-MM" a un rango half-open y expone minutos + horas', async () => {
    const createdAt = new Date('2026-06-15T10:00:00Z');
    saldos.getMovimientosByUsuario.mockResolvedValue([
      {
        id: 1,
        tipoMovimiento: 'consumo',
        minutos: 45,
        minutosDisponiblesResultante: 600,
        minutosConsumidosResultante: 240,
        createdAt,
      },
    ]);

    const result = await getMovimientosService({ userContextId: 7, mes: '2026-06' });

    expect(saldos.getMovimientosByUsuario).toHaveBeenCalledWith(
      7,
      new Date(2026, 5, 1),
      new Date(2026, 6, 1)
    );
    expect(result).toEqual([
      {
        id: 1,
        tipo: 'consumo',
        cantidad: 0.75, // 45 min
        saldoResultante: 6, // 600 - 240 = 360 min
        cantidadMinutos: 45,
        saldoResultanteMinutos: 360,
        createdAt: createdAt.toISOString(),
      },
    ]);
  });

  it('usa diciembre → enero del año siguiente como límite superior', async () => {
    saldos.getMovimientosByUsuario.mockResolvedValue([]);

    await getMovimientosService({ userContextId: 7, mes: '2026-12' });

    expect(saldos.getMovimientosByUsuario).toHaveBeenCalledWith(
      7,
      new Date(2026, 11, 1),
      new Date(2027, 0, 1)
    );
  });

  it('saldoResultante es null si falta algún snapshot', async () => {
    saldos.getMovimientosByUsuario.mockResolvedValue([
      {
        id: 2,
        tipoMovimiento: 'ajuste_manual',
        minutos: 30,
        minutosDisponiblesResultante: null,
        minutosConsumidosResultante: null,
        createdAt: new Date('2026-06-16T00:00:00Z'),
      },
    ]);

    const result = await getMovimientosService({ userContextId: 7, mes: '2026-06' });

    expect(result[0].saldoResultante).toBeNull();
    expect(result[0].saldoResultanteMinutos).toBeNull();
  });

  it('mes con formato inválido lanza AppError(400) sin llamar al repo', async () => {
    await expect(getMovimientosService({ userContextId: 7, mes: '2026-6' })).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 400,
    });
    await expect(getMovimientosService({ userContextId: 7, mes: '26-06' })).rejects.toBeInstanceOf(AppError);
    await expect(getMovimientosService({ userContextId: 7, mes: 'abcd-ef' })).rejects.toBeInstanceOf(AppError);
    expect(saldos.getMovimientosByUsuario).not.toHaveBeenCalled();
  });

  it('mes con mes fuera de rango (00 o 13) lanza AppError(400)', async () => {
    await expect(getMovimientosService({ userContextId: 7, mes: '2026-00' })).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 400,
    });
    await expect(getMovimientosService({ userContextId: 7, mes: '2026-13' })).rejects.toBeInstanceOf(AppError);
  });
});
