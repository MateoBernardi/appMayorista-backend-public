import { ArchivoDTO } from "./ArchivoDTO";

export interface BitacoraDTO {
    id: number;
    estado_anterior: string;
    estado_nuevo: string;
    observacion: string;
    created_at: Date;
    usuario_id: number;
    usuario_nombre: string;
    usuario_apellido: string;
    assignee_id?: number;
    assignee_nombre?: string;
    assignee_apellido?: string;
    appointment?: 'ASSIGN' | 'DISCHARGE';
}

export interface InvitadoDTO {
    user_id: number;
    invitado_nombre?: string;
    invitado_apellido?: string;
    rol: 'ASSIGNEE' | 'VISUALIZER';
}

export interface ObjetivoDTO {
    id: number;
    titulo: string;
    descripcion: string;
    estado: string;
    rank_position: string;
    created_by: number;
    created_by_username?: string;
    updated_by?: number;
    created_at: Date;
    updated_at: Date;
    bitacora?: BitacoraDTO[];
    invitados?: InvitadoDTO[];
    archivos?: ArchivoDTO[];
}

export interface CreateObjetivoDTO {
    titulo: string;
    descripcion: string;
    estado: string;
    solicitud_id?: number;
    invitados?: InvitadoDTO[];
    archivosIds?: number[];
}
