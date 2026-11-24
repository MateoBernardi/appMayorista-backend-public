BEGIN;

-- Migración 068: carpeta raíz "CVs Página Web" para los CVs que suben los
-- visitantes desde la web pública (POST /public/cvs).
-- Fecha: 2026-10-12
-- Visible solo para los roles 'gerencia' y 'personasRelaciones' (allowed_roles).
-- Dueño: el primer usuario con rol 'gerencia' (también queda como created_by de
-- cada CV, así se pueden borrar/mover desde internoApp).
-- Idempotente: si ya existe una carpeta raíz activa con ese nombre, no hace nada.

DO $$
DECLARE
    v_owner_id INTEGER;
BEGIN
    SELECT ue.id
    INTO v_owner_id
    FROM usuario_entidad ue
    JOIN roles r ON r.id_rol = ue.id_rol
    WHERE r.nombre = 'gerencia'
    ORDER BY ue.id
    LIMIT 1;

    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Migración 068: no existe ningún usuario con rol gerencia para ser dueño de la carpeta "CVs Página Web".';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM carpetas
        WHERE nombre = 'CVs Página Web'
          AND id_carpeta_padre IS NULL
          AND deleted_at IS NULL
    ) THEN
        INSERT INTO carpetas (nombre, id_carpeta_padre, id_usuario, allowed_roles)
        VALUES ('CVs Página Web', NULL, v_owner_id, ARRAY['gerencia', 'personasRelaciones']);
    END IF;
END $$;

-- Verificación rápida
SELECT id, nombre, id_carpeta_padre, id_usuario, allowed_roles
FROM carpetas
WHERE nombre = 'CVs Página Web' AND deleted_at IS NULL;

COMMIT;
