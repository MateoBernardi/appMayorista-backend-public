-- La generación semanal no recrea los turnos de un día que ya está en horario corrido.
-- Con horario_corrido el encargado deja un único turno por día y borra los demás; volver a correr
-- generar_semana_desde_snapshot() sobre una semana ya generada (un reintento de n8n o una corrida
-- manual) los recreaba por el ON CONFLICT DO NOTHING (la fila borrada ya no existe). Misma firma
-- que en la migración 063: CREATE OR REPLACE conserva los permisos ya otorgados.

CREATE OR REPLACE FUNCTION generar_semana_desde_snapshot(p_lunes date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_hoy date := planificacion_ahora_ar()::date;
    v_lunes date;
    v_snapshot_id bigint;
    v_generados int;
    v_promovidos int;
    v_faltantes jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(7305101);

    v_lunes := COALESCE(p_lunes, v_hoy + (8 - EXTRACT(ISODOW FROM v_hoy)::int));
    IF EXTRACT(ISODOW FROM v_lunes) <> 1 THEN
        RAISE EXCEPTION 'La fecha % no es un lunes.', v_lunes USING ERRCODE = 'P0001';
    END IF;

    SELECT id INTO v_snapshot_id FROM planificacion_snapshot WHERE estado = 'ACTIVO';
    IF v_snapshot_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'SIN_SNAPSHOT', 'lunes', v_lunes);
    END IF;

    -- Faltantes antes de promover: snapshot_faltantes_proxima ya usa el objetivo de la planilla.
    SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb) INTO v_faltantes
    FROM snapshot_faltantes_proxima(v_snapshot_id) f;

    INSERT INTO planificacion_diaria
        (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out, licencia)
    SELECT st.user_context_id, st.turno,
           (v_lunes + st.dia_semana - 1) + st.hora_in,
           (v_lunes + st.dia_semana - 1) + st.hora_out,
           st.sede_id, st.sede_id,
           EXISTS (
               SELECT 1 FROM solicitudes_ausencia sa
               WHERE sa.usuario_id = st.user_context_id AND sa.estado = 'APROBADA' AND sa.deleted_at IS NULL
                 AND sa.fecha_inicio <= (v_lunes + st.dia_semana - 1) + st.hora_in
                 AND sa.fecha_fin >= (v_lunes + st.dia_semana - 1) + st.hora_out)
    FROM planificacion_snapshot_turno st
    JOIN v_interno_users vi ON vi.user_context_id = st.user_context_id
    WHERE st.snapshot_id = v_snapshot_id
      -- Un día que ya quedó como horario corrido (un único turno, sin salida prevista) no se
      -- vuelve a completar con los demás turnos de la plantilla: se borraron a propósito.
      AND NOT EXISTS (
          SELECT 1 FROM planificacion_diaria c
          WHERE c.user_context_id = st.user_context_id
            AND DATE(c.esperado_in) = v_lunes + st.dia_semana - 1
            AND c.horario_corrido)
    ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING;
    GET DIAGNOSTICS v_generados = ROW_COUNT;

    UPDATE usuarios_horas_objetivo
    SET horas_objetivo = horas_objetivo_pendiente, horas_objetivo_pendiente = NULL, updated_at = now()
    WHERE horas_objetivo_pendiente IS NOT NULL;
    GET DIAGNOSTICS v_promovidos = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'lunes', v_lunes, 'snapshotId', v_snapshot_id,
                              'generados', v_generados, 'objetivosPromovidos', v_promovidos,
                              'faltantes', v_faltantes);
END;
$$;
