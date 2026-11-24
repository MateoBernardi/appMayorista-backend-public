export interface Pedido_ArticuloDTO {
  nro_pedido: number;
  codigo_articulo: number;
  articulo: string;
  cantidad: number;     
  precio_unitario: number;
  total: number;          // cantidad * precio_unitario
  total_pedido: number;   // Suma de totales de todos los artículos en el pedido
}
