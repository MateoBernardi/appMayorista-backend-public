CREATE TABLE IF NOT EXISTS encuestas_usuarios_visibilidad (
    encuesta_id INTEGER NOT NULL REFERENCES encuestas(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuario_entidad(id) ON DELETE CASCADE,
    UNIQUE (encuesta_id, usuario_id)
);