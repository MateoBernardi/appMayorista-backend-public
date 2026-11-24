ALTER TABLE archivos
ADD COLUMN IF NOT EXISTS id_carpeta INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_archivos_carpeta'
      AND table_name = 'archivos'
  ) THEN
    ALTER TABLE archivos
    ADD CONSTRAINT fk_archivos_carpeta
      FOREIGN KEY (id_carpeta)
      REFERENCES carpetas(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_archivos_id_carpeta
  ON archivos(id_carpeta)
  WHERE deleted_at IS NULL;
