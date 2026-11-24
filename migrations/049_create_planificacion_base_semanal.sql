BEGIN;

-- Turno base semanal por usuario: fuente de verdad que la generación automática
-- semanal copia a planificacion_diaria (lunes a sábado). Se reemplaza por completo
-- (TRUNCATE + INSERT) cada vez que se sube la plantilla base, no se upsertea parcial.
CREATE TABLE IF NOT EXISTS planificacion_base_semanal (
    user_context_id INTEGER NOT NULL,
    turno           TEXT NOT NULL,
    hora_in         TIME NOT NULL,
    hora_out        TIME NOT NULL,
    sede_id_in      INTEGER NOT NULL,
    sede_id_out     INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_context_id, turno)
);

COMMIT;
