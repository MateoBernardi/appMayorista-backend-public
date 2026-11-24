/**
 * Tests de dominio: proyección semanal de horas (clasificarTurno + getHorasSemanaProyeccionService).
 * Capa: Domain Service
 */

jest.mock('../../adapters/db/horariosRepo');
jest.mock('../../adapters/db/licenciasRepo');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../domain/services/reportesServices');
jest.mock('../../domain/services/solicitudesServices');

import { clasificarTurno, getHorasSemanaProyeccionService } from '../../domain/services/horariosServices';
import * as horariosRepo from '../../adapters/db/horariosRepo';
import * as licenciasRepo from '../../adapters/db/licenciasRepo';
import { ProyeccionTurnoRow } from '../../adapters/db/horariosRepo';

const mockRepo = jest.mocked(horariosRepo);
const mockLicenciasRepo = jest.mocked(licenciasRepo);

const h = (dia: number, hora: number, min = 0) => new Date(2026, 9, dia, hora, min);
// "Ahora": martes 20/10 a las 10:00
const AHORA = h(20, 10);

const turno = (overrides: Partial<ProyeccionTurnoRow> = {}): ProyeccionTurnoRow => ({
  id: 1,
  userContextId: 7,
  fecha: '2026-10-20',
  turno: 'Mañana',
  esperadoIn: h(20, 8),
  fin: h(20, 12),
  licencia: false,
  feriado: false,
  marcadoInAt: null,
  marcadoOutAt: null,
  minutosEsperados: 240,
  minutosRealizados: 0,
  minutosPostSabadoEsperados: 0,
  minutosPostSabadoRealizados: 0,
  ...overrides,
});

describe('clasificarTurno', () => {
  it('turno con licencia entera: 0', () => {
    expect(clasificarTurno(turno({ licencia: true, esperadoIn: h(21, 8), fin: h(21, 12) }), AHORA))
      .toEqual({ estado: 'licencia', minutos: 0 });
  });

  it('turno que todavía no empezó: el esperado', () => {
    expect(clasificarTurno(turno({ esperadoIn: h(21, 8), fin: h(21, 12), minutosEsperados: 195 }), AHORA))
      .toEqual({ estado: 'proyectado', minutos: 195 });
  });

  it('en el medio del turno con entrada marcada: el esperado completo, no lo realizado hasta ahora', () => {
    expect(clasificarTurno(turno({ marcadoInAt: h(20, 8, 5), minutosRealizados: 115 }), AHORA))
      .toEqual({ estado: 'en_curso', minutos: 240 });
  });

  it('en el medio del turno sin entrada marcada todavía: el esperado completo', () => {
    expect(clasificarTurno(turno(), AHORA)).toEqual({ estado: 'en_curso', minutos: 240 });
  });

  it('turno terminado sin entrada marcada: ausente, 0', () => {
    expect(clasificarTurno(turno({ esperadoIn: h(19, 8), fin: h(19, 12) }), AHORA))
      .toEqual({ estado: 'ausente', minutos: 0 });
  });

  it('turno terminado con entrada y sin salida: lo realizado según marcas', () => {
    expect(clasificarTurno(turno({ esperadoIn: h(19, 8), fin: h(19, 12), marcadoInAt: h(19, 8, 20), minutosRealizados: 220 }), AHORA))
      .toEqual({ estado: 'realizado', minutos: 220 });
  });

  it('salida marcada (aunque sea antes del fin): lo realizado, incluida la salida tardía', () => {
    expect(clasificarTurno(turno({ marcadoInAt: h(20, 8), marcadoOutAt: h(20, 9, 30), minutosRealizados: 90 }), AHORA))
      .toEqual({ estado: 'realizado', minutos: 90 });
    expect(clasificarTurno(turno({ esperadoIn: h(19, 8), fin: h(19, 12), marcadoInAt: h(19, 8), marcadoOutAt: h(19, 13), minutosRealizados: 300 }), AHORA))
      .toEqual({ estado: 'realizado', minutos: 300 });
  });

  it('acepta los timestamp como los devuelve pg (string sin zona, hora argentina)', () => {
    expect(clasificarTurno(turno({ esperadoIn: '2026-10-20 10:30:00', fin: '2026-10-20 12:00:00', minutosEsperados: 90 }), AHORA))
      .toEqual({ estado: 'proyectado', minutos: 90 });
    expect(clasificarTurno(turno({ esperadoIn: '2026-10-20 08:00:00', fin: '2026-10-20 09:59:00' }), AHORA))
      .toEqual({ estado: 'ausente', minutos: 0 });
  });

  it('horario corrido: usa el fin calculado (inicio + jornada) que trae el repo', () => {
    expect(clasificarTurno(turno({ esperadoIn: h(20, 6), fin: h(20, 14), minutosEsperados: 480 }), AHORA))
      .toEqual({ estado: 'en_curso', minutos: 480 });
  });
});

describe('getHorasSemanaProyeccionService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('suma lo realizado y la proyección por empleado, descuenta las licencias del objetivo y trae el saldo de francos', async () => {
    mockLicenciasRepo.getIdRolByUserContextId.mockResolvedValue(4);
    mockRepo.getTurnosSemanaProyeccion.mockResolvedValue({
      ahora: AHORA,
      usuarios: [
        { userContextId: 7, nombre: 'Mateo', apellido: 'Bernardi', minutosObjetivo: 2880, minutosObjetivoPendiente: null, minutosLicencia: 60, minutosSaldoFrancos: 570 },
        { userContextId: 8, nombre: 'Cristian', apellido: 'Jose', minutosObjetivo: 1440, minutosObjetivoPendiente: 1800, minutosLicencia: 0, minutosSaldoFrancos: 0 },
      ],
      turnos: [
        // lunes: realizado con salida tardía
        turno({ id: 1, fecha: '2026-10-19', esperadoIn: h(19, 8), fin: h(19, 12), marcadoInAt: h(19, 8), marcadoOutAt: h(19, 12, 30), minutosRealizados: 270 }),
        // martes: en curso
        turno({ id: 2, marcadoInAt: h(20, 8), minutosRealizados: 120 }),
        // miércoles: futuro con licencia en el medio (esperado ya descontado)
        turno({ id: 3, fecha: '2026-10-21', esperadoIn: h(21, 8), fin: h(21, 12), minutosEsperados: 180 }),
      ],
    });

    const [mateo, cristian] = await getHorasSemanaProyeccionService({ fechaInicio: '2026-10-19', fechaFin: '2026-10-25', viewerContextId: 99 });

    expect(mockRepo.getTurnosSemanaProyeccion).toHaveBeenCalledWith({ fechaInicio: '2026-10-19', fechaFin: '2026-10-25', idRolViewer: 4 });
    expect(mateo).toEqual({
      userContextId: 7,
      nombre: 'Mateo',
      apellido: 'Bernardi',
      minutosObjetivo: 2820,
      minutosObjetivoPendiente: null,
      minutosRealizados: 270,
      minutosProyectados: 270 + 240 + 180,
      minutosSaldoFrancos: 570,
      minutosFeriado: 0,
      turnos: [
        { fecha: '2026-10-19', turno: 'Mañana', estado: 'realizado', minutos: 270, feriado: false },
        { fecha: '2026-10-20', turno: 'Mañana', estado: 'en_curso', minutos: 240, feriado: false },
        { fecha: '2026-10-21', turno: 'Mañana', estado: 'proyectado', minutos: 180, feriado: false },
      ],
    });
    // Sin turnos en la semana: aparece igual, en 0
    expect(cristian).toMatchObject({ minutosRealizados: 0, minutosProyectados: 0, minutosObjetivoPendiente: 1800, turnos: [] });
  });

  it('suma en minutosFeriado lo de los turnos en feriado y deja afuera lo trabajado desde el sábado 13 hs', async () => {
    mockLicenciasRepo.getIdRolByUserContextId.mockResolvedValue(4);
    mockRepo.getTurnosSemanaProyeccion.mockResolvedValue({
      ahora: AHORA,
      usuarios: [
        { userContextId: 7, nombre: 'Mateo', apellido: 'Bernardi', minutosObjetivo: 2880, minutosObjetivoPendiente: null, minutosLicencia: 0, minutosSaldoFrancos: 0 },
      ],
      turnos: [
        // martes en feriado, en curso
        turno({ id: 1, feriado: true }),
        // sábado 11–15 (futuro): 120 min caen después de las 13 hs
        turno({ id: 2, fecha: '2026-10-24', esperadoIn: h(24, 11), fin: h(24, 15), minutosEsperados: 240, minutosPostSabadoEsperados: 120 }),
        // sábado 14–18 (futuro): íntegro desde las 13 hs
        turno({ id: 3, fecha: '2026-10-24', turno: 'Tarde', esperadoIn: h(24, 14), fin: h(24, 18), minutosEsperados: 240, minutosPostSabadoEsperados: 240 }),
      ],
    });

    const [mateo] = await getHorasSemanaProyeccionService({ fechaInicio: '2026-10-19', fechaFin: '2026-10-25', viewerContextId: 99 });

    expect(mateo?.minutosFeriado).toBe(240);
    expect(mateo?.minutosProyectados).toBe(240 + 120 + 0);
    expect(mateo?.turnos.map(t => t.minutos)).toEqual([240, 120, 0]);
  });

  it('clasificarTurno descuenta los minutos post sábado de lo realizado', () => {
    expect(clasificarTurno(turno({
      esperadoIn: h(24, 11), fin: h(24, 15), marcadoInAt: h(24, 11), marcadoOutAt: h(24, 15),
      minutosRealizados: 240, minutosPostSabadoRealizados: 120,
    }), AHORA)).toEqual({ estado: 'realizado', minutos: 120 });
  });
});
