-- Marca si la planificación corresponde a una licencia (ausencia justificada).
-- NOT NULL con default false para no romper filas existentes.
ALTER TABLE planificacion_diaria
    ADD COLUMN IF NOT EXISTS licencia BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS feriados (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL UNIQUE,
    descripcion TEXT,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feriados_fecha ON feriados (fecha) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_planificacion_diaria_user ON planificacion_diaria (user_context_id);

-- horas_trabajadas: duración del turno en deciHoras (horas × 10). Cache denormalizado;
-- la fuente de verdad del cron semanal de francos es el recálculo desde esperado_in/out.
ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS horas_trabajadas INTEGER NOT NULL DEFAULT 0;
