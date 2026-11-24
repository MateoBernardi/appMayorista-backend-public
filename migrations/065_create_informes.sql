-- Informes: hilo append-only de entradas HTML agrupadas por informe_id (uuid).
-- autor_id y menciones referencian usuario_entidad(id) (= user_context_id).
-- Un array no admite FK, por lo que las menciones se validan en la app.
BEGIN;

CREATE TABLE IF NOT EXISTS informe_entrada (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  informe_id uuid        NOT NULL,
  tipo       text        NOT NULL CHECK (tipo IN ('relato', 'mensaje', 'cierre')),
  autor_id   integer     NOT NULL REFERENCES usuario_entidad(id),
  menciones  integer[]   NOT NULL DEFAULT '{}',
  creado_en  timestamptz NOT NULL DEFAULT now(),
  editado_en timestamptz,
  cuerpo     text        NOT NULL
);

CREATE INDEX IF NOT EXISTS informe_entrada_menciones_idx ON informe_entrada USING gin (menciones);
CREATE INDEX IF NOT EXISTS informe_entrada_informe_idx   ON informe_entrada (informe_id, creado_en);
CREATE INDEX IF NOT EXISTS informe_entrada_autor_idx     ON informe_entrada (autor_id);
CREATE UNIQUE INDEX IF NOT EXISTS informe_entrada_un_relato ON informe_entrada (informe_id) WHERE tipo = 'relato';
CREATE UNIQUE INDEX IF NOT EXISTS informe_entrada_un_cierre ON informe_entrada (informe_id) WHERE tipo = 'cierre';

COMMIT;
