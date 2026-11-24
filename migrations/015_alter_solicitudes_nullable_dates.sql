-- Migración: Hacer fecha_inicio y fecha_fin nullable en solicitudes
-- Motivo: Las solicitudes de tipo MANDATO ya no requieren fechas obligatorias
-- Fecha: 2026-02-24

ALTER TABLE solicitudes
    ALTER COLUMN fecha_inicio DROP NOT NULL,
    ALTER COLUMN fecha_fin DROP NOT NULL;

-- Rollback:
-- ALTER TABLE solicitudes
--     ALTER COLUMN fecha_inicio SET NOT NULL,
--     ALTER COLUMN fecha_fin SET NOT NULL;
