export interface ImageDTO {
  id: number;
  url: string;
  section: string;
  description: string;
  createdAt: string;
  tieneArticulo: boolean;
  articulos: number[];
  orden?: number;
  media_type?: 'image' | 'video';
}