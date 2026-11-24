-- saldos_francos almacena deciHoras (horas × 10). El ×10 existe precisamente para
-- que los saldos sean siempre enteros y no haya redondeo/fracciones. Todo el flujo
-- de cálculo, consumo y reintegro opera con enteros, pero las columnas eran
-- numeric(10,2), lo que contradecía ese contrato. Se pasan a INTEGER; como cada
-- valor almacenado ya es entero por construcción, el cast es lossless.
BEGIN;

-- Normalizar posibles NULL antes de imponer NOT NULL.
UPDATE saldos_francos SET horas_disponibles = 0 WHERE horas_disponibles IS NULL;
UPDATE saldos_francos SET horas_consumidas  = 0 WHERE horas_consumidas  IS NULL;

ALTER TABLE saldos_francos
  ALTER COLUMN horas_disponibles DROP DEFAULT,
  ALTER COLUMN horas_disponibles TYPE INTEGER USING horas_disponibles::integer,
  ALTER COLUMN horas_disponibles SET DEFAULT 0,
  ALTER COLUMN horas_disponibles SET NOT NULL,
  ALTER COLUMN horas_consumidas  DROP DEFAULT,
  ALTER COLUMN horas_consumidas  TYPE INTEGER USING horas_consumidas::integer,
  ALTER COLUMN horas_consumidas  SET DEFAULT 0,
  ALTER COLUMN horas_consumidas  SET NOT NULL;

COMMIT;
