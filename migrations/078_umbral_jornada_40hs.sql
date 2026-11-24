-- Umbral único de jornada: un objetivo semanal de 40 h o más es jornada completa (8 h); menos de
-- 40 h (2400 min) es media jornada (4 h). Antes, jornada_corrido_minutos usaba <= 30 h para la
-- media jornada y el franco por días (licenciasServices) usaba < 48 h. Sin objetivo cargado, 8 h.
-- Solo afecta a lo que se calcule de acá en adelante: los minutos_licencia ya guardados no cambian.
BEGIN;

CREATE OR REPLACE FUNCTION jornada_corrido_minutos(p_minutos_objetivo integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE WHEN p_minutos_objetivo IS NOT NULL AND p_minutos_objetivo < 2400 THEN 240 ELSE 480 END
$$;

COMMIT;
