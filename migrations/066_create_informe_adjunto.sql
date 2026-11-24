BEGIN;

CREATE TABLE IF NOT EXISTS informe_adjunto (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entrada_id bigint      NOT NULL REFERENCES informe_entrada(id) ON DELETE CASCADE,
  tipo       text        NOT NULL CHECK (tipo IN ('imagen', 'video', 'documento')),
  r2_key     text        NOT NULL,
  nombre     text        NOT NULL,
  mime       text        NOT NULL,
  tamano     integer     NOT NULL,
  orden      integer     NOT NULL DEFAULT 0,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS informe_adjunto_entrada_idx ON informe_adjunto (entrada_id);

COMMIT;
