-- Funciones de la planificación vía snapshot (ver docs/ADR-008). n8n solo orquesta: la
-- validación, la regla de 2 h y la escritura atómica viven acá.
--
-- Convenciones:
--  * esperado_in/out son TIMESTAMP sin zona en hora local AR: "ahora" siempre se toma con
--    AT TIME ZONE 'America/Argentina/Buenos_Aires', nunca now() pelado (dev puede estar en UTC).
--  * Las funciones públicas son SECURITY DEFINER: el rol de n8n solo necesita EXECUTE.
--  * horas_trabajadas ya no se escribe (queda en su default 0).

CREATE OR REPLACE FUNCTION planificacion_ahora_ar()
RETURNS timestamp
LANGUAGE sql STABLE
AS $$ SELECT now() AT TIME ZONE 'America/Argentina/Buenos_Aires' $$;

-- Ventana editable por un publish: de hoy al sábado de la semana en curso. Los domingos
-- la semana en curso ya terminó, así que la ventana es la semana siguiente completa.
CREATE OR REPLACE FUNCTION planificacion_ventana(p_ahora timestamp DEFAULT planificacion_ahora_ar())
RETURNS TABLE (desde date, hasta date, lunes date)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_hoy date := p_ahora::date;
    v_dow int  := EXTRACT(ISODOW FROM p_ahora::date);
BEGIN
    IF v_dow = 7 THEN
        lunes := v_hoy + 1;
        desde := lunes;
    ELSE
        lunes := v_hoy - (v_dow - 1);
        desde := v_hoy;
    END IF;
    hasta := lunes + 5;
    RETURN NEXT;
END;
$$;

-- Clasifica cada turno (usuario, turno, fecha) de la ventana comparando el snapshot con
-- planificacion_diaria. Solo considera usuarios con turnos en el snapshot y turnos
-- Mañana/Tarde (los Rotativo se cargan a mano y nunca se tocan).
--
-- accion: sin_cambio | alta | modificacion | baja | omitido
-- motivo (solo omitido): 2H (turno viejo empieza en menos de 2 h, ya empezó o ya pasó),
--   MARCADO (ya tiene marcado), LICENCIA (fila con licencia o solapada con una solicitud
--   APROBADA: se cambia a mano). La regla de 2 h usa el turno VIEJO; un turno nuevo sin
--   viejo usa su propio inicio.
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
               pd.licencia, pd.horario_corrido, pd.marcado_in_at, pd.marcado_out_at
        FROM planificacion_diaria pd
        JOIN usuarios u ON u.uid = pd.user_context_id
        WHERE pd.turno IN ('Mañana', 'Tarde')
          AND DATE(pd.esperado_in) BETWEEN v_desde AND v_hasta
    ),
    par AS (
        SELECT COALESCE(n.uid, v.uid) AS uid,
               COALESCE(n.turno, v.turno) AS turno,
               COALESCE(n.fecha, v.fecha) AS fecha,
               v.id AS old_id, v.esperado_in AS old_in, v.esperado_out AS old_out,
               v.sede_id_in AS old_sede_in, v.sede_id_out AS old_sede_out,
               v.horario_corrido AS old_corrido, v.licencia AS old_licencia,
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
                  AND sa.fecha_inicio < p.new_out AND sa.fecha_fin > p.new_in
            ) THEN 'LICENCIA'
            ELSE NULL
        END AS motivo,
        p.old_id, p.old_in, p.old_out, p.old_sede_in, p.old_sede_out, p.old_corrido,
        p.new_in, p.new_out, p.new_sede
    FROM par p;
END;
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
           ROUND(COALESCE(uho.horas_objetivo, so.horas_objetivo) / 10.0, 2)
    FROM usuarios u
    JOIN v_interno_users vi ON vi.user_context_id = u.uid
    LEFT JOIN total t ON t.uid = u.uid
    LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = u.uid
    LEFT JOIN planificacion_snapshot_objetivo so
           ON so.snapshot_id = p_snapshot_id AND so.user_context_id = u.uid
    WHERE COALESCE(uho.horas_objetivo, so.horas_objetivo) IS NOT NULL
      AND COALESCE(t.horas, 0) < COALESCE(uho.horas_objetivo, so.horas_objetivo) / 10.0
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
           ROUND(COALESCE(so.horas_objetivo, uho.horas_objetivo_pendiente, uho.horas_objetivo) / 10.0, 2)
    FROM total t
    JOIN v_interno_users vi ON vi.user_context_id = t.uid
    LEFT JOIN planificacion_snapshot_objetivo so
           ON so.snapshot_id = p_snapshot_id AND so.user_context_id = t.uid
    LEFT JOIN usuarios_horas_objetivo uho ON uho.user_context_id = t.uid
    WHERE COALESCE(so.horas_objetivo, uho.horas_objetivo_pendiente, uho.horas_objetivo) IS NOT NULL
      AND t.horas < COALESCE(so.horas_objetivo, uho.horas_objetivo_pendiente, uho.horas_objetivo) / 10.0
    ORDER BY vi.apellido, vi.nombre
$$;

-- Diff + faltantes de un snapshot como jsonb (lo que ve el usuario antes de confirmar).
CREATE OR REPLACE FUNCTION snapshot_armar_diff_json(p_snapshot_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    WITH diff AS (SELECT * FROM snapshot_calcular_diff(p_snapshot_id)),
    detalle AS (
        SELECT jsonb_agg(jsonb_build_object(
                   'userContextId', d.user_context_id,
                   'nombre', vi.nombre, 'apellido', vi.apellido,
                   'fecha', d.fecha, 'turno', d.turno,
                   'accion', d.accion, 'motivo', d.motivo,
                   'antes', CASE WHEN d.old_id IS NULL THEN NULL
                                 ELSE jsonb_build_object('in', to_char(d.old_in, 'HH24:MI'),
                                      'out', to_char(d.old_out, 'HH24:MI'),
                                      'sede', d.old_sede_in, 'horarioCorrido', d.old_corrido) END,
                   'despues', CASE WHEN d.new_in IS NULL THEN NULL
                                   ELSE jsonb_build_object('in', to_char(d.new_in, 'HH24:MI'),
                                        'out', to_char(d.new_out, 'HH24:MI'), 'sede', d.new_sede) END
               ) ORDER BY vi.apellido, vi.nombre, d.fecha, d.turno) AS items
        FROM diff d
        JOIN v_interno_users vi ON vi.user_context_id = d.user_context_id
        WHERE d.accion <> 'sin_cambio'
    )
    SELECT jsonb_build_object(
        'resumen', jsonb_build_object(
            'altas', (SELECT count(*) FROM diff WHERE accion = 'alta'),
            'modificaciones', (SELECT count(*) FROM diff WHERE accion = 'modificacion'),
            'bajas', (SELECT count(*) FROM diff WHERE accion = 'baja'),
            'sinCambios', (SELECT count(*) FROM diff WHERE accion = 'sin_cambio'),
            'omitidos2h', (SELECT count(*) FROM diff WHERE accion = 'omitido' AND motivo IN ('2H', 'MARCADO')),
            'omitidosLicencia', (SELECT count(*) FROM diff WHERE accion = 'omitido' AND motivo = 'LICENCIA')
        ),
        'detalle', COALESCE((SELECT items FROM detalle), '[]'::jsonb),
        'faltantes', jsonb_build_object(
            'semanaActual', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM snapshot_faltantes_actual(p_snapshot_id) f), '[]'::jsonb),
            'proximaSemana', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM snapshot_faltantes_proxima(p_snapshot_id) f), '[]'::jsonb)
        ),
        'usuariosSinTurnos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('userContextId', x.user_context_id, 'nombre', vi.nombre, 'apellido', vi.apellido))
            FROM (
                SELECT DISTINCT st.user_context_id
                FROM planificacion_snapshot_turno st
                JOIN planificacion_snapshot s ON s.id = st.snapshot_id AND s.estado = 'ACTIVO'
                WHERE NOT EXISTS (
                    SELECT 1 FROM planificacion_snapshot_turno n
                    WHERE n.snapshot_id = p_snapshot_id AND n.user_context_id = st.user_context_id
                )
            ) x
            JOIN v_interno_users vi ON vi.user_context_id = x.user_context_id
        ), '[]'::jsonb)
    )
$$;

-- Valida el payload de n8n y devuelve los errores (vacío = OK).
-- payload: { "turnos": [{user_context_id, dia_semana 1-6, turno, hora_in "HH:MM", hora_out, sede_id}],
--            "objetivos": [{user_context_id, horas}] }
CREATE OR REPLACE FUNCTION snapshot_validar_payload(p_payload jsonb)
RETURNS text[]
LANGUAGE plpgsql -- VOLATILE: usa una tabla temporal
AS $$
DECLARE
    v_errores text[] := ARRAY[]::text[];
    v_hora_re constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
    v_activos int;
    v_nuevos int;
BEGIN
    IF p_payload IS NULL OR jsonb_typeof(p_payload->'turnos') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_payload->'turnos') = 0 THEN
        RETURN ARRAY['La planilla no tiene turnos.'];
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _snap_val_turnos (
        user_context_id int, dia_semana int, turno text, hora_in text, hora_out text, sede_id int
    ) ON COMMIT DROP;
    TRUNCATE _snap_val_turnos;
    INSERT INTO _snap_val_turnos
    SELECT * FROM jsonb_to_recordset(p_payload->'turnos')
        AS t(user_context_id int, dia_semana int, turno text, hora_in text, hora_out text, sede_id int);

    v_errores := v_errores || ARRAY(
        SELECT DISTINCT format('Usuario %s inexistente o dado de baja.', t.user_context_id)
        FROM _snap_val_turnos t
        WHERE NOT EXISTS (SELECT 1 FROM v_interno_users vi WHERE vi.user_context_id = t.user_context_id));

    v_errores := v_errores || ARRAY(
        SELECT format('Usuario %s: turno inválido "%s" (se esperaba Mañana o Tarde).', t.user_context_id, COALESCE(t.turno, ''))
        FROM _snap_val_turnos t WHERE t.turno IS NULL OR t.turno NOT IN ('Mañana', 'Tarde'));

    v_errores := v_errores || ARRAY(
        SELECT format('Usuario %s: día de semana inválido (%s).', t.user_context_id, COALESCE(t.dia_semana::text, ''))
        FROM _snap_val_turnos t WHERE t.dia_semana IS NULL OR t.dia_semana NOT BETWEEN 1 AND 6);

    v_errores := v_errores || ARRAY(
        SELECT format('Usuario %s, día %s: horario inválido (%s - %s).', t.user_context_id, t.dia_semana,
                      COALESCE(t.hora_in, ''), COALESCE(t.hora_out, ''))
        FROM _snap_val_turnos t
        WHERE t.hora_in IS NULL OR t.hora_out IS NULL
           OR t.hora_in !~ v_hora_re OR t.hora_out !~ v_hora_re
           OR (t.hora_in ~ v_hora_re AND t.hora_out ~ v_hora_re AND t.hora_out::time <= t.hora_in::time));

    v_errores := v_errores || ARRAY(
        SELECT DISTINCT format('Usuario %s: sede %s inexistente o inactiva.', t.user_context_id, COALESCE(t.sede_id::text, ''))
        FROM _snap_val_turnos t
        WHERE NOT EXISTS (SELECT 1 FROM sedes s WHERE s.id = t.sede_id AND s.activo));

    v_errores := v_errores || ARRAY(
        SELECT format('Usuario %s, día %s: turno %s duplicado.', t.user_context_id, t.dia_semana, t.turno)
        FROM _snap_val_turnos t
        GROUP BY t.user_context_id, t.dia_semana, t.turno HAVING count(*) > 1);

    v_errores := v_errores || ARRAY(
        SELECT format('Usuario %s, día %s: los turnos Mañana y Tarde se solapan.', m.user_context_id, m.dia_semana)
        FROM _snap_val_turnos m
        JOIN _snap_val_turnos t ON t.user_context_id = m.user_context_id AND t.dia_semana = m.dia_semana
        WHERE m.turno = 'Mañana' AND t.turno = 'Tarde'
          AND m.hora_out ~ v_hora_re AND t.hora_in ~ v_hora_re
          AND t.hora_in::time < m.hora_out::time);

    IF jsonb_typeof(p_payload->'objetivos') = 'array' THEN
        v_errores := v_errores || ARRAY(
            SELECT format('Objetivo del usuario %s inválido (%s horas).', o.user_context_id, COALESCE(o.horas::text, ''))
            FROM jsonb_to_recordset(p_payload->'objetivos') AS o(user_context_id int, horas numeric)
            WHERE o.user_context_id IS NULL OR o.horas IS NULL OR o.horas < 0 OR o.horas > 168
               OR NOT EXISTS (SELECT 1 FROM v_interno_users vi WHERE vi.user_context_id = o.user_context_id));
    END IF;

    -- Guarda anti-borrado: no se acepta una planilla con menos de la mitad de los turnos
    -- del snapshot activo.
    SELECT count(*) INTO v_activos
    FROM planificacion_snapshot_turno st
    JOIN planificacion_snapshot s ON s.id = st.snapshot_id AND s.estado = 'ACTIVO';
    SELECT count(*) INTO v_nuevos FROM _snap_val_turnos;
    IF v_activos > 0 AND v_nuevos * 2 < v_activos THEN
        v_errores := v_errores || format(
            'La planilla tiene %s turnos y la vigente %s: parece que se borró contenido. Revisá la planilla.',
            v_nuevos, v_activos);
    END IF;

    RETURN v_errores;
END;
$$;

-- Crea el snapshot en PREVIEW y devuelve el diff. No toca planificacion_diaria.
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
        INSERT INTO planificacion_snapshot_objetivo (snapshot_id, user_context_id, horas_objetivo)
        SELECT v_id, o.user_context_id, ROUND(o.horas * 10)::int
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
    INSERT INTO usuarios_horas_objetivo (user_context_id, horas_objetivo)
    SELECT so.user_context_id, so.horas_objetivo
    FROM planificacion_snapshot_objetivo so WHERE so.snapshot_id = p_snapshot_id
    ON CONFLICT (user_context_id) DO UPDATE
    SET horas_objetivo_pendiente = CASE
            WHEN EXCLUDED.horas_objetivo = usuarios_horas_objetivo.horas_objetivo THEN NULL
            ELSE EXCLUDED.horas_objetivo END,
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

-- Genera la semana siguiente (o la que empieza en p_lunes) desde el snapshot ACTIVO.
-- Idempotente: no pisa lo existente. Promueve los objetivos pendientes. No notifica.
-- Devuelve además los usuarios cuya semana queda por debajo del objetivo (alerta al admin).
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

-- Solo el dueño y los roles a los que se les otorgue EXECUTE (p. ej. el rol de n8n).
-- Ejemplo (no se ejecuta acá porque el rol depende del entorno):
--   GRANT EXECUTE ON FUNCTION snapshot_previsualizar(jsonb, integer),
--                              snapshot_aplicar(bigint, integer, boolean),
--                              generar_semana_desde_snapshot(date) TO n8n_planificacion;
REVOKE ALL ON FUNCTION snapshot_previsualizar(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION snapshot_aplicar(bigint, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION generar_semana_desde_snapshot(date) FROM PUBLIC;
