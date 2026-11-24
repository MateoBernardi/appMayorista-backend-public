-- Índices para la búsqueda de entradas de bitácora por observacion.
-- El GIN de tsvector cubre plainto_tsquery; el GIN de trigramas cubre el ILIKE '%q%',
-- que sin trgm degrada la consulta a seq scan y anula la ganancia del tsvector.
-- El btree (solicitud_id, id DESC) cubre el timeline paginado y el salto por ancla.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_solicitudes_bitacora_observacion_fts
    ON solicitudes_bitacora USING gin (to_tsvector('spanish', observacion));

CREATE INDEX IF NOT EXISTS idx_solicitudes_bitacora_observacion_trgm
    ON solicitudes_bitacora USING gin (observacion gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_solicitudes_bitacora_solicitud_id_desc
    ON solicitudes_bitacora (solicitud_id, id DESC);

COMMIT;
