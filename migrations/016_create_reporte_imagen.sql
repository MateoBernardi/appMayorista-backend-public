-- Migración: Crear tabla reporte_imagen (asociación many-to-many entre reportes e images)
-- Sigue el mismo patrón que articulo_imagen

CREATE TABLE IF NOT EXISTS reporte_imagen (
    id SERIAL PRIMARY KEY,
    reporte_id INTEGER NOT NULL REFERENCES reportes(id) ON DELETE CASCADE,
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    orden INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP DEFAULT NULL,
    UNIQUE (reporte_id, image_id, deleted_at)
);

CREATE INDEX IF NOT EXISTS idx_reporte_imagen_reporte_id ON reporte_imagen(reporte_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reporte_imagen_image_id ON reporte_imagen(image_id) WHERE deleted_at IS NULL;
