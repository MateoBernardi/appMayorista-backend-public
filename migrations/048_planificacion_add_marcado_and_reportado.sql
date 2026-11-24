-- marcado_in_at/marcado_out_at ya existen en la base de dev (agregadas fuera de una
-- migración registrada); esto las documenta de forma idempotente para otros entornos.
-- reportado_tardanza evita que el barrido de tardanzas duplique reportes.
ALTER TABLE planificacion_diaria
    ADD COLUMN IF NOT EXISTS marcado_in_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS marcado_out_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS reportado_tardanza BOOLEAN NOT NULL DEFAULT false;
