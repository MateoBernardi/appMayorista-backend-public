-- Tabla de carpetas jerárquicas para archivos
CREATE TABLE IF NOT EXISTS carpetas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  id_carpeta_padre INTEGER NULL,
  id_usuario INTEGER NOT NULL,
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  CONSTRAINT fk_carpetas_padre
    FOREIGN KEY (id_carpeta_padre)
    REFERENCES carpetas(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_carpetas_usuario_entidad
    FOREIGN KEY (id_usuario)
    REFERENCES usuario_entidad(id)
);

CREATE INDEX IF NOT EXISTS idx_carpetas_padre
  ON carpetas(id_carpeta_padre)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_carpetas_usuario
  ON carpetas(id_usuario)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_carpetas_roles_gin
  ON carpetas
  USING GIN (allowed_roles);
