-- El saldo de ausencias deja de ser por año: una sola fila por (usuario, tipo de licencia).
-- Si algún usuario tiene más de una fila para el mismo tipo (años distintos), la migración aborta:
-- esas filas se unifican a mano antes de correrla.
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM saldos_ausencia
        GROUP BY usuario_id, tipo_licencia_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'saldos_ausencia tiene más de una fila por (usuario_id, tipo_licencia_id); unificarlas antes de migrar.';
    END IF;
END $$;

DROP INDEX IF EXISTS idx_saldos_lookup;
ALTER TABLE saldos_ausencia DROP CONSTRAINT IF EXISTS saldos_ausencia_usuario_id_tipo_licencia_id_anio_key;
ALTER TABLE saldos_ausencia DROP COLUMN anio;
ALTER TABLE saldos_ausencia
    ADD CONSTRAINT saldos_ausencia_usuario_id_tipo_licencia_id_key UNIQUE (usuario_id, tipo_licencia_id);

COMMIT;
