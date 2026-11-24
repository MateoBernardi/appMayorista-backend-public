import { ArchivoDTO } from "./ArchivoDTO";

export enum EstadoSolicitud {
    PENDIENTE = 'PENDIENTE',
    PENDIENTE_DOCUMENTACION = 'PENDIENTE_DOCUMENTACION',
    PENDIENTE_APROBACION = 'PENDIENTE_APROBACION',
    APROBADA = 'APROBADA',
    RECHAZADA = 'RECHAZADA',
    CANCELADA = 'CANCELADA',
    EXPIRADA = 'EXPIRADA',
    CONSUMIDA = 'CONSUMIDA'
}

export interface LicenciaDTO {
    id: number;
    usuario_id: number;
    tipo_licencia_id: number;
    fecha_inicio: Date;
    fecha_fin: Date;
    estado: EstadoSolicitud;
    created_at: Date;
    updated_at: Date;
    // Campos relacionados
    tipo_nombre?: string; // Nombre del tipo de licencia
    usuario_nombre?: string; // Nombre del usuario
    usuario_apellido?: string; // Apellido del usuario
}

export interface TipoLicenciaDTO {
    id: number;
    nombre: string;
    codigo: string;
    descripcion: string;
    requiere_saldo: boolean;
    requiere_adjunto: boolean;
}

export interface SaldoAusenciaDTO {
    id: number;
    usuario_id: number;
    tipo_licencia_id: number;
    dias_otorgados: number;
    dias_consumidos: number;
    dias_disponibles?: number; 
    tipo_nombre?: string; 
    residuo: number;
}

/** Fila de saldos_ausencia bloqueada dentro de una transacción (décimas de día). */
export interface SaldoBloqueado {
    dias_otorgados: number;
    dias_consumidos: number;
    residuo: number;
}

/** Descuento que resulta de aprobar una solicitud con saldo (décimas de día). */
export interface DescuentoSaldo {
    dias: number;
    nuevoResiduo: number;
}

/** Solicitud ya descontada del saldo, en el orden en que se aprobó. */
export interface SolicitudDescontada {
    id: number;
    cantidad_dias: number;
    residuo_al_aprobar: number | null;
    dias_descontados: number | null;
}

/** Cómo queda el saldo al cancelar una solicitud aprobada (décimas de día). */
export interface ReintegroSaldo {
    diasADevolver: number;
    nuevoResiduo: number;
    posteriores: { id: number; residuo_al_aprobar: number; dias_descontados: number }[];
}

export interface SaldosUsuarioDTO {
    ausencias: SaldoAusenciaDTO[];
    francos: number; // Saldo neto en horas (2 decimales), por compatibilidad
    francosMinutos: number; // Saldo neto exacto: minutos_disponibles − minutos_consumidos
}

export interface SolicitudAusenciaDTO {
    id: number;
    usuario_id: number;
    tipo_licencia_id: number;
    fecha_inicio: Date;
    fecha_fin: Date;
    cantidad_dias: number | null; // Stored as value * 10 (integer). Null if hours-based.
    cantidad_minutos: number | null; // Minutos solicitados. Null si es por días.
    cantidad_horas?: number | null; // Compatibilidad (horas × 10, calculado de cantidad_minutos). Quitar cuando la app no lo use.
    estado: EstadoSolicitud;
    aprobador_id?: number;
    fecha_respuesta?: Date;
    observacion: string;
    residuo_al_aprobar?: number | null; // Residuo del saldo antes de aprobar (décimas)
    dias_descontados?: number | null; // Décimas descontadas del saldo al aprobar; null en aprobadas viejas
    created_at: Date;
    // Joined fields
    usuario_nombre?: string;
    usuario_apellido?: string;
    tipo_nombre?: string;
    aprobador_nombre?: string;
    aprobador_apellido?: string;
    archivos_adjuntos?: boolean; // If it has files
    archivos?: ArchivoDTO[]; // Optional array of attached files
}

export interface SolicitudDTO {
    id: number;
    usuario_id: number;
    inicio: Date;
    fin: Date;
    tipo: string;
};

export interface CreateSolicitudDTO {
    tipo_licencia_id: number;
    fecha_inicio: Date; // Acepta YYYY-MM-DD o YYYY-MM-DDTHH:mm (con segundos/offset opcionales)
    cantidad_dias?: number;  // Días solicitados (puede ser fraccionario: 0.5, 1.5, etc.)
    cantidad_horas?: number; // Horas solicitadas (puede ser fraccionario)
    observacion?: string;
    archivosIds?: number[]; // IDs de archivos adjuntos
}

export interface AprobarSolicitudDTO {
    solicitud_id: number;
    aprobador_id: number;
    observacion?: string;
}

export interface RechazarSolicitudDTO {
    solicitud_id: number;
    aprobador_id: number;
    observacion: string; // Obligatoria
}

export interface SolicitudFilterDTO {
    usuario_id?: number;
    exclude_usuario_id?: number;
    estado?: EstadoSolicitud;
    fecha_desde?: Date;
    fecha_hasta?: Date;
    tipo_licencia_id?: number;
    id_rol_max_creador?: number; // Solo traer solicitudes de usuarios con id_rol > este valor (rango inferior)
}
