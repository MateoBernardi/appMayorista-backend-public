/**
 * Tests de reglas de jornada (jornada.ts): port de jornada_corrido_minutos y planificacion_fin_turno.
 * Capa: Domain
 * Plataforma: Interno
 */
import { jornadaMinutos, finTurno, OBJETIVO_JORNADA_COMPLETA_MINUTOS } from '../../domain/services/jornada';

describe('jornadaMinutos', () => {
  it('sin objetivo → 480', () => {
    expect(jornadaMinutos(null)).toBe(480);
    expect(jornadaMinutos(undefined)).toBe(480);
  });
  it('umbral 2400', () => {
    expect(OBJETIVO_JORNADA_COMPLETA_MINUTOS).toBe(2400);
    expect(jornadaMinutos(2399)).toBe(240);
    expect(jornadaMinutos(2400)).toBe(480);
    expect(jornadaMinutos(2880)).toBe(480);
    expect(jornadaMinutos(0)).toBe(240);
  });
});

describe('finTurno', () => {
  it('usa esperado_out si existe', () => {
    expect(finTurno('2025-03-10 08:00:00', '2025-03-10 12:00:00', 2400)).toBe('2025-03-10 12:00:00');
  });
  it('horario corrido (out null): suma la jornada', () => {
    expect(finTurno('2025-03-10 08:00:00', null, 2400)).toBe('2025-03-10 16:00:00');
    expect(finTurno('2025-03-10 08:00:00', null, 1200)).toBe('2025-03-10 12:00:00');
    expect(finTurno('2025-03-10 08:00:00', undefined, null)).toBe('2025-03-10 16:00:00');
  });
  it('cruza de día/año', () => {
    expect(finTurno('2025-12-31 20:00:00', null, 2400)).toBe('2026-01-01 04:00:00');
  });
});
