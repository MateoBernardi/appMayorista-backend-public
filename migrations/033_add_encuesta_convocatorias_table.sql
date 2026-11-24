CREATE TABLE IF NOT EXISTS encuesta_convocatorias (
    encuesta_id INTEGER NOT NULL REFERENCES encuestas(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuario_entidad(id) ON DELETE CASCADE,
    solicitud_id INTEGER,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (encuesta_id, usuario_id)
);
