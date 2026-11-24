jest.mock('../../domain/services/articulosOfertasServices');

import { createMockReqRes } from '../helpers/testHelpers';
import { listarOfertasController } from '../../controllers/articulosOfertasController';
import * as articulosOfertasService from '../../domain/services/articulosOfertasServices';

const service = jest.mocked(articulosOfertasService);

describe('ArticulosOfertas Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── listarOfertasController ────────────

  describe('listarOfertasController', () => {
    it('debería consultar sin rubro cuando no se especifica', async () => {
      service.listarOfertasService.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({ query: { activas: 'true' } });

      await listarOfertasController(req, res, next);

      expect(res.json).toHaveBeenCalled();
      expect(service.listarOfertasService).toHaveBeenCalledWith(true, undefined);
    });

    it('debería pasar el rubro de la query al servicio', async () => {
      service.listarOfertasService.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({ query: { activas: 'true', rubro: 'I' } });

      await listarOfertasController(req, res, next);

      expect(service.listarOfertasService).toHaveBeenCalledWith(true, 'I');
    });
  });
});
