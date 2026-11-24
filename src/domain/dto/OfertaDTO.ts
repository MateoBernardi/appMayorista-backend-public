export interface OfertaArticuloDTO {
  oferta_id?: number;
  codigo_articulo: number;
  precio_costo: number;
  precio_venta: number;
  precio_venta_volumen: number;
  stock_actual: number;
  rentabilidad_minima?: number;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

export interface OfertaConArticuloDTO extends OfertaArticuloDTO {
  descripcion: string;
  rubro: string;
  venta_tipo?: 'unidad' | 'kilogramo' | 'litro';
  precio_venta_base: number;
}
