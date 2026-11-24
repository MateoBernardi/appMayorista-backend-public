BEGIN;

-- Novedades del sitio público. Ver InsumosWeb/frontend/frontend/admin-cliente/design_handoff_italo_argentina/novedades-schema.sql
CREATE TABLE novedades_web (
    id            SERIAL PRIMARY KEY,
    titulo        VARCHAR(140) NOT NULL,
    preview       VARCHAR(280) NOT NULL,
    cuerpo        TEXT NOT NULL,
    imagen        VARCHAR(255),
    publicada_en  TIMESTAMP NOT NULL DEFAULT now(),
    estado        VARCHAR(20) NOT NULL DEFAULT 'Borrador'
                  CHECK (estado IN ('Borrador', 'Programada', 'Publicada')),
    created_by    INTEGER REFERENCES usuario_entidad(id),
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP,
    deleted_at    TIMESTAMP
);

CREATE INDEX novedades_web_publicadas_idx ON novedades_web (publicada_en DESC)
    WHERE deleted_at IS NULL AND estado = 'Publicada';

CREATE TRIGGER trg_novedades_web_updated
    BEFORE UPDATE ON novedades_web
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
