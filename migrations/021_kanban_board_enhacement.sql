-- 1. Crear el tipo ENUM para los roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'objetivo_usuario_rol') THEN
        CREATE TYPE objetivo_usuario_rol AS ENUM ('ASSIGNEE', 'VISUALIZER');
    END IF;
END $$;

-- 2. Agregar el nexo en la tabla objetivos
ALTER TABLE objetivos
ADD COLUMN IF NOT EXISTS solicitud_id INTEGER NULL;

-- Asumo que la PK de tu tabla solicitudes se llama 'id' (ajustalo si se llama de otra forma)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_objetivos_solicitud'
          AND conrelid = 'objetivos'::regclass
    ) THEN
        ALTER TABLE objetivos
        ADD CONSTRAINT fk_objetivos_solicitud
        FOREIGN KEY (solicitud_id) REFERENCES solicitudes
        ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Crear la tabla pivote objetivos_usuarios
CREATE TABLE IF NOT EXISTS objetivos_usuarios (
    id SERIAL PRIMARY KEY,
    objetivo_id INTEGER NOT NULL,
    user_context_id INTEGER NOT NULL,
    rol objetivo_usuario_rol NOT NULL DEFAULT 'VISUALIZER',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Claves foráneas (Ajustá "usuarios(id)" si tu tabla de usuarios se llama diferente)
    CONSTRAINT fk_ou_objetivo FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE CASCADE,
    CONSTRAINT fk_ou_usuario FOREIGN KEY (user_context_id) REFERENCES usuario_entidad(id) ON DELETE CASCADE,

    -- Evita que el mismo usuario tenga dos roles duplicados en el mismo objetivo
    CONSTRAINT uk_objetivo_usuario UNIQUE (objetivo_id, user_context_id)
);

-- Índice optimizado para cargar los tableros personales y compartidos rápidamente
CREATE INDEX IF NOT EXISTS idx_objetivos_usuarios_user_context_rol ON objetivos_usuarios(user_context_id, rol);

CREATE TABLE IF NOT EXISTS archivos_solicitudes (
    id SERIAL PRIMARY KEY,
    solicitud_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_archivo_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_archivos_solicitudes_id ON archivos_solicitudes(solicitud_id);


CREATE TABLE IF NOT EXISTS archivos_actividades (
    id SERIAL PRIMARY KEY,
    actividad_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_archivo_actividad FOREIGN KEY (actividad_id) REFERENCES actividades ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_archivos_actividades_id ON archivos_actividades(actividad_id);

CREATE TABLE IF NOT EXISTS archivos_objetivos (
    id SERIAL PRIMARY KEY,
    objetivo_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_archivo_objetivo FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_archivos_objetivos_id ON archivos_objetivos(objetivo_id);