CREATE UNIQUE INDEX IF NOT EXISTS uq_planificacion_user_turno_dia
    ON planificacion_diaria (user_context_id, turno, (DATE(esperado_in)));
