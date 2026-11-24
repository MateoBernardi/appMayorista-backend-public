-- Planificación de horarios vía Google Sheet + n8n (ver docs/ADR-008).
-- Esquema: snapshot de la planilla (reemplaza a planificacion_base_semanal), objetivo
-- pendiente, flag horario_corrido y cola de notificaciones.
-- La lógica de negocio vive en las funciones de la migración 063.

-- Snapshot de la planilla. Un preview (estado PREVIEW) ya es el snapshot completo:
-- confirmar solo lo pasa a ACTIVO, sin volver a leer el Google Sheet.
CREATE TABLE IF NOT EXISTS planificacion_snapshot (
    id          BIGSERIAL PRIMARY KEY,
    creado_por  INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_at   TIMESTAMPTZ NULL,
    aplicado_at TIMESTAMPTZ NULL,
    hash        TEXT NOT NULL,
    estado      TEXT NOT NULL CHECK (estado IN ('PREVIEW', 'ACTIVO', 'REEMPLAZADO', 'EXPIRADO')),
    diff        JSONB NULL
);

-- A lo sumo un snapshot ACTIVO: es el que usa la generación semanal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_planificacion_snapshot_activo
    ON planificacion_snapshot ((true)) WHERE estado = 'ACTIVO';

CREATE TABLE IF NOT EXISTS planificacion_snapshot_turno (
    snapshot_id     BIGINT NOT NULL REFERENCES planificacion_snapshot (id) ON DELETE CASCADE,
    user_context_id INTEGER NOT NULL,
    dia_semana      SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 6), -- 1 = lunes … 6 = sábado (ISO)
    turno           turno_enum NOT NULL CHECK (turno IN ('Mañana', 'Tarde')),
    hora_in         TIME NOT NULL,
    hora_out        TIME NOT NULL,
    sede_id         INTEGER NOT NULL,
    PRIMARY KEY (snapshot_id, user_context_id, dia_semana, turno),
    CHECK (hora_out > hora_in)
);

-- Objetivo semanal por usuario según la planilla, en deciHoras (horas × 10).
CREATE TABLE IF NOT EXISTS planificacion_snapshot_objetivo (
    snapshot_id     BIGINT NOT NULL REFERENCES planificacion_snapshot (id) ON DELETE CASCADE,
    user_context_id INTEGER NOT NULL,
    horas_objetivo  INTEGER NOT NULL CHECK (horas_objetivo >= 0),
    PRIMARY KEY (snapshot_id, user_context_id)
);

-- Objetivo que entra en vigencia con la próxima generación semanal (domingo), para no
-- alterar el resumen de la semana en curso. NULL = no hay cambio pendiente.
ALTER TABLE usuarios_horas_objetivo
    ADD COLUMN IF NOT EXISTS horas_objetivo_pendiente INTEGER NULL CHECK (horas_objetivo_pendiente >= 0);

-- Horario corrido: un único turno por día; la salida se guía por el marcado real
-- (esperado_out queda NULL y no se verifica el horario de salida).
ALTER TABLE planificacion_diaria
    ADD COLUMN IF NOT EXISTS horario_corrido BOOLEAN NOT NULL DEFAULT false;

-- Cola de notificaciones push (outbox). Un worker las despacha con reintentos.
CREATE TABLE IF NOT EXISTS notificaciones_pendientes (
    id                 BIGSERIAL PRIMARY KEY,
    user_context_id    INTEGER NOT NULL,
    tipo               TEXT NOT NULL,
    payload            JSONB NOT NULL,
    estado             TEXT NOT NULL DEFAULT 'PENDIENTE'
                       CHECK (estado IN ('PENDIENTE', 'PROCESANDO', 'ENVIADA', 'FALLIDA')),
    intentos           INTEGER NOT NULL DEFAULT 0,
    proximo_intento_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dedupe_key         TEXT NULL,
    last_error         TEXT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at            TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_pendientes_dedupe
    ON notificaciones_pendientes (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notificaciones_pendientes_despacho
    ON notificaciones_pendientes (proximo_intento_at) WHERE estado = 'PENDIENTE';
