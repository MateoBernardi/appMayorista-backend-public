export type NovedadWebEstado = 'Borrador' | 'Programada' | 'Publicada';

export interface NovedadWebDTO {
  id: number;
  titulo: string;
  preview: string;
  cuerpo: string;
  imagen: string | null;
  publicada_en: Date;
  estado: NovedadWebEstado;
  created_by: number | null;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
}

export interface NovedadWebCreateInput {
  titulo: string;
  preview: string;
  cuerpo: string;
  imagen?: string | null | undefined;
  publicada_en?: Date | undefined;
  estado?: NovedadWebEstado | undefined;
  created_by: number;
}

export interface NovedadWebUpdateInput {
  titulo?: string | undefined;
  preview?: string | undefined;
  cuerpo?: string | undefined;
  imagen?: string | null | undefined;
  publicada_en?: Date | undefined;
  estado?: NovedadWebEstado | undefined;
}
