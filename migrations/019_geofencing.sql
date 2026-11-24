BEGIN;
--CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS sedes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    -- GEOGRAPHY(POINT, 4326) usa grados (lat/long) y permite cálculos en metros directamente
    ubicacion GEOGRAPHY(POINT, 4326) NOT NULL, 
    radio_permitido_metros INTEGER DEFAULT 50, -- Radio personalizado por sede
    activo BOOLEAN DEFAULT true
);

ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS sede_id INTEGER REFERENCES sedes(id);

COMMIT;