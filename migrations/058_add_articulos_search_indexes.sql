CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_articulos_descripcion_trgm ON articulos USING gin (descripcion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articulos_descripcion_fts ON articulos USING gin (to_tsvector('spanish', descripcion));

CREATE INDEX IF NOT EXISTS idx_articulos_rubro_activos ON articulos (rubro) WHERE deleted_at IS NULL;
