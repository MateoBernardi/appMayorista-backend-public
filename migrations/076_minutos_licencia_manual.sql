-- Licencia marcada a mano en un turno: debe descontar del objetivo semanal como las demás.
-- La proyección y el resumen semanal suman minutos_licencia, y el toggle manual nunca lo escribía.
-- planificacion_minutos_turno es la duración que descuenta un turno entero con licencia: esperado_out
-- - esperado_in, o la jornada fija si no tiene salida prevista (horario corrido). La usan
-- upsertHorarios y updateShiftsManually (horariosRepo) al guardar. Los turnos con licencia manual
-- anteriores a este cambio no se corrigen acá: se actualizan a mano.
BEGIN;

CREATE OR REPLACE FUNCTION planificacion_minutos_turno(p_user_context_id integer, p_in timestamp, p_out timestamp)
RETURNS integer
LANGUAGE sql STABLE
AS $$
    SELECT CASE
        WHEN p_out IS NULL THEN jornada_corrido_minutos(
            (SELECT uho.minutos_objetivo FROM usuarios_horas_objetivo uho WHERE uho.user_context_id = p_user_context_id))
        ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM (p_out - p_in)) / 60.0)::int)
    END
$$;

COMMIT;
