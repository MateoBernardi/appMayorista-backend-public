BEGIN;

-- Ofertas: precio/stock alternativo para un articulo mientras esta activa.
-- Nunca se mezclan campos entre articulos y articulos_ofertas: cuando hay una
-- oferta activa (deleted_at IS NULL) para un codigo_articulo, se usa por
-- completo en su lugar; al desactivarse (deleted_at seteado), el articulo
-- base vuelve a regir sin cambios.
CREATE TABLE articulos_ofertas (
    oferta_id             SERIAL PRIMARY KEY,
    codigo_articulo       INTEGER NOT NULL REFERENCES articulos(codigo_articulo),
    precio_costo          NUMERIC(11,3) NOT NULL CHECK (precio_costo >= 0),
    precio_venta          NUMERIC(11,3) NOT NULL CHECK (precio_venta >= 0),
    precio_venta_volumen  NUMERIC(11,3) NOT NULL CHECK (precio_venta_volumen >= 0),
    stock_actual          NUMERIC(10,3) NOT NULL CHECK (stock_actual >= 0),
    rentabilidad_minima   NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (rentabilidad_minima >= 0 AND rentabilidad_minima <= 1),
    created_at            TIMESTAMP NOT NULL DEFAULT now(),
    updated_at            TIMESTAMP,
    deleted_at            TIMESTAMP
);

-- Solo puede haber una oferta activa por articulo a la vez.
CREATE UNIQUE INDEX articulos_ofertas_codigo_articulo_activa_idx
    ON articulos_ofertas (codigo_articulo) WHERE deleted_at IS NULL;

CREATE INDEX articulos_ofertas_codigo_articulo_idx ON articulos_ofertas (codigo_articulo);

CREATE TRIGGER trg_articulos_ofertas_updated
    BEFORE UPDATE ON articulos_ofertas
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
