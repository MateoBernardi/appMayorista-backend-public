-- Décimas de día que se descontaron del saldo al aprobar la solicitud (incluye el fin de semana
-- que cobra la regla de residuo). Permite devolver exactamente lo descontado al cancelar.
-- NULL en las aprobadas antes de esta migración: el backend lo recalcula desde residuo_al_aprobar.
BEGIN;

ALTER TABLE solicitudes_ausencia ADD COLUMN dias_descontados integer;

COMMIT;
