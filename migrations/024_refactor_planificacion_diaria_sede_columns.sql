ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS sede_id_in INTEGER;
ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS sede_id_out INTEGER;
UPDATE planificacion_diaria SET sede_id_in = sede_id, sede_id_out = sede_id WHERE sede_id IS NOT NULL;
ALTER TABLE planificacion_diaria DROP COLUMN IF EXISTS sede_id;
