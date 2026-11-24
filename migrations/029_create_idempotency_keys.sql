-- Migración: Tabla de claves de idempotencia
-- Fecha: 2026-06-05
-- Descripción: Almacena claves de idempotencia para deduplicar requests de mutación (POST/PUT).
--              La clave se scopea por usuario autenticado (owner_key): la PRIMARY KEY compuesta
--              (owner_key, idempotency_key) evita que la clave de un usuario reproduzca o bloquee
--              la respuesta de otro, y a la vez provee el índice único usado para el lock atómico
--              (INSERT ... ON CONFLICT).

CREATE TABLE IF NOT EXISTS idempotency_keys (
  owner_key       VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  response_code   INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_key, idempotency_key)
);

-- Índice sobre created_at para habilitar una limpieza por TTL (cron) de claves antiguas.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
