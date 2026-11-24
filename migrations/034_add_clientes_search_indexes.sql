CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_clientes_descripcion_trgm ON clientes USING gin (descripcion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_descripcion_fts ON clientes USING gin (to_tsvector('spanish', descripcion));

CREATE INDEX IF NOT EXISTS idx_clientes_direccion_trgm ON clientes USING gin (direccion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_direccion_fts ON clientes USING gin (to_tsvector('spanish', direccion));

CREATE INDEX IF NOT EXISTS idx_localidades_nombre_trgm ON localidades USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_localidades_nombre_fts ON localidades USING gin (to_tsvector('spanish', nombre));
