-- Reemplaza la columna `fecha` de planificacion_diaria: la fecha ahora se deriva
-- de `esperado_in` (ver migración 031, índice único sobre (user_context_id, turno,
-- DATE(esperado_in))). Al dropear `fecha` se eliminan automáticamente la constraint
-- unique_user_fecha_turno y el índice idx_planificacion_fecha_user que dependían de ella.
-- Agrega `relacion` y `fecha_nacimiento` a personal.
-- Idempotente: IF EXISTS / IF NOT EXISTS para tolerar re-corridas y reinicios.
ALTER TABLE planificacion_diaria DROP COLUMN IF EXISTS fecha;
ALTER TABLE personal ADD COLUMN IF NOT EXISTS relacion VARCHAR(50);
ALTER TABLE personal ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
