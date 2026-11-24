import { ArticuloDTO } from "../dto/ArticuloDTO";
import { Validator } from "./ValidatorInterface";

const schema: { [K in keyof ArticuloDTO]: 'string' | 'number' | 'optional' } = {
  codigo_articulo: 'number',
  descripcion: 'string',
  cod_barra_articulo: 'number',
  cod_barra_caja: 'number',
  cant_unidades_caja: 'number',
  precio_costo: 'number',
  precio_venta: 'number',
  precio_venta_volumen: 'number',
  stock_actual: 'number',
  rentabilidad_minima: 'optional',
  rubro: 'string',
};

const maxStringLength = 40;
const maxNumberValue = 999999999999999; // Para BIGINT y NUMERIC
const maxInteger = 2147483647;

class ArticuloValidator implements Validator {
  validateTypes(articulos: ArticuloDTO[]): Array<{ fila: number | undefined, codigo_articulo?: number, errores: string[] }> {
    const errores: Array<{ fila: number | undefined, codigo_articulo?: number, errores: string[] }> = [];
    articulos.forEach((articulo, idx) => {
      const camposInvalidos: string[] = [];
      Object.entries(schema).forEach(([key, type]) => {
        const value = (articulo as any)[key];
        if (type === 'optional') {
          if (!(value === undefined || typeof value === 'number')) {
            camposInvalidos.push(key);
          }
        } else {
          if (typeof value !== type) {
            camposInvalidos.push(key);
          }
        }
      });
      if (camposInvalidos.length > 0) {
        errores.push({ fila: idx + 1, codigo_articulo: articulo.codigo_articulo, errores: camposInvalidos });
      }
    });
    return errores;
  }

  validateValues(articulos: ArticuloDTO[]): Array<{ fila: number | undefined, codigo_articulo?: number, errores: string[] }> {
    const errores: Array<{ fila: number | undefined, codigo_articulo?: number, errores: string[] }> = [];
    // Mapa para trackear códigos duplicados
    const codigosVistos = new Map<number, number[]>(); // codigo -> array de filas

    articulos.forEach((articulo, idx) => {
      const camposInvalidos: string[] = [];
      // Trackear códigos para detectar duplicados
      const codigo = articulo.codigo_articulo;
      if (!codigosVistos.has(codigo)) {
        codigosVistos.set(codigo, []);
      }
      codigosVistos.get(codigo)!.push(idx + 1); // Guardar número de fila (1-based)

      // Si es rubro 'I' (insumos), solo validar tipos y saltar validaciones de valor
      if (articulo.rubro === 'I') {
        // Solo validaciones de tipo
        Object.entries(articulo).forEach(([key, value]) => {
          if (typeof value === 'string') {
            if (value.trim().length === 0) {
              camposInvalidos.push(`${key} no puede estar vacía`);
            }
            if (value.length > maxStringLength) {
              camposInvalidos.push(`${key} excede ${maxStringLength} caracteres`);
            }
          }
          if (typeof value === 'number') {
            if (value > maxNumberValue) {
              camposInvalidos.push(`${key} excede el máximo permitido (${maxNumberValue})`);
            }
            if (key === 'cant_unidades_caja' || key === 'stock_actual') {
              if (value > maxInteger) {
                camposInvalidos.push(`${key} excede el máximo permitido (${maxInteger})`);
              }
            }
            if (value < 0) {
              camposInvalidos.push(`${key} debe ser mayor o igual a 0`);
            }
          }
        });
        if (articulo.venta_tipo !== undefined && !['unidad', 'kilogramo', 'litro'].includes(articulo.venta_tipo)) {
          camposInvalidos.push('venta_tipo debe ser unidad, kilogramo o litro');
        }
        if (camposInvalidos.length > 0) {
          errores.push({ fila: idx + 1, codigo_articulo: articulo.codigo_articulo, errores: camposInvalidos });
        }
        return; // Saltar el resto de validaciones para insumos
      }

      // Para rubro 'M' o 'A', mantener todas las validaciones actuales
      Object.entries(articulo).forEach(([key, value]) => {
        if (typeof value === 'string') {
          if (value.trim().length === 0) {
            camposInvalidos.push(`${key} no puede estar vacía`);
          }
          if (value.length > maxStringLength) {
            camposInvalidos.push(`${key} excede ${maxStringLength} caracteres`);
          }
        }
        if (typeof value === 'number') {
          if (value > maxNumberValue) {
            camposInvalidos.push(`${key} excede el máximo permitido (${maxNumberValue})`);
          }
          if (key === 'cant_unidades_caja' || key === 'stock_actual') {
            if (value > maxInteger) {
              camposInvalidos.push(`${key} excede el máximo permitido (${maxInteger})`);
            }
          }
          if (value < 0) {
            camposInvalidos.push(`${key} debe ser mayor o igual a 0`);
          }
          // Campos que siempre deben ser mayor a 0 (independiente del rubro)
          if (
            (key === 'precio_costo' || key === 'cant_unidades_caja') &&
            value <= 0
          ) {
            camposInvalidos.push(`${key} debe ser mayor a 0`);
          }
          // Validaciones específicas por campo
          if (key === 'stock_actual' || key === 'precio_venta' || key === 'precio_venta_volumen') {
            if (key === 'stock_actual') {
              if (value < 0) {
                camposInvalidos.push(`${key} debe ser mayor o igual a 0`);
              }
            } else {
              // Para precio_venta y precio_venta_volumen: debe ser mayor a 0
              if (value <= 0) {
                camposInvalidos.push(`${key} debe ser mayor a 0`);
              }
            }
          }
        }
      });

      // Validación de rentabilidad (mantener chequeo específico)
      if (
        typeof articulo.precio_costo === 'number' &&
        typeof articulo.precio_venta === 'number' &&
        typeof articulo.rentabilidad_minima === 'number'
      ) {
        const minRent = articulo.precio_costo + articulo.precio_costo * (articulo.rentabilidad_minima || 0);
        if (articulo.precio_venta <= minRent) camposInvalidos.push('precio_venta debe ser mayor a precio_costo + rentabilidad_minima');
        if (articulo.precio_venta_volumen <= minRent) camposInvalidos.push('precio_venta_volumen debe ser mayor a precio_costo + rentabilidad_minima');
      }

      if (articulo.venta_tipo !== undefined && !['unidad', 'kilogramo', 'litro'].includes(articulo.venta_tipo)) {
        camposInvalidos.push('venta_tipo debe ser unidad, kilogramo o litro');
      }

      if (camposInvalidos.length > 0) {
        errores.push({ fila: idx + 1, codigo_articulo: articulo.codigo_articulo, errores: camposInvalidos });
      }
    });
    
    // Validar códigos duplicados después de procesar todos los artículos
    codigosVistos.forEach((filas, codigo) => {
      if (filas.length > 1) {
        // Agregar error de duplicado para cada fila que tiene el código duplicado
        filas.forEach(fila => {
          const errorExistente = errores.find(e => e.fila === fila);
          const otrasFilas = filas.filter(f => f !== fila);
          const mensajeDuplicado = `codigo_articulo ${codigo} está duplicado en las filas: ${otrasFilas.join(', ')}`;
          
          if (errorExistente) {
            // Si ya hay errores para esta fila, agregar el error de duplicado
            errorExistente.errores.push(mensajeDuplicado);
          } else {
            // Si no hay errores para esta fila, crear un nuevo error solo para el duplicado
            errores.push({ 
              fila: fila, 
              codigo_articulo: codigo, 
              errores: [mensajeDuplicado] 
            });
          }
        });
      }
    });
    
    return errores;
  }

  validateData(articulos: ArticuloDTO[]): Array<{ fila: number | undefined, errores: string[] }> {
    return [
      ...this.validateTypes(articulos),
      ...this.validateValues(articulos)
    ];
  }
}

export const articuloValidator = new ArticuloValidator();

export function validarOArrojar(articulos: ArticuloDTO[]) {
  const errores = articuloValidator.validateData(articulos);
  if (errores.length > 0) {
    throw new Error('Artículos inválidos: ' + JSON.stringify(errores));
  }
  return null;
}

export function codigosAEliminar(sinStock: ArticuloDTO[], articulos: ArticuloDTO[]): number[] {
  if (sinStock.length === 0 || articulos.length === 0) {
    throw new Error('No hay artículos para eliminar');
  }
  const codigosArreglo = new Set(articulos.map(a => a.codigo_articulo));
  const result = sinStock
    .filter(articulo => codigosArreglo.has(articulo.codigo_articulo))
    .map(articulo => articulo.codigo_articulo);
  if (result.length === 0) {
    throw new Error('No hay artículos para eliminar');
  }
  return result;
}

export function validateSearchField(campo: string, palabra: string) {
  if (!palabra || palabra.trim().length === 0) return false;
  if (!isArticuloSearchField(campo)) return false;
  return true;
}

function isArticuloSearchField(value: string): value is 'descripcion' | 'codigo_articulo' {
  return ['descripcion', 'codigo_articulo'].includes(value);
}

// Exportar funciones para compatibilidad si son usadas en otros lados
export const validarTipos = articuloValidator.validateTypes.bind(articuloValidator);
export const validarValores = articuloValidator.validateValues.bind(articuloValidator);
export const validateData = articuloValidator.validateData.bind(articuloValidator);
