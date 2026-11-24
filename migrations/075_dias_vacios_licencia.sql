-- Días sin turnos como licencia. Un usuario con objetivo (usuarios_horas_objetivo) que un día
-- (lunes a sábado) no tiene turnos recibe dos turnos sintéticos con licencia = true y generica = true.
-- Cada uno guarda en minutos_licencia la mitad de la jornada (jornada_corrido_minutos: 8 h o 4 h), de
-- modo que el descuento del objetivo semanal sale de la misma suma de minutos_licencia que ya usan
-- la proyección semanal y el resumen semanal, sin tabla paralela. Horarios sintéticos: 8-12 y 16-20
-- (limpieza: 7-9 y 20-22); no se usan para calcular nada.
-- Las licencias por días (vacaciones) que cubren todos los turnos de un día también descuentan la
-- jornada de ese día. El objetivo efectivo nunca es negativo: GREATEST(0, objetivo - minutos_licencia).
-- snapshot_calcular_diff ignora las filas genéricas y los turnos reales las reemplazan.
BEGIN;

ALTER TABLE planificacion_diaria
    ADD COLUMN IF NOT EXISTS generica BOOLEAN NOT NULL DEFAULT false;

-- Marca como licencia los días de lunes a sábado entre p_desde y p_hasta sin ningún turno real.
CREATE OR REPLACE FUNCTION planificacion_marcar_dias_vacios(p_desde date, p_hasta date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_insertadas int;
BEGIN
    INSERT INTO planificacion_diaria
        (user_context_id, turno, esperado_in, esperado_out, licencia, minutos_licencia, generica, feriado)
    SELECT uho.user_context_id, t.turno,
           d.fecha + CASE WHEN vi.rol_nombre = 'empleado-limpieza' THEN t.limpieza_in ELSE t.general_in END,
           d.fecha + CASE WHEN vi.rol_nombre = 'empleado-limpieza' THEN t.limpieza_out ELSE t.general_out END,
           true,
           jornada_corrido_minutos(uho.minutos_objetivo) / 2,
           true,
           COALESCE((SELECT bool_or(p2.feriado) FROM planificacion_diaria p2
                     WHERE DATE(p2.esperado_in) = d.fecha), false)
    FROM usuarios_horas_objetivo uho
    JOIN v_interno_users vi ON vi.user_context_id = uho.user_context_id
    CROSS JOIN (SELECT g::date AS fecha FROM generate_series(p_desde, p_hasta, interval '1 day') g) d
    CROSS JOIN (VALUES
        ('Mañana'::turno_enum, time '08:00', time '12:00', time '07:00', time '09:00'),
        ('Tarde'::turno_enum,  time '16:00', time '20:00', time '20:00', time '22:00')
    ) AS t(turno, general_in, general_out, limpieza_in, limpieza_out)
    WHERE EXTRACT(ISODOW FROM d.fecha) BETWEEN 1 AND 6
      AND NOT EXISTS (
          SELECT 1 FROM planificacion_diaria p
          WHERE p.user_context_id = uho.user_context_id
            AND DATE(p.esperado_in) = d.fecha
            AND NOT p.generica)
    ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING;

    GET DIAGNOSTICS v_insertadas = ROW_COUNT;
    RETURN v_insertadas;
END;
$$;

REVOKE ALL ON FUNCTION planificacion_marcar_dias_vacios(date, date) FROM PUBLIC;

-- La rama por días de aplicar_licencia descuenta la jornada de los días que cubre por completo.
CREATE OR REPLACE FUNCTION aplicar_licencia(p_solicitud_id integer, p_turno_ids bigint[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_sol solicitudes_ausencia%ROWTYPE;
    v_t record;
    v_solape int;
    v_total int := 0;
    v_saldo record;
    v_marcados bigint[];
BEGIN
    SELECT * INTO v_sol FROM solicitudes_ausencia
    WHERE id = p_solicitud_id AND estado = 'APROBADA' AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF v_sol.cantidad_minutos IS NULL THEN
        WITH upd AS (
            UPDATE planificacion_diaria pd
            SET licencia = true
            WHERE pd.user_context_id = v_sol.usuario_id
              AND pd.licencia = false
              AND (p_turno_ids IS NULL OR pd.id = ANY (p_turno_ids))
              AND pd.esperado_in >= v_sol.fecha_inicio
              AND planificacion_fin_turno(pd.id) <= v_sol.fecha_fin
            RETURNING pd.id
        )
        SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]) INTO v_marcados FROM upd;

        -- Un día con todos sus turnos en licencia descuenta la jornada del objetivo semanal,
        -- repartida entre sus turnos (el resto, al primero). Los días con licencia por horas ya
        -- aplicada o con algún turno sin licencia no se tocan.
        UPDATE planificacion_diaria pd
        SET minutos_licencia = x.parte
        FROM (
            SELECT t.id,
                   j.minutos / t.n + CASE WHEN t.rn = 1 THEN j.minutos % t.n ELSE 0 END AS parte
            FROM (
                SELECT p.id,
                       row_number() OVER (PARTITION BY DATE(p.esperado_in) ORDER BY p.esperado_in, p.id) AS rn,
                       count(*) OVER (PARTITION BY DATE(p.esperado_in)) AS n,
                       bool_and(p.licencia) OVER (PARTITION BY DATE(p.esperado_in)) AS todos,
                       sum(p.minutos_licencia) OVER (PARTITION BY DATE(p.esperado_in)) AS previos
                FROM planificacion_diaria p
                WHERE p.user_context_id = v_sol.usuario_id
                  AND NOT p.generica
                  AND DATE(p.esperado_in) IN (SELECT DATE(m.esperado_in) FROM planificacion_diaria m
                                              WHERE m.id = ANY (v_marcados))
            ) t
            CROSS JOIN (
                SELECT jornada_corrido_minutos((SELECT uho.minutos_objetivo FROM usuarios_horas_objetivo uho
                                                WHERE uho.user_context_id = v_sol.usuario_id)) AS minutos
            ) j
            WHERE t.todos AND t.previos = 0
        ) x
        WHERE pd.id = x.id;
        RETURN 0;
    END IF;

    FOR v_t IN
        SELECT t.id, t.esperado_in, t.esperado_out, t.fin
        FROM (
            SELECT pd.id, pd.esperado_in, pd.esperado_out, planificacion_fin_turno(pd.id) AS fin
            FROM planificacion_diaria pd
            WHERE pd.user_context_id = v_sol.usuario_id
              AND pd.licencia = false
              AND pd.esperado_in IS NOT NULL
              AND (p_turno_ids IS NULL OR pd.id = ANY (p_turno_ids))
            FOR UPDATE OF pd
        ) t
        WHERE t.esperado_in < v_sol.fecha_fin AND t.fin > v_sol.fecha_inicio
        ORDER BY t.esperado_in
    LOOP
        v_solape := ROUND(EXTRACT(EPOCH FROM (LEAST(v_t.fin, v_sol.fecha_fin)
                                              - GREATEST(v_t.esperado_in, v_sol.fecha_inicio))) / 60.0)::int;
        CONTINUE WHEN v_solape <= 0;

        UPDATE planificacion_diaria
        SET minutos_licencia = minutos_licencia + v_solape,
            licencia = (v_sol.fecha_inicio <= v_t.esperado_in AND v_sol.fecha_fin >= v_t.fin),
            esperado_in = CASE WHEN v_sol.fecha_inicio <= v_t.esperado_in AND v_sol.fecha_fin < v_t.fin
                               THEN v_sol.fecha_fin ELSE esperado_in END,
            esperado_out = CASE WHEN v_t.esperado_out IS NOT NULL
                                 AND v_sol.fecha_inicio > v_t.esperado_in AND v_sol.fecha_fin >= v_t.esperado_out
                                THEN v_sol.fecha_inicio ELSE esperado_out END
        WHERE id = v_t.id;

        v_total := v_total + v_solape;
    END LOOP;

    -- Franco (tipo 2) por horas: consume el solape del saldo. El franco del sábado después de
    -- las 13 (mismo día) no se descuenta.
    IF v_total > 0 AND v_sol.tipo_licencia_id = 2
       AND NOT (DATE(v_sol.fecha_inicio) = DATE(v_sol.fecha_fin)
                AND EXTRACT(ISODOW FROM v_sol.fecha_inicio) = 6
                AND v_sol.fecha_inicio::time >= time '13:00') THEN
        INSERT INTO saldos_francos (user_context_id, minutos_disponibles, minutos_consumidos, updated_at)
        VALUES (v_sol.usuario_id, 0, v_total, now())
        ON CONFLICT (user_context_id) DO UPDATE
          SET minutos_consumidos = saldos_francos.minutos_consumidos + EXCLUDED.minutos_consumidos,
              updated_at         = now()
        RETURNING minutos_disponibles, minutos_consumidos INTO v_saldo;

        INSERT INTO saldos_francos_movimientos
          (user_context_id, tipo_movimiento, minutos,
           minutos_disponibles_resultante, minutos_consumidos_resultante, solicitud_ausencia_id)
        VALUES (v_sol.usuario_id, 'consumo', v_total, v_saldo.minutos_disponibles, v_saldo.minutos_consumidos, v_sol.id);
    END IF;

    RETURN v_total;
END;
$$;

-- revertir_licencia no toca las filas genéricas y repone minutos_licencia de la rama por días.
CREATE OR REPLACE FUNCTION revertir_licencia(p_solicitud_id integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_sol solicitudes_ausencia%ROWTYPE;
    v_t record;
    v_compartido boolean;
    v_plan_in timestamp;
    v_plan_out timestamp;
    v_in timestamp;
    v_out timestamp;
    v_solape int;
    v_revertidos int := 0;
BEGIN
    SELECT * INTO v_sol FROM solicitudes_ausencia WHERE id = p_solicitud_id;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF v_sol.cantidad_minutos IS NULL THEN
        UPDATE planificacion_diaria pd
        SET licencia = false, minutos_licencia = 0
        WHERE pd.user_context_id = v_sol.usuario_id
          AND pd.licencia = true
          AND NOT pd.generica
          AND pd.esperado_in >= v_sol.fecha_inicio
          AND planificacion_fin_turno(pd.id) <= v_sol.fecha_fin;
        GET DIAGNOSTICS v_revertidos = ROW_COUNT;
        RETURN v_revertidos;
    END IF;

    FOR v_t IN
        SELECT pd.id, pd.turno, pd.esperado_in, pd.esperado_out, pd.licencia, pd.minutos_licencia,
               planificacion_fin_turno(pd.id) AS fin
        FROM planificacion_diaria pd
        WHERE pd.user_context_id = v_sol.usuario_id
          AND pd.minutos_licencia > 0
          AND NOT pd.generica
          AND pd.esperado_in <= v_sol.fecha_fin
          AND planificacion_fin_turno(pd.id) >= v_sol.fecha_inicio
        FOR UPDATE OF pd
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM solicitudes_ausencia sa
            WHERE sa.usuario_id = v_sol.usuario_id AND sa.id <> v_sol.id
              AND sa.estado IN ('APROBADA', 'CONSUMIDA') AND sa.deleted_at IS NULL
              AND sa.cantidad_minutos IS NOT NULL
              AND sa.fecha_inicio <= v_t.fin AND sa.fecha_fin >= v_t.esperado_in
        ) INTO v_compartido;

        IF NOT v_compartido THEN
            -- Única licencia del turno: minutos_licencia es todo lo que recortó.
            UPDATE planificacion_diaria
            SET esperado_in = CASE WHEN NOT v_t.licencia AND v_t.esperado_in = v_sol.fecha_fin
                                   THEN esperado_in - make_interval(mins => v_t.minutos_licencia)
                                   ELSE esperado_in END,
                esperado_out = CASE WHEN NOT v_t.licencia AND v_t.esperado_out = v_sol.fecha_inicio
                                    THEN esperado_out + make_interval(mins => v_t.minutos_licencia)
                                    ELSE esperado_out END,
                licencia = false,
                minutos_licencia = 0
            WHERE id = v_t.id;
        ELSE
            SELECT DATE(v_t.esperado_in) + st.hora_in, DATE(v_t.esperado_in) + st.hora_out
            INTO v_plan_in, v_plan_out
            FROM planificacion_snapshot_turno st
            JOIN planificacion_snapshot s ON s.id = st.snapshot_id AND s.estado = 'ACTIVO'
            WHERE st.user_context_id = v_sol.usuario_id
              AND st.turno = v_t.turno
              AND st.dia_semana = EXTRACT(ISODOW FROM v_t.esperado_in);

            v_in := CASE WHEN v_t.esperado_in = v_sol.fecha_fin THEN COALESCE(v_plan_in, v_t.esperado_in)
                         ELSE v_t.esperado_in END;
            v_out := CASE WHEN v_t.esperado_out = v_sol.fecha_inicio THEN COALESCE(v_plan_out, v_t.esperado_out)
                          ELSE v_t.esperado_out END;
            v_solape := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (
                            LEAST(COALESCE(v_out, v_t.fin), v_sol.fecha_fin)
                            - GREATEST(v_in, v_sol.fecha_inicio))) / 60.0)::int);

            UPDATE planificacion_diaria
            SET esperado_in = v_in,
                esperado_out = v_out,
                licencia = false,
                minutos_licencia = GREATEST(0, minutos_licencia - v_solape)
            WHERE id = v_t.id;
        END IF;

        v_revertidos := v_revertidos + 1;
    END LOOP;

    RETURN v_revertidos;
END;
$$;

-- snapshot_calcular_diff ignora las filas genéricas.
CREATE OR REPLACE FUNCTION snapshot_calcular_diff(
    p_snapshot_id bigint,
    p_ahora timestamp DEFAULT planificacion_ahora_ar()
)
RETURNS TABLE (
    user_context_id integer,
    turno turno_enum,
    fecha date,
    accion text,
    motivo text,
    old_id bigint,
    old_in timestamp,
    old_out timestamp,
    old_sede_in integer,
    old_sede_out integer,
    old_corrido boolean,
    new_in timestamp,
    new_out timestamp,
    new_sede integer
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_desde date;
    v_hasta date;
    v_corte timestamp := p_ahora + interval '2 hours';
BEGIN
    SELECT v.desde, v.hasta INTO v_desde, v_hasta FROM planificacion_ventana(p_ahora) v;

    RETURN QUERY
    WITH usuarios AS (
        SELECT DISTINCT st.user_context_id AS uid
        FROM planificacion_snapshot_turno st
        WHERE st.snapshot_id = p_snapshot_id
    ),
    nuevos AS (
        SELECT st.user_context_id AS uid, st.turno AS turno, (v_desde + g)::date AS fecha,
               (v_desde + g) + st.hora_in AS esperado_in,
               (v_desde + g) + st.hora_out AS esperado_out,
               st.sede_id AS sede
        FROM planificacion_snapshot_turno st
        CROSS JOIN generate_series(0, v_hasta - v_desde) g
        WHERE st.snapshot_id = p_snapshot_id
          AND EXTRACT(ISODOW FROM v_desde + g) = st.dia_semana
    ),
    viejos AS (
        SELECT pd.id, pd.user_context_id AS uid, pd.turno AS turno, DATE(pd.esperado_in) AS fecha,
               pd.esperado_in, pd.esperado_out, pd.sede_id_in, pd.sede_id_out,
               pd.licencia, pd.minutos_licencia, pd.horario_corrido, pd.marcado_in_at, pd.marcado_out_at
        FROM planificacion_diaria pd
        JOIN usuarios u ON u.uid = pd.user_context_id
        WHERE pd.turno IN ('Mañana', 'Tarde')
          AND NOT pd.generica
          AND DATE(pd.esperado_in) BETWEEN v_desde AND v_hasta
    ),
    par AS (
        SELECT COALESCE(n.uid, v.uid) AS uid,
               COALESCE(n.turno, v.turno) AS turno,
               COALESCE(n.fecha, v.fecha) AS fecha,
               v.id AS old_id, v.esperado_in AS old_in, v.esperado_out AS old_out,
               v.sede_id_in AS old_sede_in, v.sede_id_out AS old_sede_out,
               v.horario_corrido AS old_corrido,
               (v.licencia OR v.minutos_licencia > 0) AS old_licencia,
               (v.marcado_in_at IS NOT NULL OR v.marcado_out_at IS NOT NULL) AS old_marcado,
               n.esperado_in AS new_in, n.esperado_out AS new_out, n.sede AS new_sede
        FROM nuevos n
        FULL JOIN viejos v ON v.uid = n.uid AND v.turno = n.turno AND v.fecha = n.fecha
    )
    SELECT p.uid, p.turno, p.fecha,
        CASE
            WHEN p.old_id IS NOT NULL AND p.new_in IS NOT NULL
                 AND p.old_in = p.new_in AND p.old_out IS NOT DISTINCT FROM p.new_out
                 AND p.old_sede_in IS NOT DISTINCT FROM p.new_sede
                 AND p.old_sede_out IS NOT DISTINCT FROM p.new_sede
                 AND NOT p.old_corrido THEN 'sin_cambio'
            WHEN p.old_id IS NOT NULL AND (p.old_in < v_corte OR p.old_marcado) THEN 'omitido'
            WHEN p.old_id IS NULL AND p.new_in < v_corte THEN 'omitido'
            WHEN p.old_id IS NOT NULL AND p.old_licencia THEN 'omitido'
            WHEN p.new_in IS NOT NULL AND EXISTS (
                SELECT 1 FROM solicitudes_ausencia sa
                WHERE sa.usuario_id = p.uid AND sa.estado = 'APROBADA' AND sa.deleted_at IS NULL
                  AND sa.cantidad_minutos IS NULL
                  AND sa.fecha_inicio < p.new_out AND sa.fecha_fin > p.new_in
            ) THEN 'omitido'
            WHEN p.old_id IS NULL THEN 'alta'
            WHEN p.new_in IS NULL THEN 'baja'
            ELSE 'modificacion'
        END AS accion,
        CASE
            WHEN p.old_id IS NOT NULL AND p.new_in IS NOT NULL
                 AND p.old_in = p.new_in AND p.old_out IS NOT DISTINCT FROM p.new_out
                 AND p.old_sede_in IS NOT DISTINCT FROM p.new_sede
                 AND p.old_sede_out IS NOT DISTINCT FROM p.new_sede
                 AND NOT p.old_corrido THEN NULL
            WHEN p.old_id IS NOT NULL AND p.old_in < v_corte THEN '2H'
            WHEN p.old_id IS NOT NULL AND p.old_marcado THEN 'MARCADO'
            WHEN p.old_id IS NULL AND p.new_in < v_corte THEN '2H'
            WHEN p.old_id IS NOT NULL AND p.old_licencia THEN 'LICENCIA'
            WHEN p.new_in IS NOT NULL AND EXISTS (
                SELECT 1 FROM solicitudes_ausencia sa
                WHERE sa.usuario_id = p.uid AND sa.estado = 'APROBADA' AND sa.deleted_at IS NULL
                  AND sa.cantidad_minutos IS NULL
                  AND sa.fecha_inicio < p.new_out AND sa.fecha_fin > p.new_in
            ) THEN 'LICENCIA'
            ELSE NULL
        END AS motivo,
        p.old_id, p.old_in, p.old_out, p.old_sede_in, p.old_sede_out, p.old_corrido,
        p.new_in, p.new_out, p.new_sede
    FROM par p;
END;
$$;

CREATE OR REPLACE FUNCTION snapshot_aplicar(p_snapshot_id bigint, p_usuario integer, p_notificar boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_snap planificacion_snapshot%ROWTYPE;
    v_altas int; v_modificaciones int; v_bajas int; v_omitidos int;
    v_afectados int[];
    v_turnos_ids bigint[];
    v_altas_ids bigint[];
    v_desde date; v_hasta date;
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

    WITH upd AS (
        UPDATE planificacion_diaria pd
        SET esperado_in = d.new_in, esperado_out = d.new_out,
            sede_id_in = d.new_sede, sede_id_out = d.new_sede,
            modificado_manualmente = false, horario_corrido = false
        FROM _snap_diff d
        WHERE d.accion = 'modificacion' AND pd.id = d.old_id
        RETURNING pd.id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]) INTO v_turnos_ids FROM upd;

    -- Los turnos sintéticos de un día sin turnos dejan paso a los reales.
    DELETE FROM planificacion_diaria g
    USING _snap_diff d
    WHERE d.accion = 'alta' AND g.generica
      AND g.user_context_id = d.user_context_id AND DATE(g.esperado_in) = d.fecha;

    -- El feriado de un día ya marcado se hereda a las altas del mismo día y turno.
    WITH ins AS (
        INSERT INTO planificacion_diaria
            (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out, licencia, feriado)
        SELECT d.user_context_id, d.turno, d.new_in, d.new_out, d.new_sede, d.new_sede, false,
               COALESCE((SELECT bool_or(p2.feriado) FROM planificacion_diaria p2
                         WHERE DATE(p2.esperado_in) = d.fecha AND p2.turno = d.turno), false)
        FROM _snap_diff d
        WHERE d.accion = 'alta'
        ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING
        RETURNING id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]) INTO v_altas_ids FROM ins;

    -- Turnos nuevos o modificados (sin licencia aplicada, si no se habrían omitido): se les
    -- aplican las licencias que los solapan.
    PERFORM aplicar_licencias_a_turnos(v_turnos_ids || v_altas_ids);

    -- Los días que quedaron sin turnos se marcan como licencia (y descuentan del objetivo).
    SELECT v.desde, v.hasta INTO v_desde, v_hasta FROM planificacion_ventana() v;
    PERFORM planificacion_marcar_dias_vacios(v_desde, v_hasta);

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
    v_ids bigint[];
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

    -- Si la semana se regenera, los turnos sintéticos de un día que la plantilla cubre se reemplazan.
    DELETE FROM planificacion_diaria g
    USING planificacion_snapshot_turno st
    WHERE st.snapshot_id = v_snapshot_id AND g.generica
      AND g.user_context_id = st.user_context_id
      AND DATE(g.esperado_in) = v_lunes + st.dia_semana - 1;

    WITH ins AS (
        INSERT INTO planificacion_diaria
            (user_context_id, turno, esperado_in, esperado_out, sede_id_in, sede_id_out)
        SELECT st.user_context_id, st.turno,
               (v_lunes + st.dia_semana - 1) + st.hora_in,
               (v_lunes + st.dia_semana - 1) + st.hora_out,
               st.sede_id, st.sede_id
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
        ON CONFLICT (user_context_id, turno, (DATE(esperado_in))) DO NOTHING
        RETURNING id
    )
    SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]), count(*) INTO v_ids, v_generados FROM ins;

    -- Licencias (por días y por horas) solo sobre los turnos recién insertados: regenerar la
    -- semana no vuelve a aplicarlas.
    PERFORM aplicar_licencias_a_turnos(v_ids);

    -- Días sin turnos de usuarios con objetivo: licencia, para que descuenten del objetivo.
    PERFORM planificacion_marcar_dias_vacios(v_lunes, v_lunes + 5);

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
