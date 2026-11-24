-- Marca si el turno cae en un feriado (aplica ×2 en el cálculo de horas). Reemplaza
-- la tabla feriados: el feriado ahora se carga por turno junto con licencia.
ALTER TABLE planificacion_diaria
    ADD COLUMN IF NOT EXISTS feriado BOOLEAN NOT NULL DEFAULT false;

UPDATE planificacion_diaria p
SET feriado = true
FROM feriados f
WHERE f.fecha = DATE(p.esperado_in)
  AND f.deleted_at IS NULL;

DROP TABLE IF EXISTS feriados;
