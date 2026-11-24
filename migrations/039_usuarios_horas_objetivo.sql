BEGIN;

CREATE TABLE IF NOT EXISTS usuarios_horas_objetivo (
    user_context_id INTEGER PRIMARY KEY,
    horas_objetivo  INTEGER NOT NULL CHECK (horas_objetivo >= 0), -- deciHoras (horas × 10)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed desde la relación actual antes de dropearla (tolera ambas convenciones 'medio'/'medio_tiempo').
INSERT INTO usuarios_horas_objetivo (user_context_id, horas_objetivo)
SELECT vi.user_context_id,
       CASE WHEN LOWER(TRIM(p.relacion)) IN ('medio','medio_tiempo') THEN 240 ELSE 480 END
FROM personal p
JOIN v_interno_users vi ON vi.id_entidad = p.id_empleado
WHERE p.deleted_at IS NULL
ON CONFLICT (user_context_id) DO NOTHING;

ALTER TABLE personal DROP COLUMN IF EXISTS relacion;

COMMIT;
