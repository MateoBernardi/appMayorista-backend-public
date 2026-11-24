BEGIN;

ALTER TABLE solicitudes_bitacora
    ADD COLUMN IF NOT EXISTS reply_to_id integer NULL
        REFERENCES solicitudes_bitacora(id);

CREATE INDEX IF NOT EXISTS idx_solicitudes_bitacora_reply_to_id
    ON solicitudes_bitacora(reply_to_id)
    WHERE reply_to_id IS NOT NULL;

COMMIT;
