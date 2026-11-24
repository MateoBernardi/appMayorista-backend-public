-- =====================================================
-- ROLLBACK: Eliminar vistas e índices de usuario_entidad
-- =====================================================
-- Fecha: 2025-11-10
-- Propósito: Revertir los cambios aplicados por usuario_entidad_views.sql
-- =====================================================

-- Eliminar vistas específicas por entorno
DROP VIEW IF EXISTS v_web_users CASCADE;
DROP VIEW IF EXISTS v_mayorista_users CASCADE;
DROP VIEW IF EXISTS v_interno_users CASCADE;

-- Eliminar vista principal
DROP VIEW IF EXISTS v_usuario_entidad_completo CASCADE;

-- Eliminar índices (solo si no existían antes)
DROP INDEX IF EXISTS idx_usuario_entidad_usuario_tipo;
DROP INDEX IF EXISTS idx_usuario_entidad_entidad;
DROP INDEX IF EXISTS idx_usuario_entidad_rol;
DROP INDEX IF EXISTS idx_entidades_tipos_origen;

-- Confirmar rollback
SELECT 'Rollback completado - Vistas e índices eliminados' AS status;
