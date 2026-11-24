ALTER TABLE objetivos
ADD CONSTRAINT uq_objetivos_solicitud_id
UNIQUE (solicitud_id);

ALTER TABLE solicitudes_invitados ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_solicitud_invitados_deleted_at ON solicitudes_invitados (deleted_at);

ALTER TABLE solicitudes
ALTER COLUMN titulo DROP NOT NULL;

ALTER TABLE solicitudes
ALTER COLUMN descripcion SET NOT NULL;