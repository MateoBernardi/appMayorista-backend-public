jest.mock('../../adapters/db/articulosRepo');
jest.mock('../../domain/validations/articulosValidations');

import {
  fetchArticulos,
  fetchArticulosBySearch,
  syncArticulos,
  eliminarArticulosSinStock,
  procesarArticulosService,
  generarTXTStockService,
} from '../../domain/services/articulosServices';
import * as articulosRepo from '../../adapters/db/articulosRepo';
import * as articulosValidations from '../../domain/validations/articulosValidations';

const mockRepo = jest.mocked(articulosRepo);
const mockValidations = jest.mocked(articulosValidations);

describe('ArticulosServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── fetchArticulos ────────────

  describe('fetchArticulos', () => {
    it('debería pasar parámetros de paginación al repo', async () => {
      mockRepo.getAllArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);

      await fetchArticulos('electro', 2, 20);

      expect(mockRepo.getAllArticulos).toHaveBeenCalledWith('electro', 2, 20, undefined, undefined);
    });

    it('debería pasar filtro opcional al repo', async () => {
      mockRepo.getAllArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);

      await fetchArticulos('electro', 1, 30, 'mayor_stock');

      expect(mockRepo.getAllArticulos).toHaveBeenCalledWith('electro', 1, 30, 'mayor_stock', undefined);
    });

    it('debería pasar soloOfertas opcional al repo', async () => {
      mockRepo.getAllArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);

      await fetchArticulos('electro', 1, 30, undefined, true);

      expect(mockRepo.getAllArticulos).toHaveBeenCalledWith('electro', 1, 30, undefined, true);
    });
  });

  // ──────────── fetchArticulosBySearch ────────────

  describe('fetchArticulosBySearch', () => {
    it('debería detectar campo codigo_articulo para búsqueda numérica', async () => {
      mockValidations.validateSearchField.mockReturnValue(true);
      mockRepo.getArticulosBySearch.mockResolvedValue({ articulos: [], page: 1, totalPages: 0, total: 0 });

      await fetchArticulosBySearch('12345', 'rubro1');

      expect(mockRepo.getArticulosBySearch).toHaveBeenCalledWith('12345', 'rubro1', 'codigo_articulo', 1, 30);
    });

    it('debería detectar campo descripcion para búsqueda con letras', async () => {
      mockValidations.validateSearchField.mockReturnValue(true);
      mockRepo.getArticulosBySearch.mockResolvedValue({ articulos: [], page: 1, totalPages: 0, total: 0 });

      await fetchArticulosBySearch('cable usb', 'rubro1');

      expect(mockRepo.getArticulosBySearch).toHaveBeenCalledWith('cable usb', 'rubro1', 'descripcion', 1, 30);
    });

    it('debería usar campo explícito si se especifica', async () => {
      mockValidations.validateSearchField.mockReturnValue(true);
      mockRepo.getArticulosBySearch.mockResolvedValue({ articulos: [], page: 1, totalPages: 0, total: 0 });

      await fetchArticulosBySearch('test', 'rubro1', 'descripcion');

      expect(mockRepo.getArticulosBySearch).toHaveBeenCalledWith('test', 'rubro1', 'descripcion', 1, 30);
    });

    it('debería pasar page y limit al repo', async () => {
      mockValidations.validateSearchField.mockReturnValue(true);
      mockRepo.getArticulosBySearch.mockResolvedValue({ articulos: [], page: 2, totalPages: 0, total: 0 });

      await fetchArticulosBySearch('test', 'rubro1', 'descripcion', 2, 15);

      expect(mockRepo.getArticulosBySearch).toHaveBeenCalledWith('test', 'rubro1', 'descripcion', 2, 15);
    });

    it('debería retornar vacío si validateSearchField falla', async () => {
      mockValidations.validateSearchField.mockReturnValue(false);

      const result = await fetchArticulosBySearch('', 'rubro1');

      expect(result).toEqual({ articulos: [], page: 1, totalPages: 0, total: 0 });
      expect(mockRepo.getArticulosBySearch).not.toHaveBeenCalled();
    });
  });

  // ──────────── syncArticulos ────────────

  describe('syncArticulos', () => {
    it('debería llamar validarOArrojar antes de procesar', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => {});
      mockRepo.updateArticulosListRepo.mockResolvedValue(1 as any);
      mockRepo.getArticulosSinStock.mockResolvedValue([]);
      mockValidations.codigosAEliminar.mockReturnValue([]);

      await syncArticulos([{ codigo_articulo: 1, descripcion: 'Test' }] as any);

      expect(mockValidations.validarOArrojar).toHaveBeenCalled();
    });

    it('debería lanzar error si la validación falla', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => { throw new Error('Datos inválidos'); });

      await expect(syncArticulos([{} as any])).rejects.toThrow('Datos inválidos');
      expect(mockRepo.updateArticulosListRepo).not.toHaveBeenCalled();
    });

    it('debería llamar upsert y luego eliminar artículos sin stock', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => {});
      const articulo = { codigo_articulo: 1, descripcion: 'Test' } as any;
      mockRepo.updateArticulosListRepo.mockResolvedValue(1 as any);
      mockRepo.getArticulosSinStock.mockResolvedValue([{ codigo_articulo: 999 }] as any);
      mockValidations.codigosAEliminar.mockReturnValue([999]);
      mockRepo.deleteArticulosBulk.mockResolvedValue(undefined as any);

      await syncArticulos([articulo]);

      expect(mockRepo.updateArticulosListRepo).toHaveBeenCalledWith([articulo]);
      expect(mockRepo.deleteArticulosBulk).toHaveBeenCalledWith([999]);
    });
  });

  // ──────────── eliminarArticulosSinStock ────────────

  describe('eliminarArticulosSinStock', () => {
    it('debería eliminar los códigos en la intersección', async () => {
      const articulos = [{ codigo_articulo: 1 }, { codigo_articulo: 2 }] as any;
      mockRepo.getArticulosSinStock.mockResolvedValue([{ codigo_articulo: 1 }] as any);
      mockValidations.codigosAEliminar.mockReturnValue([1]);
      mockRepo.deleteArticulosBulk.mockResolvedValue(undefined as any);

      await eliminarArticulosSinStock(articulos);

      expect(mockRepo.deleteArticulosBulk).toHaveBeenCalledWith([1]);
      expect(mockRepo.deleteArticulosBulk).toHaveBeenCalledTimes(1);
    });

    it('debería eliminar múltiples códigos en la intersección', async () => {
      mockRepo.getArticulosSinStock.mockResolvedValue([{ codigo_articulo: 1 }, { codigo_articulo: 3 }] as any);
      mockValidations.codigosAEliminar.mockReturnValue([1, 3]);
      mockRepo.deleteArticulosBulk.mockResolvedValue(undefined as any);

      await eliminarArticulosSinStock([{ codigo_articulo: 1 }, { codigo_articulo: 3 }] as any);

      expect(mockRepo.deleteArticulosBulk).toHaveBeenCalledWith([1, 3]);
    });
  });

  // ──────────── procesarArticulosService ────────────

  describe('procesarArticulosService', () => {
    const makeArticulo = (overrides = {}) => ({
      codigo_articulo: 1,
      descripcion: 'Articulo Test',
      cod_barra_articulo: 100,
      cod_barra_caja: 200,
      cant_unidades_caja: 12,
      precio_costo: 10.5,
      precio_venta: 15.0,
      precio_venta_volumen: 14.0,
      stock_actual: 50,
      rentabilidad_minima: 0.3,
      rubro: 'M',
      venta_tipo: 'unidad' as const,
      ...overrides,
    });

    it('debería retornar 0 con lista vacía sin llamar al repo', async () => {
      const result = await procesarArticulosService([]);

      expect(result).toBe(0);
      expect(mockRepo.updateArticulosListRepo).not.toHaveBeenCalled();
      expect(mockRepo.deleteArticulosBulk).not.toHaveBeenCalled();
    });

    it('debería pasar todos los DTOs al repo sin modificarlos', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => {});
      mockRepo.getArticulosSinStock.mockResolvedValue([]);
      mockValidations.codigosAEliminar.mockReturnValue([]);
      const dtos = [makeArticulo(), makeArticulo({ codigo_articulo: 2 }), makeArticulo({ codigo_articulo: 3 })];
      mockRepo.updateArticulosListRepo.mockResolvedValue(1 as any);

      await procesarArticulosService(dtos as any);

      expect(mockValidations.validarOArrojar).toHaveBeenCalledWith(dtos);
      expect(mockRepo.updateArticulosListRepo).toHaveBeenCalledWith(dtos);
    });

    it('debería retornar el conteo reportado por el repo', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => {});
      mockRepo.getArticulosSinStock.mockResolvedValue([]);
      mockValidations.codigosAEliminar.mockReturnValue([]);
      mockRepo.updateArticulosListRepo.mockResolvedValue(3 as any);

      const result = await procesarArticulosService([makeArticulo(), makeArticulo({ codigo_articulo: 2 }), makeArticulo({ codigo_articulo: 3 })] as any);

      expect(result).toBe(3);
    });

    it('debería ejecutar la eliminación después del upsert', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => {});
      mockRepo.updateArticulosListRepo.mockResolvedValue(1 as any);
      mockRepo.getArticulosSinStock.mockResolvedValue([{ codigo_articulo: 999 }] as any);
      mockValidations.codigosAEliminar.mockReturnValue([999]);
      mockRepo.deleteArticulosBulk.mockResolvedValue(undefined as any);

      await procesarArticulosService([makeArticulo()] as any);

      expect(mockRepo.deleteArticulosBulk).toHaveBeenCalledWith([999]);
    });

    it('debería propagar error de validación sin llamar al repo', async () => {
      mockValidations.validarOArrojar.mockImplementation(() => { throw new Error('Datos inválidos'); });

      await expect(procesarArticulosService([makeArticulo()] as any)).rejects.toThrow('Datos inválidos');
      expect(mockRepo.updateArticulosListRepo).not.toHaveBeenCalled();
    });
  });

  // ──────────── generarTXTStockService ────────────

  describe('generarTXTStockService', () => {
    const articuloBase = {
      codigo_articulo: 1,
      descripcion: 'ARROZ X 1KG',
      cod_barra_articulo: 7791122002074,
      cod_barra_caja: 0,
      cant_unidades_caja: 10,
      precio_costo: 100.50,
      precio_venta: 150.00,
      precio_venta_volumen: 140.00,
      stock_actual: 5,
      rentabilidad_minima: 0.15,
      rubro: 'M',
      venta_tipo: 'unidad',
    };

    it('debería generar línea con formato INFOZONE correcto', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([articuloBase] as any);

      const { contenido } = await generarTXTStockService();

      const expectedLine =
        '000001;' +
        'ARROZ X 1KG                             ;' +
        '7791122002074;' +
        '              ;' +
        '0010;' +
        '000000100.50;' +
        '000000150.00;' +
        '000000140.00;' +
        '000005.000;' +
        '015.000;' +
        'MU';

      expect(contenido).toBe(expectedLine);
    });

    it('debería preservar decimales en stock_actual', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        { ...articuloBase, stock_actual: 2.75 },
      ] as any);

      const { contenido } = await generarTXTStockService();
      const fields = contenido.split(';');

      expect(fields[8]).toBe('02.750');
    });

    it('debería usar espacios cuando barcodes son 0 o undefined', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        { ...articuloBase, cod_barra_articulo: 0, cod_barra_caja: undefined },
      ] as any);

      const { contenido } = await generarTXTStockService();
      const fields = contenido.split(';');

      expect(fields[2]).toBe('             ');  // 13 espacios
      expect(fields[3]).toBe('              ');  // 14 espacios
    });

    it('debería zero-padear barcodes no nulos', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        { ...articuloBase, cod_barra_articulo: 123, cod_barra_caja: 456 },
      ] as any);

      const { contenido } = await generarTXTStockService();
      const fields = contenido.split(';');

      expect(fields[2]).toBe('0000000000123');   // 13 chars
      expect(fields[3]).toBe('00000000000456');  // 14 chars
    });

    it('debería preservar el stock decimal (kg) sin truncar', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        { ...articuloBase, venta_tipo: 'kilogramo', stock_actual: 5.25 },
      ] as any);

      const { contenido } = await generarTXTStockService();
      const fields = contenido.split(';');

      expect(fields[8]).toBe('000005.250');
    });

    it('debería usar K para venta_tipo kilogramo', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        { ...articuloBase, venta_tipo: 'kilogramo' },
      ] as any);

      const { contenido } = await generarTXTStockService();

      expect(contenido.endsWith('MK')).toBe(true);
    });

    it('debería formatear rentabilidad_minima de 0 como 000.000', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        { ...articuloBase, rentabilidad_minima: 0 },
      ] as any);

      const { contenido } = await generarTXTStockService();
      const fields = contenido.split(';');

      expect(fields[9]).toBe('000.000');
    });

    it('debería generar múltiples líneas separadas por \\r\\n', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([
        articuloBase,
        { ...articuloBase, codigo_articulo: 2, descripcion: 'YERBA X 500G' },
      ] as any);

      const { contenido } = await generarTXTStockService();
      const lineas = contenido.split('\r\n');

      expect(lineas).toHaveLength(2);
      expect(lineas[0]).toContain('000001');
      expect(lineas[1]).toContain('000002');
    });

    it('debería retornar fileName con la fecha actual', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([articuloBase] as any);

      const { fileName } = await generarTXTStockService();

      expect(fileName).toMatch(/^articulos_sobrante_\d{4}-\d{2}-\d{2}\.txt$/);
    });

    it('debería retornar contenido vacío si no hay artículos sobrantes', async () => {
      mockRepo.getArticulosSobranteMayorista.mockResolvedValue([]);

      const { contenido } = await generarTXTStockService();

      expect(contenido).toBe('');
    });
  });
});
