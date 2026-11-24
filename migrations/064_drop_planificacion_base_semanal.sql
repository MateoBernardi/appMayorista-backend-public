-- La planificación ahora sale del snapshot de la planilla (migraciones 062/063, ADR-008) y la
-- generación semanal la hace n8n con generar_semana_desde_snapshot(). La tabla base ya no la
-- lee ni la escribe ningún código.
-- Aplicar RECIÉN después del cutover (snapshot inicial cargado y primera generación semanal
-- verificada): borra los datos de la plantilla base anterior.
DROP TABLE IF EXISTS planificacion_base_semanal;
