ALTER TABLE clientes ADD COLUMN email VARCHAR(255) UNIQUE;

CREATE TYPE venta_tipo_enum AS ENUM ('unidad', 'kilogramo', 'litro');
ALTER TABLE articulos ADD COLUMN venta_tipo venta_tipo_enum;