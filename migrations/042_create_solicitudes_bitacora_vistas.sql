-- Tabla intermedia de visibilidad por entrada de bitácora, siguiendo el patrón
-- de archivo_aperturas (ver docs/ADR-004-file-open-tracking-table.md).
-- Hoy el acuse de lectura se guarda como una fila más de solicitudes_bitacora
-- con estado = 'SEEN', mezclando timeline (lo que se dice) con metadata de
-- lectura (quién vio qué). Esta tabla separa ambas cosas: cada fila es
-- "el usuario X vio la entrada Y", sin insertar entradas falsas en el historial.
-- La PK compuesta (id_usuario_entidad, id_solicitud_bitacora) cubre la consulta
-- típica "qué vio este usuario"; el índice inverso cubre la consulta simétrica
-- "quiénes vieron esta entrada".
BEGIN;

CREATE TABLE IF NOT EXISTS solicitudes_bitacora_vistas (
    id_usuario_entidad    integer NOT NULL REFERENCES usuario_entidad(id) ON DELETE CASCADE,
    id_solicitud_bitacora integer NOT NULL REFERENCES solicitudes_bitacora(id) ON DELETE CASCADE,
    seen_at               timestamp without time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id_usuario_entidad, id_solicitud_bitacora)
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_bitacora_vistas_bitacora
    ON solicitudes_bitacora_vistas (id_solicitud_bitacora);

COMMIT;
