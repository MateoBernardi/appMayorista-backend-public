-- Backfill de solicitudes_bitacora_vistas a partir del histórico de acuses
-- 'SEEN' guardados en solicitudes_bitacora (ver 042).
-- Watermark: por cada par (solicitud, usuario) se toma su último acuse 'SEEN'
-- (MAX(id) dentro de esa solicitud) y se marcan como vistas todas las entradas
-- de esa solicitud hasta ese punto inclusive.
-- Se excluyen las entradas cuyo usuario_id es el propio usuario: nadie "ve"
-- lo que escribió, ya lo tiene presente por haberlo creado.
-- También se excluyen las entradas 'SEEN' ajenas: son acuses de lectura de
-- otros usuarios, no forman parte de la timeline visible y con este backfill
-- pasan a vivir sólo en solicitudes_bitacora_vistas.
BEGIN;

INSERT INTO solicitudes_bitacora_vistas (id_usuario_entidad, id_solicitud_bitacora, seen_at)
SELECT w.usuario_id, sb.id, w.seen_at
FROM (
    SELECT solicitud_id, usuario_id, MAX(id) AS max_id, MAX(created_at) AS seen_at
    FROM solicitudes_bitacora
    WHERE estado = 'SEEN'
    GROUP BY solicitud_id, usuario_id
) w
JOIN solicitudes_bitacora sb
  ON  sb.solicitud_id = w.solicitud_id
  AND sb.id          <= w.max_id
  AND sb.usuario_id  <> w.usuario_id
  AND sb.estado      <> 'SEEN'
  AND sb.deleted_at  IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
