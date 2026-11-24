jest.mock('../../adapters/db/articulosRepo');
jest.mock('../../adapters/db/detallePedidosRepo');
jest.mock('../../domain/validations/detallePedidosValidations');

import * as articulosRepo from '../../adapters/db/articulosRepo';
import * as detallePedidosRepo from '../../adapters/db/detallePedidosRepo';
import * as detallePedidosValidations from '../../domain/validations/detallePedidosValidations';
import {
  validarArticulosParaPedido,
  fetchDetallePedido,
  updateArticuloInPedidoService
} from '../../domain/services/detallePedidosServices';
const { validarFraccion: realValidarFraccion } = jest.requireActual('../../domain/validations/detallePedidosValidations');

const mockArticulosRepo = jest.mocked(articulosRepo);
const mockDetallePedidosRepo = jest.mocked(detallePedidosRepo);
const mockValidations = jest.mocked(detallePedidosValidations);

const baseArticulo = {
  codigo_articulo: 101,
  articulo: 'Producto A',
  cantidad: 2,
  precio_unitario: 100,
  precio_venta: 120,
  total: 200,
  total_pedido: 200,
};

const articulo: any = {
  codigo_articulo: 101,
  descripcion: 'Producto A',
  precio_costo: 100,
  precio_venta: 120,
  rentabilidad_minima: 0.05,
  stock_actual: 10,
  venta_tipo: 'unidad',
} as any;

describe('DetallePedidosServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockValidations.detallePedidoValidator.validateData as jest.Mock).mockReturnValue([]);
    (mockValidations.validarArticuloExiste as jest.Mock).mockReturnValue(null);
    (mockValidations.validarStock as jest.Mock).mockReturnValue(null);
    (mockValidations.validarPrecioMinimo as jest.Mock).mockReturnValue(null);
    (mockValidations.validarFraccion as jest.Mock).mockReturnValue(undefined);
    mockArticulosRepo.getArticulosBySearch.mockResolvedValue({ articulos: [articulo], page: 1, totalPages: 1, total: 1 });
    mockArticulosRepo.getStockArticulo.mockResolvedValue({ stock_actual: 10 });
  });

  describe('validarArticulosParaPedido', () => {
    it('should return the articulos array on happy path', async () => {
      const result = await validarArticulosParaPedido([baseArticulo]);
      expect(result).toEqual([baseArticulo]);
    });

    it('should throw when detallePedidoValidator reports errors', async () => {
      (mockValidations.detallePedidoValidator.validateData as jest.Mock).mockReturnValue([
        { fila: 1, errores: ['cantidad'] },
      ]);
      await expect(validarArticulosParaPedido([baseArticulo])).rejects.toThrow('Dato inválido en campo');
    });

    it('should look up each articulo by codigo_articulo via getArticulosBySearch', async () => {
      await validarArticulosParaPedido([baseArticulo]);
      expect(mockArticulosRepo.getArticulosBySearch).toHaveBeenCalledWith(
        String(baseArticulo.codigo_articulo),
        'M',
        'codigo_articulo'
      );
    });

    it('should throw when articulo is not found (empty search result)', async () => {
      mockArticulosRepo.getArticulosBySearch.mockResolvedValue({ articulos: [], page: 1, totalPages: 0, total: 0 });
      await expect(validarArticulosParaPedido([baseArticulo])).rejects.toThrow(
        `Artículo con código ${baseArticulo.codigo_articulo} no encontrado`
      );
    });

    it('should call validarStock with stock data and requested cantidad', async () => {
      await validarArticulosParaPedido([baseArticulo]);
      expect(mockValidations.validarStock).toHaveBeenCalledWith(
        { stock_actual: 10 },
        baseArticulo.cantidad,
        articulo.en_oferta
      );
    });

    it('should propagate errors thrown by validarStock', async () => {
      (mockValidations.validarStock as jest.Mock).mockImplementation(() => {
        throw new Error('No hay suficiente stock para el artículo');
      });
      await expect(validarArticulosParaPedido([baseArticulo])).rejects.toThrow('stock');
    });

    it('should call validarPrecioMinimo with articulo and precio_venta', async () => {
      await validarArticulosParaPedido([baseArticulo]);
      expect(mockValidations.validarPrecioMinimo).toHaveBeenCalledWith(
        articulo,
        baseArticulo.precio_venta
      );
    });

    it('should propagate errors thrown by validarPrecioMinimo', async () => {
      (mockValidations.validarPrecioMinimo as jest.Mock).mockImplementation(() => {
        throw new Error('El precio ingresado es menor al mínimo permitido');
      });
      await expect(validarArticulosParaPedido([baseArticulo])).rejects.toThrow('precio');
    });

    it('should validate each articulo when multiple are provided', async () => {
      const second = { ...baseArticulo, codigo_articulo: 102 };
      mockArticulosRepo.getArticulosBySearch
        .mockResolvedValueOnce({ articulos: [articulo], page: 1, totalPages: 1, total: 1 })
        .mockResolvedValueOnce({ articulos: [{ ...articulo, codigo_articulo: 102 }], page: 1, totalPages: 1, total: 1 });
      await validarArticulosParaPedido([baseArticulo, second]);
      expect(mockArticulosRepo.getArticulosBySearch).toHaveBeenCalledTimes(2);
    });

    it('should call validarFraccion with articulo and cantidad', async () => {
      await validarArticulosParaPedido([baseArticulo]);
      expect(mockValidations.validarFraccion).toHaveBeenCalledWith(articulo, baseArticulo.cantidad);
    });

    it('should propagate errors thrown by validarFraccion', async () => {
      (mockValidations.validarFraccion as jest.Mock).mockImplementation(() => {
        throw new Error('La cantidad debe ser un número entero para este tipo de artículo');
      });
      await expect(validarArticulosParaPedido([baseArticulo])).rejects.toThrow('entero');
    });
  });

  describe('updateArticuloInPedido', () => {
    it('should call addArticuloToPedido when action is add', async () => {
      const articuloToAdd = { ...baseArticulo, codigo_articulo: 103 };
      await updateArticuloInPedidoService(1, articuloToAdd, 'add');
      expect(mockDetallePedidosRepo.addArticuloToPedido).toHaveBeenCalledWith(1, articuloToAdd);
    });

    it('should call removeArticuloFromPedido when action is remove', async () => {
      const articuloToRemove = { ...baseArticulo, codigo_articulo: 101 };
      await updateArticuloInPedidoService(1, articuloToRemove, 'remove');
      expect(mockDetallePedidosRepo.removeArticuloFromPedido).toHaveBeenCalledWith(1, articuloToRemove);
    });

    it('should call upsertArticuloInPedido when action is update', async () => {
      const articuloToUpdate = { ...baseArticulo, codigo_articulo: 101, cantidad: 5 };
      await updateArticuloInPedidoService(1, articuloToUpdate, 'update');
      expect(mockValidations.detallePedidoValidator.validateData).toHaveBeenCalledWith(articuloToUpdate);
      expect(mockDetallePedidosRepo.upsertArticuloInPedido).toHaveBeenCalledWith(1, articuloToUpdate);
    });
  });

  describe('fetchDetallePedido', () => {
    it('should return detalle from repo', async () => {
      const detalle = [{ codigo_articulo: 101 }] as any;
      mockDetallePedidosRepo.getDetallePedido.mockResolvedValue({ detalle } as any);
      const result = await fetchDetallePedido(7);
      expect(mockDetallePedidosRepo.getDetallePedido).toHaveBeenCalledWith(7);
      expect(result).toBe(detalle);
    });

    it('should return null when repo has no detalle', async () => {
      mockDetallePedidosRepo.getDetallePedido.mockResolvedValue({ detalle: null } as any);
      const result = await fetchDetallePedido(99);
      expect(result).toBeNull();
    });
  });
});

describe('validarFraccion (unit)', () => {
  it('allows integer cantidad for unidad', () => {
    expect(() => realValidarFraccion({ venta_tipo: 'unidad' }, 3)).not.toThrow();
  });

  it('throws for fractional cantidad when venta_tipo is unidad', () => {
    expect(() => realValidarFraccion({ venta_tipo: 'unidad' }, 1.5)).toThrow('entero');
  });

  it('allows fractional cantidad when venta_tipo is kilogramo', () => {
    expect(() => realValidarFraccion({ venta_tipo: 'kilogramo' }, 1.5)).not.toThrow();
  });

  it('allows integer cantidad when venta_tipo is kilogramo', () => {
    expect(() => realValidarFraccion({ venta_tipo: 'kilogramo' }, 2)).not.toThrow();
  });

  it('throws for fractional cantidad when venta_tipo is litro', () => {
    expect(() => realValidarFraccion({ venta_tipo: 'litro' }, 0.75)).toThrow('entero');
  });

  it('throws for fractional cantidad when venta_tipo is undefined', () => {
    expect(() => realValidarFraccion({}, 2.5)).toThrow('entero');
  });
});
