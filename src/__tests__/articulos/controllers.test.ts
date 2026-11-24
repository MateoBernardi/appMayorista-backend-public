jest.mock('../../domain/services/articulosServices');

import { createMockReqRes } from '../helpers/testHelpers';
import {
  getArticulos,
  getArticulosBySearch,
  getArticulosPublicBySearch,
  generarTXTStock,
} from '../../controllers/articulosController';
import * as articulosService from '../../domain/services/articulosServices';

const service = jest.mocked(articulosService);

describe('Articulos Controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────── getArticulos ────────────

  describe('getArticulos', () => {
    it('debería retornar artículos con paginación por defecto', async () => {
      service.fetchArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);
      const { req, res, next } = createMockReqRes({ query: { rubro: 'electro' } });

      await getArticulos(req, res, next);

      expect(res.json).toHaveBeenCalled();
      expect(service.fetchArticulos).toHaveBeenCalledWith('electro', 1, 30, undefined, false);
    });

    it('debería respetar parámetros de paginación custom', async () => {
      service.fetchArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);
      const { req, res, next } = createMockReqRes({ query: { rubro: 'electro', page: '3', limit: '50' } });

      await getArticulos(req, res, next);

      expect(service.fetchArticulos).toHaveBeenCalledWith('electro', 3, 50, undefined, false);
    });

    it('debería pasar filtro opcional al servicio', async () => {
      service.fetchArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);
      const { req, res, next } = createMockReqRes({ query: { rubro: 'electro', filter: 'mayor_stock' } });

      await getArticulos(req, res, next);

      expect(service.fetchArticulos).toHaveBeenCalledWith('electro', 1, 30, 'mayor_stock', false);
    });

    it('debería pasar soloOfertas al servicio cuando se solicita', async () => {
      service.fetchArticulos.mockResolvedValue({ articulos: [], total: 0 } as any);
      const { req, res, next } = createMockReqRes({ query: { rubro: 'electro', soloOfertas: 'true' } });

      await getArticulos(req, res, next);

      expect(service.fetchArticulos).toHaveBeenCalledWith('electro', 1, 30, undefined, true);
    });

    it('debería retornar 500 ante error del servicio', async () => {
      service.fetchArticulos.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({ query: { rubro: 'electro' } });

      await getArticulos(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── getArticulosBySearch ────────────

  describe('getArticulosBySearch', () => {
    it('debería retornar 400 si falta parámetro de búsqueda', async () => {
      const { req, res, next } = createMockReqRes({ params: {}, query: {} });

      await getArticulosBySearch(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: 'Parámetro de búsqueda no proporcionado' })
      );
    });

    it('debería retornar artículos para búsqueda válida', async () => {
      service.fetchArticulosBySearch.mockResolvedValue([{ codigo_articulo: 1 }] as any);
      const { req, res, next } = createMockReqRes({
        params: { search: 'cable' },
        query: { rubro: 'electro', campo: 'descripcion' },
      });

      await getArticulosBySearch(req, res, next);

      expect(res.json).toHaveBeenCalledWith([{ codigo_articulo: 1 }]);
      expect(service.fetchArticulosBySearch).toHaveBeenCalledWith('cable', 'electro', 'descripcion', 1, 30);
    });

    it('debería retornar 500 ante error del servicio', async () => {
      service.fetchArticulosBySearch.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        params: { search: 'cable' },
        query: { rubro: 'electro' },
      });

      await getArticulosBySearch(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── getArticulosPublicBySearch ────────────

  describe('getArticulosPublicBySearch', () => {
    it('debería retornar 400 si falta search', async () => {
      const { req, res, next } = createMockReqRes({ params: {}, query: {} });

      await getArticulosPublicBySearch(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: 'Parámetro de búsqueda no proporcionado' })
      );
    });

    it('debería retornar artículos públicos con seccionImagen por defecto', async () => {
      service.fetchArticulosPublicBySearch.mockResolvedValue({ articulos: [] } as any);
      const { req, res, next } = createMockReqRes({
        params: { search: 'arroz' },
        query: { rubro: 'M' },
      });

      await getArticulosPublicBySearch(req, res, next);

      expect(res.json).toHaveBeenCalled();
      expect(service.fetchArticulosPublicBySearch).toHaveBeenCalledWith('arroz', 'M', 'default');
    });

    it('debería pasar seccionImagen personalizada', async () => {
      service.fetchArticulosPublicBySearch.mockResolvedValue({ articulos: [] } as any);
      const { req, res, next } = createMockReqRes({
        params: { search: 'yerba' },
        query: { rubro: 'M', seccionImagen: 'banner' },
      });

      await getArticulosPublicBySearch(req, res, next);

      expect(service.fetchArticulosPublicBySearch).toHaveBeenCalledWith('yerba', 'M', 'banner');
    });

    it('debería retornar 500 ante error del servicio', async () => {
      service.fetchArticulosPublicBySearch.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        params: { search: 'yerba' },
        query: { rubro: 'M' },
      });

      await getArticulosPublicBySearch(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── generarTXTStock ────────────

  describe('generarTXTStock', () => {
    it('debería enviar el archivo TXT con headers y contenido correctos', async () => {
      service.generarTXTStockService.mockResolvedValue({
        fileName: 'articulos_sobrante_2026-06-04.txt',
        contenido: '000001;ARROZ X 1KG;...',
      });
      const { req, res, next } = createMockReqRes({});

      await generarTXTStock(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="articulos_sobrante_2026-06-04.txt"',
      );
      expect(res.send).toHaveBeenCalledWith('000001;ARROZ X 1KG;...');
    });

    it('debería retornar 500 ante error del servicio', async () => {
      service.generarTXTStockService.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({});

      await generarTXTStock(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });
});
