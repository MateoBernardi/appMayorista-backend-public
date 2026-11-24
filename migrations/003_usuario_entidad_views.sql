-- =====================================================
-- VISTAS DE USUARIO_ENTIDAD PARA OPTIMIZAR CONSULTAS
-- =====================================================
-- Fecha: 2025-11-10
-- Propósito: Simplificar queries de contexto de usuario
--           evitando joins repetitivos en el código
-- =====================================================

-- =====================================================
-- Vista: v_usuario_entidad_completo
-- Descripción: Unifica toda la información de contexto
--              de usuario incluyendo datos del usuario,
--              entidad_tipo, rol y origen
-- =====================================================
CREATE OR REPLACE VIEW v_usuario_entidad_completo AS
SELECT 
    ue.id AS user_context_id,
    ue.id_usuario,
    ue.id_entidad_tipo,
    ue.id_entidad,
    ue.id_rol,
    ue.fecha_asociacion,
    -- Datos del usuario
    u.username,
    u.email,
    u.nombre,
    u.apellido,
    u.created_at AS usuario_created_at,
    u.updated_at AS usuario_updated_at,
    -- Datos del tipo de entidad
    et.nombre AS entidad_tipo_nombre,
    et.origen AS entorno,
    -- Datos del rol
    r.nombre AS rol_nombre
FROM usuario_entidad ue
INNER JOIN usuarios u ON ue.id_usuario = u.id
INNER JOIN entidades_tipos et ON ue.id_entidad_tipo = et.id
INNER JOIN roles r ON ue.id_rol = r.id_rol
WHERE u.deleted_at IS NULL;

-- =====================================================
-- Vista: v_web_users
-- Descripción: Usuarios con contexto 'web' (clientes minoristas)
-- =====================================================
CREATE OR REPLACE VIEW v_web_users AS
SELECT 
    user_context_id,
    id_usuario,
    id_entidad_tipo,
    id_entidad,
    id_rol,
    fecha_asociacion,
    username,
    email,
    nombre,
    apellido,
    usuario_created_at,
    usuario_updated_at,
    entidad_tipo_nombre,
    entorno,
    rol_nombre
FROM v_usuario_entidad_completo
WHERE entorno = 'web';

-- =====================================================
-- Vista: v_mayorista_users
-- Descripción: Usuarios con contexto 'mayorista' (vendedores)
-- =====================================================
CREATE OR REPLACE VIEW v_mayorista_users AS
SELECT 
    user_context_id,
    id_usuario,
    id_entidad_tipo,
    id_entidad,
    id_rol,
    fecha_asociacion,
    username,
    email,
    nombre,
    apellido,
    usuario_created_at,
    usuario_updated_at,
    entidad_tipo_nombre,
    entorno,
    rol_nombre
FROM v_usuario_entidad_completo
WHERE entorno = 'mayorista';

-- =====================================================
-- Vista: v_interno_users
-- Descripción: Usuarios con contexto 'interno' (empleados)
-- =====================================================
CREATE OR REPLACE VIEW v_interno_users AS
SELECT 
    user_context_id,
    id_usuario,
    id_entidad_tipo,
    id_entidad,
    id_rol,
    fecha_asociacion,
    username,
    email,
    nombre,
    apellido,
    usuario_created_at,
    usuario_updated_at,
    entidad_tipo_nombre,
    entorno,
    rol_nombre
FROM v_usuario_entidad_completo
WHERE entorno = 'interno';

-- =====================================================
-- Índices para mejorar performance
-- =====================================================

-- Índice compuesto para búsquedas frecuentes de usuario + entorno
CREATE INDEX IF NOT EXISTS idx_usuario_entidad_usuario_tipo 
ON usuario_entidad(id_usuario, id_entidad_tipo);

-- Índice para búsquedas por entidad
CREATE INDEX IF NOT EXISTS idx_usuario_entidad_entidad 
ON usuario_entidad(id_entidad);

-- Índice para búsquedas por rol
CREATE INDEX IF NOT EXISTS idx_usuario_entidad_rol 
ON usuario_entidad(id_rol);

-- Índice para la columna origen en entidades_tipos
CREATE INDEX IF NOT EXISTS idx_entidades_tipos_origen 
ON entidades_tipos(origen);

-- =====================================================
-- COMENTARIOS EN LAS VISTAS (DOCUMENTACIÓN EN BD)
-- =====================================================

COMMENT ON VIEW v_usuario_entidad_completo IS 
'Vista completa de usuario_entidad con todos los datos relacionados (usuario, entidad_tipo, rol). Evita joins repetitivos.';

COMMENT ON VIEW v_web_users IS 
'Usuarios con contexto web (clientes minoristas). Filtra por origen = ''web''.';

COMMENT ON VIEW v_mayorista_users IS 
'Usuarios con contexto mayorista (vendedores). Filtra por origen = ''mayorista''.';

COMMENT ON VIEW v_interno_users IS 
'Usuarios con contexto interno (empleados). Filtra por origen = ''interno''.';

-- =====================================================
-- EJEMPLO DE USO
-- =====================================================
/*

-- Obtener contexto de un usuario para entorno web
SELECT * FROM v_web_users WHERE id_usuario = 123;

-- Obtener contexto de un usuario para cualquier entorno
SELECT * FROM v_usuario_entidad_completo 
WHERE id_usuario = 123 AND entorno = 'mayorista';

-- Buscar por username y entorno
SELECT * FROM v_mayorista_users WHERE username = 'juan.perez';

-- Obtener información completa de un refresh token
SELECT 
    rt.*,
    vuc.username,
    vuc.nombre,
    vuc.apellido,
    vuc.email,
    vuc.rol_nombre,
    vuc.entorno
FROM refresh_tokens rt
INNER JOIN v_usuario_entidad_completo vuc ON rt.id_usuario_entidad = vuc.user_context_id
WHERE rt.token = 'abc123' 
  AND rt.revoked = FALSE 
  AND rt.expires_at > NOW();

*/
