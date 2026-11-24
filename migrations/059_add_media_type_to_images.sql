BEGIN;

ALTER TABLE images ADD COLUMN media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video'));

COMMIT;
