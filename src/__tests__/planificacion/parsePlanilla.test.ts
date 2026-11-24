/**
 * Tests del parser de la planilla (src/domain/services/planillaParser.ts).
 * Capa: Dominio
 */

import { parsePlanilla, parseHora, parseObjetivo } from '../../domain/services/planillaParser';

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const encabezado = (): (string | number | null)[] => {
  const h: (string | null)[] = ['ID', 'Empleado', ...Array(36).fill(''), 'Objetivo semanal (hs)'];
  DIAS.forEach((d, i) => { h[2 + i * 6] = d; });
  return h;
};

// Fila de usuario: `dias` = { lunes: [in1, out1, sede1, in2, out2, sede2] }
const fila = (id: unknown, dias: Record<string, unknown[]> = {}, objetivo: unknown = null) => {
  const f: unknown[] = [id, 'Nombre', ...Array(36).fill(null), objetivo];
  DIAS.forEach((d, i) => (dias[d] ?? []).forEach((v, k) => { f[2 + i * 6 + k] = v; }));
  return f;
};

describe('parseHora', () => {
  it.each([
    [0.2916666666666667, '07:00'],
    [0.5, '12:00'],
    ['7:30', '07:30'],
    ['07:30:00', '07:30'],
    [16.5 / 24, '16:30'],
  ])('%p → %p', (entrada, esperado) => expect(parseHora(entrada)).toBe(esperado));

  it('vacío → null; inválido → undefined', () => {
    expect(parseHora('')).toBeNull();
    expect(parseHora(null)).toBeNull();
    expect(parseHora('25:00')).toBeUndefined();
    expect(parseHora('abc')).toBeUndefined();
    expect(parseHora(1.5)).toBeUndefined();
  });
});

describe('parseObjetivo', () => {
  it.each([[48, 48], ['52,5 hs semanales', 52.5], ['24 hs semanales', 24], ['48', 48]])('%p → %p', (e, r) =>
    expect(parseObjetivo(e)).toBe(r));

  it('vacío → null; inválido → undefined', () => {
    expect(parseObjetivo('')).toBeNull();
    expect(parseObjetivo('muchas')).toBeUndefined();
  });
});

describe('parsePlanilla', () => {
  it('arma turnos Mañana/Tarde con día ISO, sede por nombre y objetivo', () => {
    const { payload, errores } = parsePlanilla([
      encabezado(),
      fila(2, { lunes: [0.3, 0.5, 'Adm', 0.6666666667, 0.8333333333, 'Adm'], sabado: ['08:00', '12:00', 'Dep. Super'] }, '48 hs semanales'),
    ]);

    expect(errores).toEqual([]);
    expect(payload.turnos).toEqual([
      { user_context_id: 2, dia_semana: 1, turno: 'Mañana', hora_in: '07:12', hora_out: '12:00', sede_id: 2 },
      { user_context_id: 2, dia_semana: 1, turno: 'Tarde', hora_in: '16:00', hora_out: '20:00', sede_id: 2 },
      { user_context_id: 2, dia_semana: 6, turno: 'Mañana', hora_in: '08:00', hora_out: '12:00', sede_id: 5 },
    ]);
    expect(payload.objetivos).toEqual([{ user_context_id: 2, horas: 48 }]);
  });

  it('un usuario sin horarios (rotativo) no genera turnos pero conserva su objetivo; las filas sin ID se ignoran', () => {
    const { payload, errores } = parsePlanilla([encabezado(), fila('', {}), fila(53, {}, 40)]);

    expect(errores).toEqual([]);
    expect(payload.turnos).toEqual([]);
    expect(payload.objetivos).toEqual([{ user_context_id: 53, horas: 40 }]);
  });

  it('reporta con fila y columna: sede desconocida, hora inválida, salida faltante, ID inválido y repetido', () => {
    const { errores } = parsePlanilla([
      encabezado(),
      fila(2, { lunes: ['07:00', '12:00', 'Marte'], martes: ['7:00', '99:00', 'Super'], miercoles: ['07:00', null, 'Super'] }),
      fila('abc'),
      fila(2),
    ]);

    expect(errores).toEqual(expect.arrayContaining([
      expect.stringContaining('Fila 2, lunes (Mañana, columna C): sede desconocida "Marte"'),
      expect.stringContaining('Fila 2, martes (Mañana, columna I): horario inválido'),
      expect.stringContaining('Fila 2, miercoles (Mañana, columna O): falta la entrada o la salida'),
      expect.stringContaining('Fila 3: ID inválido "abc"'),
      expect.stringContaining('Fila 4: el usuario 2 está repetido'),
    ]));
  });

  it('exige las columnas del encabezado y que haya contenido', () => {
    expect(parsePlanilla([]).errores).toEqual(['La planilla está vacía.']);

    const sinId = encabezado();
    sinId[0] = 'Legajo';
    expect(parsePlanilla([sinId, fila(2)]).errores).toEqual(expect.arrayContaining([expect.stringContaining('columna "ID"')]));
  });
});
