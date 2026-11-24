import { PedidoDTO } from "../dto/PedidoDTO";
import { PagosDTO } from "../dto/PagosDTO";
import { Validator } from "./ValidatorInterface";
import { BadRequestError, ConflictError } from "../../adapters/errors/AppError";
import { hasMaxDecimals } from "./numberValidations";

const pedidoSchema: { [K in keyof PedidoDTO]: 'string' | 'number' } = {
      nro_pedido: 'number',
      id_cliente: 'number',
      estado: 'string',
      id_condicion: 'number',
};

const pagoSchema: { [K in keyof PagosDTO]: 'string' | 'number' | 'optional' } = {
      nro_pedido: 'number',
      medio_pago: 'string',
      monto: 'number',
      referencia: 'string',
      estado_pago: 'string',
};

const maxNumberValue = 99999999999.999;

export class PedidoValidator implements Validator {
  validateTypes(data: PedidoDTO[] | PedidoDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((pedido, idx) => {
      for (const [key, type] of Object.entries(pedidoSchema)) {
        const value = (pedido as any)[key];
        if (value === undefined || value === null) {
          return { fila: idx + 1, errores: [key] };
        }
        if (typeof value !== type) {
          return { fila: idx + 1, errores: [key] };
        }
      }
      return null;
    }).filter(Boolean);
  }
  validateValues(data: PedidoDTO[] | PedidoDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((pedido, idx) => {
      const errores: string[] = [];
      const estadosValidos = ['pendiente', 'preparado', 'entregado', 'cancelado'];
      if (!estadosValidos.includes(pedido.estado)) {
        errores.push('estado inválido');
      }
      if (typeof pedido.id_cliente === 'number') {
        if (pedido.id_cliente <= 0) errores.push('id_cliente debe ser positivo');
        if (pedido.id_cliente > maxNumberValue) errores.push('id_cliente excede el máximo permitido');
      }
      if (typeof pedido.id_condicion === 'number') {
        if (pedido.id_condicion <= 0) errores.push('id_condicion debe ser positivo');
        if (pedido.id_condicion > maxNumberValue) errores.push('id_condicion excede el máximo permitido');
      }
      return errores.length > 0 ? { fila: idx + 1, errores } : null;
    }).filter(Boolean);
  }
  validateData(data: PedidoDTO[] | PedidoDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return [
      ...this.validateTypes(arr),
      ...this.validateValues(arr)
    ];
  }
}

export class PagosValidator implements Validator {
  validateTypes(data: PagosDTO[] | PagosDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((pago, idx) => {
      for (const [key, type] of Object.entries(pagoSchema)) {
        const value = (pago as any)[key];
        if ((value === undefined || value === null)) {
          if (key === 'referencia' || key === 'estado_pago') continue;
          return { fila: idx + 1, errores: [key] };
        }
        if (typeof value !== type) {
          return { fila: idx + 1, errores: [key] };
        }
      }
      return null;
    }).filter(Boolean);
  }
  validateValues(data: PagosDTO[] | PagosDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((pago, idx) => {
      const errores: string[] = [];
      if (typeof pago.medio_pago === 'string' && pago.medio_pago.length > 50) {
        errores.push('medio_pago excede 50 caracteres');
      }
      if (typeof pago.medio_pago !== 'string' || pago.medio_pago.trim().length === 0) {
        errores.push('medio_pago es requerido');
      }
      if (typeof pago.monto !== 'number' || pago.monto <= 0) {
        errores.push('monto debe ser mayor a cero');
      } else {
        if (!hasMaxDecimals(pago.monto, 3)) {
          errores.push('monto debe tener hasta 3 decimales');
        }
        if (pago.monto > maxNumberValue) {
          errores.push('monto excede el máximo permitido');
        }
      }
      if (pago.referencia && typeof pago.referencia === 'string' && pago.referencia.length > 100) {
        errores.push('referencia excede 100 caracteres');
      }
      const estadosPagoValidos = ['pendiente', 'confirmado', 'rechazado'];
      if (pago.estado_pago) {
        if (typeof pago.estado_pago !== 'string' || pago.estado_pago.length > 20) {
          errores.push('estado_pago inválido');
        } else if (!estadosPagoValidos.includes(pago.estado_pago)) {
          errores.push('estado_pago inválido');
        }
      }
      return errores.length > 0 ? { fila: idx + 1, errores } : null;
    }).filter(Boolean);
  }
  validateData(data: PagosDTO[] | PagosDTO): any[] {
    const arr = Array.isArray(data) ? data : [data];
    return [
      ...this.validateTypes(arr),
      ...this.validateValues(arr)
    ];
  }
}

export const pedidoValidator = new PedidoValidator();
export const pagosValidator = new PagosValidator();

export function validateEstadoPedido(nuevoEstado: string, estadoActual: string): string | null {
  const estadosValidos = ['pendiente', 'preparado', 'entregado'];
  if (!estadosValidos.includes(nuevoEstado) || estadoActual === 'entregado' || !estadosValidos.includes(estadoActual)) {
    throw new BadRequestError('Estado de pedido inválido');
  }

  const idxActual = estadosValidos.indexOf(estadoActual);
  const idxNuevo = estadosValidos.indexOf(nuevoEstado);

  if (idxNuevo !== idxActual + 1) {
    throw new ConflictError('No se puede saltar estados');
  }

  return null;
}