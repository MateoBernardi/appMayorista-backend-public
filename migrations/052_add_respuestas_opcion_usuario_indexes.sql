CREATE INDEX idx_respuestas_opcion_id ON respuestas (opcion_id);
CREATE INDEX idx_respuestas_usuario_id ON respuestas (usuario_id);
CREATE INDEX idx_encuestas_deleted_at_fecha_creacion ON encuestas (deleted_at, fecha_creacion DESC);
