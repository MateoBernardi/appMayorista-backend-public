export interface TelefonoDTO {
  id_telefono?: number;
  telefono: string;
  tipo: string;
}

export interface ClienteDTO {
  id_cliente?: number;
  descripcion: string;
  direccion: string;
  cuit: string;
  email: string;
  id_condicion_iva: number;
  observacion?: string | null;
  telefonos?: TelefonoDTO[];
  id_localidad: number;
  condicion_iva?: string;
  nombre?: string;
  codigo_postal?: string;
  zona?: string;
  estado_hoy?: string;
  observacion_hoy?: string;
  pedidos_pendientes?: number;
}

export interface ClienteImportDTO {
  descripcion: string;
  localidad: string;
  cuit: string;
  direccion: string;
  telefono?: string;
  email?: string;
}

export interface LocalidadDTO {
  id_localidad: number;
  nombre: string;
  zona: string;
  codigo_postal: string;
}

export interface VisitaDTO {
  id_visita: number;
  id_cliente: number;
  fecha_visita: Date;
  resultado: string;
  observacion_visita?: string | null;
  proxima_visita?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface ClientesVisitadosDTO {
  total_clientes_zona: number;
  clientes_visitados_hoy: number;
  porcentaje_avance: number;
  visitas: { id_cliente: number; resultado: string }[];
}