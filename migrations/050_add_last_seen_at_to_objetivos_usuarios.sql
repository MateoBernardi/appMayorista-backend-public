-- Seguimiento de lectura por (objetivo, usuario), reutilizando objetivos_usuarios
-- en vez de crear una tabla nueva: ya es una fila por (objetivo_id, user_context_id).
-- Backfill a now() para que las tarjetas existentes no aparezcan todas como
-- "nuevas" para todo el mundo al desplegar esto; solo lo nuevo desde ahora
-- arranca sin ver.
BEGIN;

ALTER TABLE objetivos_usuarios
    ADD COLUMN IF NOT EXISTS last_seen_at timestamp without time zone NULL;

UPDATE objetivos_usuarios
SET last_seen_at = now()
WHERE last_seen_at IS NULL;

COMMIT;
