export interface PagosDTO {
  nro_pedido: number;
  medio_pago: string;
  monto: number;
  referencia?: string;
  estado_pago?: string;
}
