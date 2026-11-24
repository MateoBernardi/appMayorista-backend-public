-- Migración: Crear tabla verification_tokens
-- Fecha: 2025-12-17
-- Descripción: Tabla para almacenar tokens de verificación de identidad para asociación de cuentas

-- Crear tabla verification_tokens
CREATE TABLE IF NOT EXISTS verification_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    contact TEXT NOT NULL,         -- email o teléfono
    token TEXT NOT NULL,           -- código hasheado con Argon2
    method TEXT NOT NULL CHECK (method IN ('sms', 'email')),
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Un usuario solo puede tener un token activo por contact
    CONSTRAINT uq_user_contact UNIQUE (user_id, contact)
);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_user_id ON verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires_at ON verification_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_revoked ON verification_tokens(revoked) WHERE revoked = false;

-- Comentarios
COMMENT ON TABLE verification_tokens IS 'Tokens de verificación para asociación de cuentas';
COMMENT ON COLUMN verification_tokens.token IS 'Código de 6 dígitos hasheado con Argon2id';
COMMENT ON COLUMN verification_tokens.method IS 'Método de envío: sms o email';
COMMENT ON COLUMN verification_tokens.failed_attempts IS 'Contador de intentos fallidos (máximo 3)';
COMMENT ON COLUMN verification_tokens.revoked IS 'Indica si el token fue revocado manualmente o por intentos agotados';

-- Verificar que la tabla fue creada
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'verification_tokens'
ORDER BY ordinal_position;
