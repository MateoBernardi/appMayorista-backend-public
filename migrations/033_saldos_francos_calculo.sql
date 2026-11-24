-- Control de idempotencia para el cron semanal de saldos de francos.
-- Cada semana procesada se reserva por su lunes de inicio; el cron no vuelve a
-- sumar francos sobre una semana ya registrada (re-corrida, reinicio, ejecución manual).
CREATE TABLE IF NOT EXISTS saldos_francos_calculo (
    semana_inicio DATE PRIMARY KEY,
    procesado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
