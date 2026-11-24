-- Asociación de cuentas: el código de verificación queda atado a la entidad a la que
-- se envió (cliente o personal). El servidor asocia la entidad guardada en el token
-- que coincide, nunca una que mande el cliente.
BEGIN;

ALTER TABLE verification_tokens
    ADD COLUMN entidad_id integer,
    ADD COLUMN entidad_tipo_id integer REFERENCES entidades_tipos(id);

COMMIT;
