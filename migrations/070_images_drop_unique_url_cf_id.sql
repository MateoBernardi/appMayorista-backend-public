BEGIN;

-- Publicar borradores de slots inserta una copia de la imagen fuente en la sección destino
-- (mismo url / cf_image_id), así que estos valores ya no pueden ser únicos.
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_cf_image_id_key;
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_url_key;

CREATE INDEX IF NOT EXISTS images_cf_image_id_idx ON images (cf_image_id);
CREATE INDEX IF NOT EXISTS images_url_idx ON images (url);

COMMIT;
