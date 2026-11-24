-- Elimina las funciones PL/pgSQL con reglas de planificación y de licencias sobre turnos: desde
-- ADR-010 viven en services TS (planificacionServices, licenciasTurnosServices).
-- APLICAR DESPUÉS DEL DEPLOY del backend nuevo (y de desactivar los workflows de n8n): antes de
-- eso, el backend anterior y n8n todavía las llaman.
-- Quedan planificacion_ahora_ar, jornada_corrido_minutos, planificacion_fin_turno y
-- planificacion_minutos_turno (consultas de agregación).
-- El rol n8n_planificacion no se borra acá: `DROP ROLE n8n_planificacion` se hace a mano, según el entorno.
BEGIN;

DROP FUNCTION IF EXISTS snapshot_previsualizar(jsonb, integer);
DROP FUNCTION IF EXISTS snapshot_aplicar(bigint, integer, boolean);
DROP FUNCTION IF EXISTS snapshot_calcular_diff(bigint, timestamp);
DROP FUNCTION IF EXISTS snapshot_faltantes_actual(bigint, timestamp);
DROP FUNCTION IF EXISTS snapshot_faltantes_proxima(bigint);
DROP FUNCTION IF EXISTS snapshot_armar_diff_json(bigint);
DROP FUNCTION IF EXISTS snapshot_validar_payload(jsonb);
DROP FUNCTION IF EXISTS generar_semana_desde_snapshot(date);
DROP FUNCTION IF EXISTS planificacion_ventana(timestamp);
DROP FUNCTION IF EXISTS planificacion_marcar_dias_vacios(date, date);
DROP FUNCTION IF EXISTS aplicar_licencia(integer, bigint[]);
DROP FUNCTION IF EXISTS revertir_licencia(integer);
DROP FUNCTION IF EXISTS aplicar_licencias_a_turnos(bigint[]);

COMMIT;
