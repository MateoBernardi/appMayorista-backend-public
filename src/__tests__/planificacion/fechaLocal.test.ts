/**
 * Tests de helpers de fecha local naive (fechaLocal).
 * Capa: Domain
 * Plataforma: Interno
 */
import {
  aMinutos, desdeMinutos, sumarMinutos, diffMinutos, redondearPg, fechaDe, sumarDias, isoDow,
  combinar, horaMinuto, compararTs, minTs, maxTs, rangoFechas,
} from '../../domain/services/fechaLocal';

describe('fechaLocal', () => {
  it('aMinutos/desdeMinutos son inversas y aceptan T y fracciones', () => {
    const m = aMinutos('2025-03-10 08:30:00');
    expect(desdeMinutos(m)).toBe('2025-03-10 08:30:00');
    expect(aMinutos('2025-03-10T08:30')).toBe(m);
    expect(aMinutos('2025-03-10T08:30:00.123456')).toBe(m);
  });

  it('rechaza fechas inexistentes', () => {
    expect(() => aMinutos('2025-02-30 10:00:00')).toThrow();
    expect(() => aMinutos('basura')).toThrow();
  });

  it('sumarMinutos cruza día, mes y año', () => {
    expect(sumarMinutos('2025-12-31 23:30:00', 45)).toBe('2026-01-01 00:15:00');
    expect(sumarMinutos('2025-03-01 00:10:00', -20)).toBe('2025-02-28 23:50:00');
  });

  it('bisiesto', () => {
    expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(sumarDias('2024-02-28', 2)).toBe('2024-03-01');
    expect(sumarDias('2025-02-28', 1)).toBe('2025-03-01');
    expect(sumarDias('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('diffMinutos exacto con segundos', () => {
    expect(diffMinutos('2025-03-10 09:00:00', '2025-03-10 08:00:00')).toBe(60);
    expect(diffMinutos('2025-03-10 08:00:30', '2025-03-10 08:00:00')).toBe(0.5);
    expect(diffMinutos('2025-03-10 08:00:00', '2025-03-10 09:00:00')).toBe(-60);
  });

  it('redondearPg es half away from zero', () => {
    expect(redondearPg(2.5)).toBe(3);
    expect(redondearPg(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
    expect(redondearPg(-2.4)).toBe(-2);
    expect(redondearPg(0.5)).toBe(1);
    expect(redondearPg(-0.5)).toBe(-1);
  });

  it('fechaDe', () => {
    expect(fechaDe('2025-03-10 23:59:59')).toBe('2025-03-10');
    expect(fechaDe('2025-03-10')).toBe('2025-03-10');
  });

  it('isoDow: lunes=1, sábado=6, domingo=7', () => {
    expect(isoDow('2025-03-10')).toBe(1);
    expect(isoDow('2025-03-15')).toBe(6);
    expect(isoDow('2025-03-16')).toBe(7);
    expect(isoDow('2025-03-16 12:00:00')).toBe(7);
  });

  it('combinar fecha + hora', () => {
    expect(combinar('2025-03-10', '08:30')).toBe('2025-03-10 08:30:00');
    expect(combinar('2025-03-10', '08:30:15')).toBe('2025-03-10 08:30:15');
    expect(() => combinar('2025-03-10', 'x')).toThrow();
  });

  it('horaMinuto', () => {
    expect(horaMinuto('2025-03-10 08:05:59')).toBe('08:05');
    expect(horaMinuto('2025-03-10 00:00:00')).toBe('00:00');
  });

  it('compararTs/minTs/maxTs', () => {
    const a = '2025-03-10 08:00:00';
    const b = '2025-03-10T09:00';
    expect(compararTs(a, b)).toBeLessThan(0);
    expect(compararTs(b, a)).toBeGreaterThan(0);
    expect(compararTs(a, '2025-03-10 08:00')).toBe(0);
    expect(minTs(a, b)).toBe(a);
    expect(maxTs(a, b)).toBe(b);
  });

  it('rangoFechas inclusive, cruza mes/año', () => {
    expect(rangoFechas('2025-12-30', '2026-01-02')).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(rangoFechas('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(rangoFechas('2025-03-10', '2025-03-10')).toEqual(['2025-03-10']);
    expect(rangoFechas('2025-03-11', '2025-03-10')).toEqual([]);
  });
});
