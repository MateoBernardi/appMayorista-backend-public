-- Informes: registro de qué usuarios vieron cada entrada.
-- usuario_id referencia usuario_entidad(id) (= user_context_id); si se da de baja el usuario, se borran sus vistos.
BEGIN;

CREATE TABLE IF NOT EXISTS informe_entrada_visto (
  entrada_id bigint      NOT NULL REFERENCES informe_entrada(id) ON DELETE CASCADE,
  usuario_id integer     NOT NULL REFERENCES usuario_entidad(id) ON DELETE CASCADE,
  visto_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entrada_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS informe_entrada_visto_usuario_idx ON informe_entrada_visto (usuario_id);

COMMIT;
