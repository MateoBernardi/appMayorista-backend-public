-- Usuarios con visibilidad explícita sobre carpetas
CREATE TABLE IF NOT EXISTS carpeta_visibilidad_usuario (
  id SERIAL PRIMARY KEY,
  id_carpeta INTEGER NOT NULL,
  id_usuario INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  CONSTRAINT fk_carpeta_visibilidad_carpeta
    FOREIGN KEY (id_carpeta)
    REFERENCES carpetas(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_carpeta_visibilidad_usuario_entidad
    FOREIGN KEY (id_usuario)
    REFERENCES usuario_entidad(id),
  CONSTRAINT uq_carpeta_visibilidad
    UNIQUE (id_carpeta, id_usuario)
);

CREATE INDEX IF NOT EXISTS idx_carpeta_visibilidad_carpeta
  ON carpeta_visibilidad_usuario(id_carpeta)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_carpeta_visibilidad_usuario
  ON carpeta_visibilidad_usuario(id_usuario)
  WHERE deleted_at IS NULL;
