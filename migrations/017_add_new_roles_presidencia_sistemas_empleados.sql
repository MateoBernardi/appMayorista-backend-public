-- Migracion: Agregar roles nuevos para gestion y empleados por area
-- Fecha: 2026-03-22
-- Descripcion: Inserta los roles presidencia, sistemas y variantes de empleado sin duplicar registros existentes

-- Agregar rol 'presidencia'
INSERT INTO roles (nombre)
SELECT 'presidencia'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'presidencia'
);

-- Agregar rol 'sistemas'
INSERT INTO roles (nombre)
SELECT 'sistemas'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'sistemas'
);

-- Agregar rol 'empleado-admin'
INSERT INTO roles (nombre)
SELECT 'empleado-admin'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'empleado-admin'
);

-- Agregar rol 'empleado-insumos'
INSERT INTO roles (nombre)
SELECT 'empleado-insumos'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'empleado-insumos'
);

-- Agregar rol 'empleado-mayorista'
INSERT INTO roles (nombre)
SELECT 'empleado-mayorista'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'empleado-mayorista'
);

-- Agregar rol 'empleado-super'
INSERT INTO roles (nombre)
SELECT 'empleado-super'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'empleado-super'
);

-- Verificar que los roles existan
SELECT nombre
FROM roles
WHERE nombre IN (
    'presidencia',
    'sistemas',
    'empleado-admin',
    'empleado-insumos',
    'empleado-mayorista',
    'empleado-super'
)
ORDER BY nombre;
