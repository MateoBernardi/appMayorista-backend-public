BEGIN;

-- Migración 061: separar el rol 'admin' en dos roles especializados.
-- Fecha: 2026-09-28
-- admin-products: cuentas, articulos (edición completa), ofertas, sync de catálogo.
-- admin-content: suscripciones, novedades-web, imagenes, y articulos SOLO para
--                vincular/desvincular/reordenar imágenes de un producto.

-- Crear los nuevos roles (idempotente, mismo patrón que 004_add_readonly_role.sql)
INSERT INTO roles (nombre)
SELECT 'admin-products'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'admin-products'
);

INSERT INTO roles (nombre)
SELECT 'admin-content'
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE nombre = 'admin-content'
);

-- Backfill: todo usuario con el rol 'admin' pasa a 'admin-products' por defecto.
-- La reasignación puntual a 'admin-content' se hace después, a mano, vía
-- PUT /usuarios/:id/role (endpoint existente, solo gerencia).
UPDATE usuario_entidad
SET id_rol = (SELECT id_rol FROM roles WHERE nombre = 'admin-products')
WHERE id_rol = (SELECT id_rol FROM roles WHERE nombre = 'admin');

-- No se elimina la fila 'admin' de roles: se deja por reversibilidad. Una
-- migración de limpieza futura puede borrarla una vez confirmado que no se usa.

-- Verificación rápida
SELECT * FROM roles WHERE nombre IN ('admin', 'admin-products', 'admin-content');

COMMIT;
