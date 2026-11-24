-- Migración: Agregar columna notificacion_enviada a actividades
-- Permite trackear si ya se envió el recordatorio de 15 min antes

ALTER TABLE actividades
ADD COLUMN IF NOT EXISTS notificacion_enviada BOOLEAN DEFAULT FALSE;

-- Índice para optimizar el query del cron (actividades futuras no notificadas)
CREATE INDEX IF NOT EXISTS idx_actividades_notif_pendiente
ON actividades (fecha_inicio)
WHERE deleted_at IS NULL AND notificacion_enviada = FALSE;
