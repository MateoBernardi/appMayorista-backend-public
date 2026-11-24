export interface CarpetaDTO {
  id: number;
  nombre: string;
  id_carpeta_padre: number | null;
  id_usuario: number;
  allowed_roles: string[];
  allowed_users: string[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CrearCarpetaDTO {
  nombre: string;
  id_carpeta_padre?: number | null;
  id_usuario: number;
  allowed_roles?: string[];
  usuarios_id?: number[];
}

export interface EditarCarpetaDTO {
  nombre?: string;
  allowed_roles?: string[];
  usuarios_id?: number[];
}

export type CarpetasView = 'tree' | 'list';

export interface CarpetaListItemDTO {
  id: number | null;
  nombre: string;
  id_carpeta_padre: number | null;
}

export interface CarpetaTreeItemDTO {
  id: number | null;
  nombre: string;
  type: 'folder' | 'virtual';
  id_carpeta_padre?: number | null;
  children: CarpetaTreeItemDTO[];
}

export interface CarpetasResponseDTO {
  view: CarpetasView;
  items: CarpetaListItemDTO[] | CarpetaTreeItemDTO[];
}
