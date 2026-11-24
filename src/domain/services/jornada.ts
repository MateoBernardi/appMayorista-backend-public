import { sumarMinutos, TimestampLocal } from './fechaLocal';

/**
 * Reglas de jornada. Los objetivos semanales se expresan en minutos.
 *
 * Las funciones SQL `jornada_corrido_minutos` (migración 078) y `planificacion_fin_turno` (migración 074)
 * siguen existiendo solo para las queries de agregación (horas trabajadas, sin-marcar) y deben
 * mantenerse en sincronía con este archivo: si cambia una regla acá, cambiarla también en SQL.
 */

/** Objetivo semanal desde el cual la jornada es completa (40 h). Menos que esto es media jornada. */
export const OBJETIVO_JORNADA_COMPLETA_MINUTOS = 40 * 60;
export const JORNADA_COMPLETA_MINUTOS = 8 * 60;
export const JORNADA_MEDIA_MINUTOS = 4 * 60;

/** Port de jornada_corrido_minutos: objetivo no nulo y < 2400 → 240, si no 480 (sin objetivo, completa). */
export const jornadaMinutos = (minutosObjetivo: number | null | undefined): number =>
    minutosObjetivo != null && minutosObjetivo < OBJETIVO_JORNADA_COMPLETA_MINUTOS
        ? JORNADA_MEDIA_MINUTOS
        : JORNADA_COMPLETA_MINUTOS;

/** Port de planificacion_fin_turno: COALESCE(esperado_out, esperado_in + jornada) (horario corrido si out es null). */
export const finTurno = (
    esperadoIn: TimestampLocal,
    esperadoOut: TimestampLocal | null | undefined,
    minutosObjetivo: number | null | undefined,
): TimestampLocal => esperadoOut ?? sumarMinutos(esperadoIn, jornadaMinutos(minutosObjetivo));
