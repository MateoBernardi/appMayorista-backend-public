-- Migración: Agregar rol 'readonly' para usuarios no verificados
-- Fecha: 2025-12-17
-- Descripción: Este rol permite a los usuarios acceder únicamente a las rutas de asociación

-- Verificar si el rol ya existe antes de insertarlo
INSERT INTO roles (nombre)
SELECT 'readonly'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'readonly'
);

-- Verificar que el rol fue creado
SELECT * FROM roles WHERE nombre = 'readonly';
