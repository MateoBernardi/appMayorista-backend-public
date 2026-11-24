export interface ArticuloDTO {
  codigo_articulo: number;
  descripcion: string;
  cod_barra_articulo?: number;
  cod_barra_caja?: number;
  cant_unidades_caja: number;
  precio_costo: number;
  precio_venta: number;
  precio_venta_volumen: number;
  stock_actual: number;
  rentabilidad_minima?: number;
  rubro: string;
  venta_tipo?: 'unidad' | 'kilogramo' | 'litro';
  deleted_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
  en_oferta?: boolean;
  oferta_id?: number;
}

export interface ArticuloPaginadoDTO {
  articulos: ArticuloDTO[];
  page: number;
  totalPages: number;
  total: number;
}

export interface ArticuloPublicDTO {
  codigo_articulo: number;
  descripcion: string;
  imagenes: string[]; // array de URLs de imágenes
  stock_actual: number;
}

export interface ArticuloBusquedaPublicaDTO {
  articulos: ArticuloPublicDTO[];
}

export interface ArticuloPaginadoPublicoDTO {
  articulos: ArticuloPublicDTO[];
  page: number;
  totalPages: number;
  total: number;
}