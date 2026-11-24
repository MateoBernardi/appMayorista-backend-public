-- Migración: Agregar campo "uso" a la tabla archivos
-- Fecha: 2026-02-25
-- Descripción: Permite clasificar archivos por su contexto de uso (EMPRESA, LICENCIA, MAYORISTA, WEB)

-- 1. Crear el tipo ENUM
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'archivo_uso_enum') THEN
        CREATE TYPE archivo_uso_enum AS ENUM ('EMPRESA', 'LICENCIA', 'MAYORISTA', 'WEB');
    END IF;
END$$;

-- 2. Agregar la columna con default EMPRESA (retrocompatible con registros existentes)
ALTER TABLE archivos
ADD COLUMN IF NOT EXISTS uso archivo_uso_enum NOT NULL DEFAULT 'EMPRESA';

-- 3. Índice para optimizar los filtros por uso
CREATE INDEX IF NOT EXISTS idx_archivos_uso ON archivos (uso);
