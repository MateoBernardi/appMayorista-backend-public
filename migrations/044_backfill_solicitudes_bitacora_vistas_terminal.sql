-- Once a solicitud reaches a terminal state (ACCEPTED, REJECTED,
-- ACTIVIDAD_CREADA), everything before that point in its bitacora is moot:
-- there's nothing left for a participant to act on. Neither the frontend's
-- host-side nor invitado-side auto-mark-seen trigger covers these terminal
-- transitions, so entries at or before them never got a
-- solicitudes_bitacora_vistas row and stayed "unseen" forever (see
-- src/adapters/db/solicitudesRepo.ts sin_ver CTE). The query fix (same
-- commit) treats "id <= last terminal entry" as seen live, without needing
-- this table; this backfill brings the stored rows in line with that so
-- direct reads of solicitudes_bitacora_vistas (e.g. per-message read
-- receipts in the chat view) are consistent too.
BEGIN;

WITH terminal_marks AS (
    SELECT solicitud_id, MAX(id) AS terminal_id
    FROM solicitudes_bitacora
    WHERE deleted_at IS NULL
      AND estado IN ('ACCEPTED', 'REJECTED', 'ACTIVIDAD_CREADA')
    GROUP BY solicitud_id
),
participantes AS (
    SELECT solicitud_id, created_by AS id_usuario_entidad FROM solicitudes
    UNION
    SELECT id_solicitud, id_usuario_invitado
    FROM solicitudes_invitados
    WHERE deleted_at IS NULL
)
INSERT INTO solicitudes_bitacora_vistas (id_usuario_entidad, id_solicitud_bitacora, seen_at)
SELECT DISTINCT p.id_usuario_entidad, sb.id, sb.created_at
FROM solicitudes_bitacora sb
JOIN terminal_marks tm ON tm.solicitud_id = sb.solicitud_id AND sb.id <= tm.terminal_id
JOIN participantes p ON p.solicitud_id = sb.solicitud_id
WHERE sb.deleted_at IS NULL
  AND sb.estado <> 'SEEN'
  AND p.id_usuario_entidad <> sb.usuario_id
ON CONFLICT DO NOTHING;

COMMIT;
