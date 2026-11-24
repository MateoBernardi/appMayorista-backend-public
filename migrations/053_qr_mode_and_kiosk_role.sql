-- Migracion: QR rotativo por sede + rol kiosco
-- Fecha: 2026-09-04
-- Descripcion: Agrega qr_mode/qr_secret a sedes (QR estatico o rotativo tipo TOTP-like,
-- ver src/utils/qrToken.ts) y el rol 'kiosco' usado por el endpoint de secreto del kiosco
-- (GET /horarios/kiosk-secret). Portado desde la rama feature/shifts-marking (no mergeada),
-- adaptado al esquema actual de esta rama.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE sedes ADD COLUMN IF NOT EXISTS qr_mode VARCHAR(10) NOT NULL DEFAULT 'STATIC';
ALTER TABLE sedes ADD COLUMN IF NOT EXISTS qr_secret VARCHAR(255);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sedes_qr_mode_check'
    ) THEN
        ALTER TABLE sedes ADD CONSTRAINT sedes_qr_mode_check CHECK (qr_mode IN ('ROTATING', 'STATIC'));
    END IF;
END $$;

-- Backfill: cada sede existente recibe un qr_secret aleatorio (hex de 32 bytes) si todavia no tiene uno.
UPDATE sedes SET qr_secret = encode(gen_random_bytes(32), 'hex') WHERE qr_secret IS NULL;

-- Agregar rol 'kiosco' (no-op si ya existe, como en este dev DB)
INSERT INTO roles (nombre)
SELECT 'kiosco'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'kiosco'
);

COMMIT;
