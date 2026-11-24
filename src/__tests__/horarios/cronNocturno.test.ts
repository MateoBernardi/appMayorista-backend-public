/**
 * Tests del cron nocturno de ausencias + horas trabajadas (initAusenciasSweepCron).
 * Capa: Cron
 */

jest.mock('node-cron');
jest.mock('../../domain/services/reportesServices');
jest.mock('../../domain/services/horariosServices');

import * as cron from 'node-cron';
import { ejecutarSweepAusencias } from '../../domain/services/reportesServices';
import { ejecutarSweepHorasTrabajadas } from '../../domain/services/horariosServices';
import { initAusenciasSweepCron } from '../../utils/cronJobs';

const mockCron = jest.mocked(cron);
const ausencias = jest.mocked(ejecutarSweepAusencias);
const horas = jest.mocked(ejecutarSweepHorasTrabajadas);

type CronTask = () => Promise<void>;

const tareaNocturna = (): CronTask => {
  initAusenciasSweepCron();
  const call = mockCron.schedule.mock.calls.find((c) => c[0] === '30 23 * * *');
  if (!call) throw new Error('el cron nocturno no se agendó');
  return call[1] as unknown as CronTask;
};

describe('initAusenciasSweepCron — barrido nocturno', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    ausencias.mockResolvedValue(0);
    horas.mockResolvedValue(0);
  });

  it('se agenda a las 23:30 en hora argentina', () => {
    initAusenciasSweepCron();

    expect(mockCron.schedule).toHaveBeenCalledWith('30 23 * * *', expect.any(Function), { timezone: 'America/Argentina/Buenos_Aires' });
  });

  it('ejecuta el barrido de ausencias y el cálculo de horas trabajadas', async () => {
    await tareaNocturna()();

    expect(ausencias).toHaveBeenCalledTimes(1);
    expect(horas).toHaveBeenCalledTimes(1);
  });

  it('loguea la cantidad de turnos con horas calculadas', async () => {
    horas.mockResolvedValue(9);

    await tareaNocturna()();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('9 turno(s) actualizado(s)'));
  });

  it('si falla el barrido de ausencias igual calcula las horas', async () => {
    ausencias.mockRejectedValue(new Error('falló ausencias'));

    await tareaNocturna()();

    expect(horas).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Error in ausencias sweep cron job:', expect.any(Error));
  });

  it('si falla el cálculo de horas no rompe el cron y queda registrado (las ausencias ya se reportaron)', async () => {
    horas.mockRejectedValue(new Error('falló horas'));

    await expect(tareaNocturna()()).resolves.toBeUndefined();

    expect(ausencias).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Error in horas trabajadas sweep cron job:', expect.any(Error));
  });
});
