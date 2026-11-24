BEGIN;

-- Dimensiones originales (px) de las imágenes subidas a Cloudflare Images.
-- Nullable: los videos (media_type = 'video') y las imágenes aún no medidas quedan en NULL.
ALTER TABLE images
  ADD COLUMN IF NOT EXISTS width  integer,
  ADD COLUMN IF NOT EXISTS height integer;

COMMIT;
