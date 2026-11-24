-- Ledger append-only de movimientos de saldos_francos. saldos_francos solo guarda
-- balances corrientes (horas_disponibles / horas_consumidas) sin fecha ni historia;
-- esta tabla registra cada mutación para poder responder "horas extra en un rango".
-- Todas las cantidades están en deciHoras (horas × 10), enteros, como el resto del flujo.
-- cantidad es siempre una magnitud positiva; el signo se deriva de tipo_movimiento en las
-- consultas. Los movimientos son append-only: las correcciones son filas nuevas, nunca
-- UPDATE/DELETE.
BEGIN;

CREATE TABLE saldos_francos_movimientos (
    id                BIGSERIAL PRIMARY KEY,
    user_context_id   INTEGER NOT NULL,
    tipo_movimiento   TEXT NOT NULL
      CHECK (tipo_movimiento IN ('acreditacion','consumo','reintegro','liquidacion','ajuste_manual')),
    cantidad          INTEGER NOT NULL CHECK (cantidad >= 0),  -- deciHoras, magnitud positiva
    saldo_disponible_resultante INTEGER,   -- snapshot del balance tras el movimiento (auditoría)
    saldo_consumida_resultante  INTEGER,
    semana_inicio         DATE,            -- seteado para 'acreditacion'
    solicitud_ausencia_id INTEGER,         -- seteado para 'consumo' / 'reintegro'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sfm_user_fecha ON saldos_francos_movimientos (user_context_id, created_at);
CREATE INDEX idx_sfm_tipo_fecha ON saldos_francos_movimientos (tipo_movimiento, created_at);

ALTER TABLE saldos_francos ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
