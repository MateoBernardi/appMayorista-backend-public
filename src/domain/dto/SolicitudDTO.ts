import { RangoOcupado } from "../validations/datesValidations";
import { ArchivoDTO } from "./ArchivoDTO";

export interface SolicitudDTO {
    solicitud_id?: number;
    titulo: string;
    descripcion: string;
    created_by: number;
    fecha_inicio: Date | null;
    fecha_fin: Date | null;
    tipo_actividad: string;
    invitados: number[]; //Todos los participantes, incluyendo el creador
    estado?: string;
    archivosIds?: number[];
    crear_de_todos_modos: Number; // Indica si se debe crear la actividad aunque las fechas estén ocupadas
    enviar_por_separado?: number; // Si es 1, crea una solicitud independiente por cada invitado
    es_grupo?: boolean;           // true → group CHAT; false (default) → private 1-on-1 CHAT
}

export interface SolicitudInfoDTO {
    solicitud_id: number;
    titulo: string;
    descripcion: string;
    fecha_inicio: Date;
    fecha_fin: Date;
    nombre_creador: string;
    apellido_creador: string;
    created_by: number;
    id_usuario_invitado?: number;
    ultimo_mensaje?: string | null;
    // Metadatos de la última entrada de la bitácora, para el preview de las
    // listas (icono/leyenda por tipo, flecha enviado/recibido, hora).
    ultimo_mensaje_tipo?: 'TEXT' | 'FECHA' | 'IMAGEN' | 'ARCHIVO';
    ultimo_mensaje_at?: Date | null;
    ultimo_mensaje_autor_id?: number | null;
    invitados: SolicitudInvitadoDTO[]; //Todos los participantes, incluyendo el creador
    tipo_actividad: string;
    es_grupo: boolean;
    estado: string;
    seen?: boolean;
    archivos: ArchivoDTO[];
    isHost: boolean;
}

export interface SolicitudBitacoraVistoDTO {
    id_usuario: number;
    nombre?: string;
    apellido?: string;
    seen_at: Date;
}

export interface SolicitudBitacoraReplyToDTO {
    id: number;
    usuario_id: number | null;
    usuario_nombre: string;
    usuario_apellido: string;
    observacion: string | null;
}

export interface SolicitudBitacoraDTO {
    id?: number;
    solicitud_id: number;
    titulo?: string;
    fecha_inicio_nueva?: Date | null;
    fecha_fin_nueva?: Date | null;
    observacion?: string;
    created_at?: Date;
    usuario_id?: number;
    usuario_nombre?: string;
    usuario_apellido?: string;
    archivos?: ArchivoDTO[];
    archivosIds?: number[];
    estado: string;
    seen_at?: Date | null;
    seen_by?: SolicitudBitacoraVistoDTO[];
    reply_to_id?: number | null;
    reply_to?: SolicitudBitacoraReplyToDTO | null;
}

export interface CreateSolicitudResult {
    created: boolean;
    solicitudIds?: number[];
    notifications?: { invitadoId: number; solicitudId: number }[];
    failedInvitados?: number[];
    rangosOcupados: RangoOcupado[];
}

export interface UpdateSolicitudResult {
    updated: boolean;
    rangosOcupados: RangoOcupado[];
}

export interface ValidateAvailabilityDTO {
    userIds: number[];
    fecha_inicio: Date;
    fecha_fin: Date;
    solicitudIdExcluir?: number;
}

export interface SolicitudInvitadoDTO {
    user_id: number;
    invitado_nombre?: string;
    invitado_apellido?: string;
}

export interface PaginacionParams {
    page: number;       // base 1
    pageSize: number;   // ej: 20
}

export interface PaginatedResult<T> {
    data: T[];
    total: number;      // total_count para que el frontend calcule páginas
    page: number;
    pageSize: number;
}

export interface PaginatedBitacoraResult {
    data: SolicitudBitacoraDTO[];
    nextCursor: number | null;
}
