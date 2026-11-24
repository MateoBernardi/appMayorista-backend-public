-- Agrega soporte para el nuevo estado EXPIRADA en solicitudes_ausencia.
-- Este script cubre dos escenarios:
-- 1) La columna estado usa un tipo enum de PostgreSQL.
-- 2) La tabla usa CHECK constraints sobre estado.

-- 1) Si estado es enum, agregar valor EXPIRADA.
DO $$
DECLARE
    enum_type_name text;
BEGIN
    SELECT t.typname
      INTO enum_type_name
      FROM pg_type t
      JOIN pg_attribute a ON a.atttypid = t.oid
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'solicitudes_ausencia'
       AND a.attname = 'estado'
       AND t.typtype = 'e'
     LIMIT 1;

    IF enum_type_name IS NOT NULL THEN
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS ''CONSUMIDA''', enum_type_name);
    END IF;
END $$;

-- 2) Si hay checks sobre estado, recrearlos incluyendo EXPIRADA.
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
         WHERE conrelid = 'solicitudes_ausencia'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%estado%'
           AND pg_get_constraintdef(oid) ILIKE '%PENDIENTE%'
    LOOP
        EXECUTE format('ALTER TABLE solicitudes_ausencia DROP CONSTRAINT %I', rec.conname);
    END LOOP;
END $$;

ALTER TABLE solicitudes_ausencia
    ADD CONSTRAINT solicitudes_ausencia_estado_check
    CHECK (
        estado IN (
            'PENDIENTE',
            'PENDIENTE_DOCUMENTACION',
            'PENDIENTE_APROBACION',
            'APROBADA',
            'RECHAZADA',
            'CANCELADA',
            'EXPIRADA',
            'CONSUMIDA'
        )
    );
