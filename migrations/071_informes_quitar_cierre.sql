-- Informes: se quita el cierre. Un informe ya no se cierra; solo tiene relato y mensajes.
-- Se borran los cierres existentes (sus adjuntos caen por ON DELETE CASCADE), con lo que
-- esos informes vuelven a aceptar entradas.
BEGIN;

DELETE FROM informe_entrada WHERE tipo = 'cierre';
DROP INDEX IF EXISTS informe_entrada_un_cierre;
ALTER TABLE informe_entrada DROP CONSTRAINT IF EXISTS informe_entrada_tipo_check;
ALTER TABLE informe_entrada ADD CONSTRAINT informe_entrada_tipo_check CHECK (tipo IN ('relato', 'mensaje'));

COMMIT;
