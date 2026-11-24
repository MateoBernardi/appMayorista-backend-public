CREATE TABLE IF NOT EXISTS resumen_semanal_ejecutado (
    semana DATE PRIMARY KEY,
    ejecutado_at TIMESTAMP NOT NULL DEFAULT NOW()
);
