-- Migracion: default para sedes.qr_secret
-- Fecha: 2026-09-04
-- Descripcion: cualquier sede nueva (insertada por la app o a mano) recibe automaticamente
-- un qr_secret aleatorio, en vez de depender de que quien la crea recuerde setearlo.
-- Backfill defensivo por si quedara alguna sede existente sin secreto.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE sedes ALTER COLUMN qr_secret SET DEFAULT encode(gen_random_bytes(32), 'hex');

UPDATE sedes SET qr_secret = encode(gen_random_bytes(32), 'hex') WHERE qr_secret IS NULL;

COMMIT;
