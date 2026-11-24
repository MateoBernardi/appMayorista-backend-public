-- Allow decimal quantities for kilogram-type articles
BEGIN;
ALTER TABLE pedido_articulo
  DROP CONSTRAINT pedido_articulo_cantidad_check,
  ALTER COLUMN cantidad TYPE NUMERIC(10,3),
  ADD CONSTRAINT pedido_articulo_cantidad_check CHECK (cantidad > 0);

ALTER TABLE articulos
  DROP CONSTRAINT articulos_stock_actual_check,
  ALTER COLUMN stock_actual TYPE NUMERIC(10,3),
  ADD CONSTRAINT articulos_stock_actual_check CHECK (stock_actual >= 0);
COMMIT;