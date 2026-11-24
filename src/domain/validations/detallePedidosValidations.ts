import { ArticuloDTO } from "../dto/ArticuloDTO";
import { Pedido_ArticuloDTO } from "../dto/DetallePedidosDTO";
import { Validator } from "./ValidatorInterface";
import { BadRequestError, ConflictError, NotFoundError } from "../../adapters/errors/AppError";
import { hasMaxDecimals } from "./numberValidations";

const schema: { [K in keyof Pedido_ArticuloDTO]: 'string' | 'number' } = {
  nro_pedido: 'number', // <-- sin ?
  codigo_articulo: 'number',
  articulo: 'string',
  cantidad: 'number',
  precio_unitario: 'number',
  total: 'number',
  total_pedido: 'number',
};

const maxNumberValue = 999999999999999;

export class DetallePedidoValidator implements Validator {
  validateTypes(data: Pedido_ArticuloDTO[] | Pedido_ArticuloDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((detalle, idx) => {
      for (const [key, type] of Object.entries(schema)) {
        const value = (detalle as any)[key];
        // Permitir nro_pedido undefined o null (opcional)
        if ((key === 'nro_pedido') && (value === undefined || value === null)) {
          continue;
        }
        if (typeof value !== type) {
          return { fila: idx + 1, errores: [key] };
        }
        // Chequear que los campos numéricos sean mayores a cero
        if (
          type === 'number' &&
          typeof value === 'number' &&
          value <= 0
        ) {
          return { fila: idx + 1, errores: [key] };
        }
      }
      return null;
    }).filter(Boolean);
  }

  validateValues(data: Pedido_ArticuloDTO[] | Pedido_ArticuloDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((detalle, idx) => {
      const errores: string[] = [];

      // cantidad > 0
      if (typeof detalle.cantidad === "number" && detalle.cantidad <= 0) {
        errores.push("cantidad debe ser mayor a cero");
      }
      // precio_unitario >= 0, hasta 3 decimales, y <= maxNumberValue
      if (typeof detalle.precio_unitario === "number") {
        if (detalle.precio_unitario < 0) {
          errores.push("precio_unitario debe ser mayor o igual a cero");
        }
        if (!hasMaxDecimals(detalle.precio_unitario, 3)) {
          errores.push("precio_unitario debe tener hasta 3 decimales");
        }
        if (detalle.precio_unitario > maxNumberValue) {
          errores.push("precio_unitario excede el máximo permitido");
        }
      }
      return errores.length > 0 ? { fila: idx + 1, errores } : null;
    }).filter(Boolean);
  }

  validateData(data: Pedido_ArticuloDTO[] | Pedido_ArticuloDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return [
      ...this.validateTypes(arr),
      ...this.validateValues(arr)
    ];
  }
}

export const detallePedidoValidator = new DetallePedidoValidator();

export function validarEstadoPedido(estado: string) {
  if (estado !== 'pendiente') {
    throw new ConflictError('Solo se pueden modificar pedidos en estado pendiente');
  }
  return null;
}

export function validarArticuloExiste(articulosEncontrados: ArticuloDTO[]) {
  if (!articulosEncontrados || !Array.isArray(articulosEncontrados) || articulosEncontrados.length === 0) {
    throw new NotFoundError('Artículo no encontrado');
  }
  return null;
}

export function validarStock(stockData: { stock_actual: number } | undefined, cantidad: number, esOferta?: boolean) {
  if (!stockData || stockData.stock_actual === undefined) {
    throw new NotFoundError('Artículo no encontrado para stock');
  }
  if (cantidad > stockData.stock_actual || cantidad <= 0) {
    throw new BadRequestError(
      esOferta
        ? 'No hay suficiente stock en la oferta activa para el artículo'
        : 'No hay suficiente stock para el artículo'
    );
  }
  return null;
}

export function validarPrecioMinimo(articulo: ArticuloDTO, precio_venta: number) {
  const precio_minimo = articulo.precio_costo + (articulo.precio_costo * (articulo.rentabilidad_minima || 0));
  if (precio_venta < precio_minimo) {
    throw new BadRequestError('El precio ingresado es menor al mínimo permitido');
  }
  return null;
};

export function validarFraccion(articulo: ArticuloDTO, cantidad: number) {
  if (articulo.venta_tipo !== 'kilogramo' && !Number.isInteger(cantidad)) {
    throw new BadRequestError('La cantidad debe ser un número entero para este tipo de artículo');
  }
}

