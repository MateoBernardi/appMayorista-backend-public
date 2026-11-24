-- Duraciones en minutos enteros (antes deciHoras = horas × 10, con redondeo a 6 min).
-- La conversión es exacta (× 6). Se renombran las columnas para que la unidad quede en el
-- nombre. cantidad_dias (días × 10) no cambia.
-- saldos_francos_movimientos es append-only: esta migración no es una corrección de
-- movimientos sino un cambio de unidad de todo el ledger.
-- Las funciones de planificación (063/065) leen columnas renombradas: se recrean con la misma
-- firma (CREATE OR REPLACE conserva los permisos otorgados al rol de n8n). El payload de n8n
-- sigue expresando el objetivo en horas.
BEGIN;

ALTER TABLE saldos_francos RENAME COLUMN horas_disponibles TO minutos_disponibles;
ALTER TABLE saldos_francos RENAME COLUMN horas_consumidas TO minutos_consumidos;
UPDATE saldos_francos SET minutos_disponibles = minutos_disponibles * 6,
                          minutos_consumidos  = minutos_consumidos * 6;

ALTER TABLE saldos_francos_movimientos RENAME COLUMN cantidad TO minutos;
ALTER TABLE saldos_francos_movimientos RENAME COLUMN saldo_disponible_resultante TO minutos_disponibles_resultante;
ALTER TABLE saldos_francos_movimientos RENAME COLUMN saldo_consumida_resultante TO minutos_consumidos_resultante;
UPDATE saldos_francos_movimientos SET minutos = minutos * 6,
       minutos_disponibles_resultante = minutos_disponibles_resultante * 6,
       minutos_consumidos_resultante  = minutos_consumidos_resultante * 6;

ALTER TABLE usuarios_horas_objetivo RENAME COLUMN horas_objetivo TO minutos_objetivo;
ALTER TABLE usuarios_horas_objetivo RENAME COLUMN horas_objetivo_pendiente TO minutos_objetivo_pendiente;
UPDATE usuarios_horas_objetivo SET minutos_objetivo = minutos_objetivo * 6,
                                   minutos_objetivo_pendiente = minutos_objetivo_pendiente * 6;

ALTER TABLE planificacion_snapshot_objetivo RENAME COLUMN horas_objetivo TO minutos_objetivo;
UPDATE planificacion_snapshot_objetivo SET minutos_objetivo = minutos_objetivo * 6;

-- La migración 035 la declara NUMERIC(3,1) pero hay bases donde ya es INTEGER: el USING
-- sirve para ambos casos.
ALTER TABLE planificacion_diaria RENAME COLUMN horas_trabajadas TO minutos_trabajados;
ALTER TABLE planificacion_diaria
    ALTER COLUMN minutos_trabajados DROP DEFAULT,
    ALTER COLUMN minutos_trabajados TYPE INTEGER USING ROUND(minutos_trabajados * 6)::integer,
    ALTER COLUMN minutos_trabajados SET DEFAULT 0;

ALTER TABLE solicitudes_ausencia RENAME COLUMN cantidad_horas TO cantidad_minutos;
UPDATE solicitudes_ausencia SET cantidad_minutos = cantidad_minutos * 6 WHERE cantidad_minutos IS NOT NULL;

-- Jornada fija de un horario corrido sin salida marcada: 4 h para medio tiempo (objetivo de
-- hasta 30 h semanales), 8 h para el resto o sin objetivo. Única definición: la usan el
-- cálculo de horas trabajadas (horariosRepo) y la aplicación de licencias (074).
CREATE OR REPLACE FUNCTION jornada_corrido_minutos(p_minutos_objetivo integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE WHEN p_minutos_objetivo IS NOT NULL AND p_minutos_objetivo <= 1800 THEN 240 ELSE 480 END
$$;


-- Usuarios con objetivo cuyo total de horas queda por debajo. Solo faltantes (el exceso
-- no se informa). Semana en curso: filas existentes que el publish no reemplaza + las
-- nuevas, contra el objetivo vigente. Los turnos con esperado_out NULL (horario corrido)
-- suman 0 acá.
CREATE OR REPLACE FUNCTION snapshot_faltantes_actual(
    p_snapshot_id bigint,
    p_ahora timestamp DEFAULT planificacion_ahora_ar()
)
RETURNS TABLE (user_context_id integer, nombre text, apellido text, horas numeric, objetivo numeric)
LANGUAGE sql STABLE
AS $$
    WITH v AS (SELECT * FROM planificacion_ventana(p_ahora)),
    diff AS (SELECT * FROM snapshot_calcular_diff(p_snapshot_id, p_ahora)),
    usuarios AS (
        SELECT DISTINCT st.user_context_id AS uid
        FROM planificacion_snapshot_turno st WHERE st.snapshot_id = p_snapshot_id
    ),
    base AS (
        SELECT pd.user_context_id AS uid,
               COALESCE(EXTRACT(EPOCH FROM (pd.esperado_out - pd.esperado_in)) / 3600.0, 0) AS h
        FROM planificacion_diaria pd, v
        WHERE pd.user_context_id IN (SELECT uid FROM usuarios)
          AND DATE(pd.esperado_in) BETWEEN v.lunes AND v.lunes + 5
          AND NOT EXISTS (
              SELECT 1 FROM diff d
              WHERE d.old_id = pd.id AND d.accion IN ('modificacion', 'baja')
          )
        UNION ALL
        SELECT d.user_context_id,
               EXTRACT(EPOCH FROM (d.new_out - d.new_in)) / 3600.0
        FROM diff d
        WHERE d.accion IN ('alta', 'modificacion')
    ),
    total AS (SELECT uid, SUM(h) AS horas FROM base GROUP BY uid)
    SELECT u.uid, vi.nombre::text, vi.apellido::text,
           ROUND(COALESCE(t.horas, 0), 2),
           ROUND(COALESCE(uho.minutos_objetivo, so.minutos_objetivo) / 60.0, 2)
    FROM usuarios u
    JOIN v_interno_users vi ON vi.user_context_id = u.uid
    LEFT JOIN total t ON t.uid = u.uid
    LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = u.uid
    LEFT JOIN planificacion_snapshot_objetivo so
           ON so.snapshot_id = p_snapshot_id AND so.user_context_id = u.uid
    WHERE COALESCE(uho.minutos_objetivo, so.minutos_objetivo) IS NOT NULL
      AND COALESCE(t.horas, 0) < COALESCE(uho.minutos_objetivo, so.minutos_objetivo) / 60.0
    ORDER BY vi.apellido, vi.nombre
$$;

-- Plantilla semanal completa del snapshot contra el objetivo que regirá esa semana
-- (el de la planilla; si el usuario no lo trae, el pendiente o el vigente).
CREATE OR REPLACE FUNCTION snapshot_faltantes_proxima(p_snapshot_id bigint)
RETURNS TABLE (user_context_id integer, nombre text, apellido text, horas numeric, objetivo numeric)
LANGUAGE sql STABLE
AS $$
    WITH total AS (
        SELECT st.user_context_id AS uid,
               SUM(EXTRACT(EPOCH FROM (st.hora_out - st.hora_in)) / 3600.0) AS horas
        FROM planificacion_snapshot_turno st
        WHERE st.snapshot_id = p_snapshot_id
        GROUP BY st.user_context_id
    )
    SELECT t.uid, vi.nombre::text, vi.apellido::text, ROUND(t.horas, 2),
           ROUND(COALESCE(so.minutos_objetivo, uho.minutos_objetivo_pendiente, uho.minutos_objetivo) / 60.0, 2)
    FROM total t
    JOIN v_interno_users vi ON vi.user_context_id = t.uid
    LEFT JOIN planificacion_snapshot_objetivo so
           ON so.snapshot_id = p_snapshot_id AND so.user_context_id = t.uid
    LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = t.uid
    WHERE COALESCE(so.minutos_objetivo, uho.minutos_objetivo_pendiente, uho.minutos_objetivo) IS NOT NULL
      AND t.horas < COALESCE(so.minutos_objetivo, uho.minutos_objetivo_pendiente, uho.minutos_objetivo) / 60.0
    ORDER BY vi.apellido, vi.nombre
$$;

CREATE OR REPLACE FUNCTION snapshot_previsualizar(p_payload jsonb, p_usuario integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_errores text[];
    v_id bigint;
    v_hash text := md5(p_payload::text);
    v_expira timestamptz := now() + interval '30 minutes';
    v_diff jsonb;
    v_igual boolean;
BEGIN
    v_errores := snapshot_validar_payload(p_payload);
    IF array_length(v_errores, 1) > 0 THEN
        RETURN jsonb_build_object('ok', false, 'errores', to_jsonb(v_errores));
    END IF;

    UPDATE planificacion_snapshot SET estado = 'EXPIRADO'
    WHERE estado = 'PREVIEW' AND (expira_at < now() OR creado_por = p_usuario);

    INSERT INTO planificacion_snapshot (creado_por, expira_at, hash, estado)
    VALUES (p_usuario, v_expira, v_hash, 'PREVIEW')
    RETURNING id INTO v_id;

    INSERT INTO planificacion_snapshot_turno
        (snapshot_id, user_context_id, dia_semana, turno, hora_in, hora_out, sede_id)
    SELECT v_id, t.user_context_id, t.dia_semana, t.turno::turno_enum, t.hora_in::time, t.hora_out::time, t.sede_id
    FROM jsonb_to_recordset(p_payload->'turnos')
        AS t(user_context_id int, dia_semana int, turno text, hora_in text, hora_out text, sede_id int);

    IF jsonb_typeof(p_payload->'objetivos') = 'array' THEN
        INSERT INTO planificacion_snapshot_objetivo (snapshot_id, user_context_id, minutos_objetivo)
        SELECT v_id, o.user_context_id, ROUND(o.horas * 60)::int
        FROM jsonb_to_recordset(p_payload->'objetivos') AS o(user_context_id int, horas numeric);
    END IF;

    v_diff := snapshot_armar_diff_json(v_id);
    UPDATE planificacion_snapshot SET diff = v_diff WHERE id = v_id;

    SELECT EXISTS (SELECT 1 FROM planificacion_snapshot WHERE estado = 'ACTIVO' AND hash = v_hash) INTO v_igual;

    RETURN jsonb_build_object('ok', true, 'snapshotId', v_id, 'expiraAt', v_expira,
                              'igualAlVigente', v_igual) || v_diff;
END;
$$;

-- Aplica un snapshot en PREVIEW de forma atómica. Reevalúa la regla de 2 h al momento de
-- confirmar. p_notificar=true encola un aviso por usuario afectado (excepto el actor).
CREATE OR REPLACE FUNCTION snapshot_aplicar(p_snapshot_id bigint, p_usuario integer, p_notificar boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_snap planificacion_snapshot%ROWTYPE;
    v_altas int; v_modificaciones int; v_bajas int; v_omitidos int;
    v_afectados int[];
BEGIN
    PERFORM pg_advisory_xact_lock(7305101); -- serializa publish y generación semanal

    SELECT * INTO v_snap FROM planificacion_snapshot WHERE id = p_snapshot_id FOR UPDATE;
    IF NOT FOUND OR v_snap.estado <> 'PREVIEW' THEN
        RAISE EXCEPTION 'SNAPSHOT_INVALIDO: el preview no existe o ya fue confirmado.' USING ERRCODE = 'P0001';
    END IF;
    IF v_snap.creado_por <> p_usuario THEN
        RAISE EXCEPTION 'SNAPSHOT_INVALIDO: el preview pertenece a otro usuario.' USING ERRCODE = 'P0001';
    END IF;
    IF v_snap.expira_at < now() THEN
        UPDATE planificacion_snapshot SET estado = 'EXPIRADO' WHERE id = p_snapshot_id;
        RAISE EXCEPTION 'SNAPSHOT_EXPIRADO: el preview venció, generá uno nuevo.' USING ERRCODE = 'P0001';
    END IF;

    DROP TABLE IF EXISTS _snap_diff;
    CREATE TEMP TABLE _snap_diff ON COMMIT DROP AS
        SELECT * FROM snapshot_calcular_diff(p_snapshot_id);

    DELETE FROM planificacion_diaria pd
    USING _snap_diff d
    WHERE d.accion = 'baja' AND pd.id = d.old_id
      AND pd.marcado_in_at IS NULL AND pd.marcado_out_at IS NULL;

    UPDATE planificacion_diaria pd
    SET esperado_in = d.new_in, esperado_out = d.new_out,
        sede_id_in = d.new_sede, sede_id_out = d.new_sede,
        modificado_manualmente = false, horario_corrido = false
    FROM _snap_diff d
    WHERE d.accion = 'modificacion' AND pd.id = d.old_id;

    -- El feriado de un día ya marcado se hereda a las altas del mismo día y turno.
    INSERT INTO planificacion_diaria
        (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out, licencia, feriado)
    SELECT d.user_context_id, d.turno, d.new_in, d.new_out, d.new_sede, d.new_sede, false,
           COALESCE((SELECT bool_or(p2.feriado) FROM planificacion_diaria p2
                     WHERE DATE(p2.esperado_in) = d.fecha AND p2.turno = d.turno), false)
    FROM _snap_diff d
    WHERE d.accion = 'alta'
    ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING;

    -- Objetivo: usuario nuevo → vigente de inmediato; existente → queda pendiente hasta la
    -- próxima generación semanal (NULL si coincide con el vigente).
    INSERT INTO usuarios_horas_objetivo (user_context_id, minutos_objetivo)
    SELECT so.user_context_id, so.minutos_objetivo
    FROM planificacion_snapshot_objetivo so WHERE so.snapshot_id = p_snapshot_id
    ON CONFLICT (user_context_id) DO UPDATE
    SET minutos_objetivo_pendiente = CASE
            WHEN EXCLUDED.minutos_objetivo = usuarios_horas_objetivo.minutos_objetivo THEN NULL
            ELSE EXCLUDED.minutos_objetivo END,
        updated_at = now();

    UPDATE planificacion_snapshot SET estado = 'REEMPLAZADO' WHERE estado = 'ACTIVO';
    UPDATE planificacion_snapshot SET estado = 'ACTIVO', aplicado_at = now(), expira_at = NULL
    WHERE id = p_snapshot_id;

    SELECT count(*) FILTER (WHERE accion = 'alta'),
           count(*) FILTER (WHERE accion = 'modificacion'),
           count(*) FILTER (WHERE accion = 'baja'),
           count(*) FILTER (WHERE accion = 'omitido')
    INTO v_altas, v_modificaciones, v_bajas, v_omitidos
    FROM _snap_diff;

    SELECT COALESCE(array_agg(DISTINCT user_context_id), ARRAY[]::int[]) INTO v_afectados
    FROM _snap_diff
    WHERE accion IN ('alta', 'modificacion', 'baja') AND user_context_id <> p_usuario;

    IF p_notificar AND array_length(v_afectados, 1) > 0 THEN
        INSERT INTO notificaciones_pendientes (user_context_id, tipo, payload, dedupe_key)
        SELECT u, 'turnos_actualizados_masivo',
               jsonb_build_object(
                   'title', 'Horarios actualizados',
                   'body', 'Tu planificación de turnos fue actualizada.',
                   'data', jsonb_build_object('type', 'turnos_actualizados_masivo', 'domain', 'horarios', 'event', 'updated')),
               'snapshot:' || p_snapshot_id || ':' || u
        FROM unnest(v_afectados) u
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'snapshotId', p_snapshot_id,
        'altas', v_altas, 'modificaciones', v_modificaciones, 'bajas', v_bajas, 'omitidos', v_omitidos,
        'usuariosAfectados', to_jsonb(v_afectados));
END;
$$;

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
    SET minutos_objetivo = minutos_objetivo_pendiente, minutos_objetivo_pendiente = NULL, updated_at = now()
    WHERE minutos_objetivo_pendiente IS NOT NULL;
    GET DIAGNOSTICS v_promovidos = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'lunes', v_lunes, 'snapshotId', v_snapshot_id,
                              'generados', v_generados, 'objetivosPromovidos', v_promovidos,
                              'faltantes', v_faltantes);
END;
$$;


COMMIT;
