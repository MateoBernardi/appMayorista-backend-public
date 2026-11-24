-- El aviso de sin-marcar se envía una sola vez por turno y por tipo (entrada a mitad del turno,
-- salida al pasar la gracia). Estas marcas son el claim atómico del barrido (ver
-- getUsuariosSinMarcarHoy en horariosRepo), igual que reportado_tardanza en el de ausencias.
BEGIN;

ALTER TABLE planificacion_diaria
    ADD COLUMN IF NOT EXISTS aviso_entrada_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS aviso_salida_at TIMESTAMP NULL;

COMMIT;
