-- 1. Definición de Tipos ENUM
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'turno_enum') THEN
        CREATE TYPE turno_enum AS ENUM ('Mañana', 'Tarde', 'Noche', 'Rotativo');
    END IF;
END $$;

---Table 1: planificacion_diaria
CREATE TABLE IF NOT EXISTS planificacion_diaria (
    id BIGSERIAL PRIMARY KEY, -- BIGSERIAL para manejar volúmenes masivos de datos
    user_context_id INT NOT NULL,
    fecha DATE NOT NULL,
    turno turno_enum NOT NULL,
    esperado_in TIMESTAMP NULL,
    esperado_out TIMESTAMP NULL,
    reason VARCHAR(255) NULL,
    modificado_manualmente BOOLEAN DEFAULT FALSE,
    
    -- Restricción para evitar solapamientos del mismo usuario en el mismo turno/día
    CONSTRAINT unique_user_fecha_turno UNIQUE (user_context_id, fecha, turno)
);

ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS esperado_in TIMESTAMP NULL; 
ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS esperado_out TIMESTAMP NULL;
ALTER TABLE planificacion_diaria DROP COLUMN IF EXISTS real_in;
ALTER TABLE planificacion_diaria DROP COLUMN IF EXISTS real_out;
ALTER TABLE planificacion_diaria DROP COLUMN IF EXISTS id_solicitud;

ALTER TABLE planificacion_diaria ADD COLUMN IF NOT EXISTS sede_id INT NULL;

-- Tabla que sirve para auditoría de escaneos (clock-in/clock-out)
CREATE TABLE IF NOT EXISTS scans (
    id BIGSERIAL PRIMARY KEY,
    user_context_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    latitud DECIMAL(10, 6) NOT NULL,
    longitud DECIMAL(10, 6) NOT NULL
);

ALTER TABLE scans ADD COLUMN IF NOT EXISTS tipo_scan VARCHAR(10) NULL; -- 'IN' o 'OUT'


-- Índice para mejorar búsquedas por fecha y usuario
CREATE INDEX IF NOT EXISTS idx_planificacion_fecha_user ON planificacion_diaria (fecha, user_context_id);

---Table 2: saldos_francos
CREATE TABLE IF NOT EXISTS saldos_francos (
    user_context_id INT PRIMARY KEY, -- PK y FK al mismo tiempo
    horas_disponibles DECIMAL(10, 2) DEFAULT 0.00,
    horas_consumidas DECIMAL(10, 2) DEFAULT 0.00
);

---Table 3: devices_clockin
CREATE TABLE IF NOT EXISTS devices_clockin (
    id SERIAL PRIMARY KEY,
    user_context_id INT NOT NULL,
    device_id VARCHAR(255) NOT NULL,
    
    CONSTRAINT unique_user_device UNIQUE (device_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'unique_user_device'
          AND conrelid = 'devices_clockin'::regclass
    ) THEN
        ALTER TABLE devices_clockin
            ADD CONSTRAINT unique_user_device UNIQUE (device_id);
    END IF;
END $$;