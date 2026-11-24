export interface ArticuloImagenDTO {
  id?: number;
  articulo_id: number;
  image_id: number;
  orden?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}