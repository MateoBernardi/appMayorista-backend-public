-- planificacion_diaria_id/device_id en scans ya existen en la base de dev (agregadas
-- fuera de una migración registrada); esto las documenta de forma idempotente para
-- otros entornos.
ALTER TABLE scans
    ADD COLUMN IF NOT EXISTS device_id INTEGER NULL,
    ADD COLUMN IF NOT EXISTS planificacion_diaria_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_device_id_fkey') THEN
        ALTER TABLE scans ADD CONSTRAINT scans_device_id_fkey FOREIGN KEY (device_id) REFERENCES scan_devices(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_planificacion_diaria_id_fkey') THEN
        ALTER TABLE scans ADD CONSTRAINT scans_planificacion_diaria_id_fkey FOREIGN KEY (planificacion_diaria_id) REFERENCES planificacion_diaria(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scans_device_planificacion ON scans (device_id, planificacion_diaria_id);
