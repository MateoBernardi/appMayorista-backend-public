import { RangoOcupado } from "../validations/datesValidations";
import { ArchivoDTO } from "./ArchivoDTO";

export interface ActividadDTO {
    actividad_id?: number;
    titulo?: string;
    descripcion?: string;
    fecha_inicio: Date;
    fecha_fin?: Date;
    solicitud_id?: number;
    archivos?: ArchivoDTO[]; // Puedes definir un tipo específico para los archivos si lo deseas
}

export interface CreateActividadResult {
    created: boolean;
    actividad: any | null;
    rangosOcupados: RangoOcupado[];
    /** Invitados de la solicitud que no aceptaron y por eso no recibieron la actividad. */
    excludedInvitados?: number[];
}

export interface UpdateActividadHorariosResult {
    updated: boolean;
    actividad: any | null;
    rangosOcupados: RangoOcupado[];
}

export interface ActividadParticipanteDTO {
    id_usuario_participante: number;
    rol: string;
    nombre: string | null;
    apellido: string | null;
}

export interface ActividadDetalleDTO {
    actividad_id: number;
    titulo: string;
    descripcion: string;
    fecha_inicio: Date;
    fecha_fin: Date;
    solicitud_id: number | null;
    participantes: ActividadParticipanteDTO[];
    archivos?: ArchivoDTO[];
}