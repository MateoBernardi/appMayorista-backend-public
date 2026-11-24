export type EstadoReporte = 'PENDIENTE' | 'DISPUTA' | 'ASENTADO' | 'DESESTIMADO';

export interface ReporteDTO {
    id: number;
    usuario_reportado_id: number;
    creador_id?: number | null;
    titulo: string;
    descripcion: string;
    categoria?: string | null;
    estado: EstadoReporte;
    fecha_incidente: Date;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
    // Extra fields for display
    usuario_nombre?: string;
    usuario_apellido?: string;
}

export interface CreateReporteDTO {
    usuario_reportado_id: number;
    creador_id?: number | null;
    titulo: string;
    descripcion: string;
    categoria: string;
    estado?: EstadoReporte;
    fecha_incidente?: Date;
}

export interface ReporteActividadDTO {
    id: number;
    reporte_id: number;
    usuario_id?: number | null;
    tipo_accion: string;
    observacion?: string | null;
    created_at: Date;
}

export interface ReporteStatsDTO {
    usuario_id: number;
    nombre: string;
    apellido: string;
    negativos: number;
    positivos: number;
    puntos: number;
    /** Reportes en estado DISPUTA todavía sin resolver (sin límite de fecha). */
    disputas: number;
    zona: 'rojo' | 'amarillo' | 'verde';
}

export interface MostImprovedUserDTO {
    user_context_id: number;
    nombre: string;
    apellido: string;
    positivos_recientes: number;      // Últimos 3 meses
    positivos_anteriores: number;     // Entre hace 6 y 3 meses
    mejora_neta: number;              // Diferencia (mejora)
}

export interface TopPositiveUserDTO {
    user_context_id: number;
    nombre: string;
    apellido: string;
    total_positivos: number;          // Total reportes positivos (últimos 6 meses)
}

export interface ReportesManagedResult {
    data: (ReporteDTO & { bitacora: any[]; imagenes: string[] })[];
    total: number;
    page: number;
    pageSize: number;
}
