-- =====================================================
-- SEED DATA: Tipos de Entidades (Entornos)
-- =====================================================
-- Fecha: 2025-11-10
-- Propósito: Insertar los tipos de entidades básicos
--           si no existen en la base de datos
-- =====================================================

-- Crear tabla entidades_tipos si no existe
CREATE TABLE IF NOT EXISTS entidades_tipos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    origen VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insertar tipos de entidades básicos (si no existen)
INSERT INTO entidades_tipos (nombre, origen) 
VALUES 
    ('cliente_minorista', 'web'),
    ('vendedor_mayorista', 'mayorista'),
    ('empleado_interno', 'interno')
ON CONFLICT (nombre) DO NOTHING;

-- Verificar datos insertados
SELECT * FROM entidades_tipos ORDER BY id;

-- Comentario en la tabla
COMMENT ON TABLE entidades_tipos IS 
'Tipos de entidades que determinan el contexto/entorno de usuario (web, mayorista, interno)';

COMMENT ON COLUMN entidades_tipos.nombre IS 
'Nombre descriptivo del tipo de entidad (ej: cliente_minorista, vendedor_mayorista, empleado_interno)';

COMMENT ON COLUMN entidades_tipos.origen IS 
'Entorno/origen de la entidad: web, mayorista o interno';
