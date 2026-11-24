export interface PedidoDTO {
  nro_pedido?: number;
  id_cliente: number;
  estado: string;
  id_condicion: number;
  fecha?: Date;
  deleted_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface PedidoConClienteDTO extends PedidoDTO {
  cliente: string;
  descripcion?: string;
  nombre?: string;
  cuit: string;
  id_localidad?: number;
  localidad?: string;
  codigo_postal?: string;
  direccion?: string;
  zona?: string;
  condicion_iva?: string;
  id_condicion_iva?: number;
}

export interface PedidoConPagosDTO extends PedidoConClienteDTO {
  medio_pago?: string;
  estado_pago?: string;
}