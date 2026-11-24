export enum ArchivoUso {
  EMPRESA = 'EMPRESA',
  LICENCIA = 'LICENCIA',
  MAYORISTA = 'MAYORISTA',
  TAREA = 'TAREA',
  WEB = 'WEB',
}

export interface ArchivoDTO {
  id: number;
  nombre: string;
  ruta_r2: string;
  id_carpeta?: number | null;
  tipo: string;
  tamaño: number;
  titulo: string;
  created_by: number;
  creador_nombre: string;
  creador_apellido: string;
  opened_at?: Date | null;
  created_at: Date;
  id_tipo: number;
  uso: ArchivoUso;
  id_usuario_asociado?: number;
  allowed_roles?: string[] | undefined;
  // URL firmada, lista para usar. Solo la completan los endpoints que la
  // resuelven en el momento (p. ej. la bitácora de una solicitud); el resto
  // de los listados de archivos siguen resolviéndola bajo demanda vía
  // GET /archivos/:id/url.
  url?: string;
}

export interface ArchivoVisibilidadUsuarioDTO {
  archivo_id: number;
  usuario_id: number;
}

export interface ArchivoAsociacionUsuarioDTO {
  archivo_id: number;
  usuario_id: number;
}

export interface CrearArchivoDTO {
  nombre: string;
  ruta_r2: string;
  id_carpeta?: number | null;
  tipo: string;
  tamaño: number;
  titulo: string;
  created_by: number;
  allowed_roles?: string[];
  uso?: ArchivoUso;

  // relaciones (opcional)
  usuarios_compartidos?: number[];
  usuarios_asociados?: number[];
}

export interface UpdateArchivoDTO {
  nombre?: string;
  titulo?: string;
  id_carpeta?: number | null;
  allowed_roles?: string[];

  usuarios_compartidos?: number[]; // ALTAS
  usuarios_asociados?: number[];   // ALTAS
}
