-- Migración: Crear tabla para refresh tokens de usuarios readonly (no verificados)
-- Fecha: 2025-12-17
-- Descripción: Almacena refresh tokens para usuarios sin asociación que están en proceso de verificación

CREATE TABLE IF NOT EXISTS readonly_refresh_tokens (
    id SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_readonly_refresh_tokens_usuario ON readonly_refresh_tokens(id_usuario);
CREATE INDEX IF NOT EXISTS idx_readonly_refresh_tokens_expires ON readonly_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_readonly_refresh_tokens_revoked ON readonly_refresh_tokens(revoked) WHERE revoked = false;

-- Comentarios
COMMENT ON TABLE readonly_refresh_tokens IS 'Refresh tokens para usuarios readonly sin verificar';
COMMENT ON COLUMN readonly_refresh_tokens.id_usuario IS 'ID del usuario (sin usuario_entidad)';
COMMENT ON COLUMN readonly_refresh_tokens.token IS 'Token hasheado con Argon2';
COMMENT ON COLUMN readonly_refresh_tokens.revoked IS 'Indica si el token fue revocado';

-- Verificar que la tabla fue creada
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'readonly_refresh_tokens'
ORDER BY ordinal_position;
