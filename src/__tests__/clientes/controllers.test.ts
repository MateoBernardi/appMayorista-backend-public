jest.mock('../../domain/services/clientesServices');

import { createMockReqRes } from '../helpers/testHelpers';
import { searchClientesController } from '../../controllers/clientesControllers';
import * as clientesService from '../../domain/services/clientesServices';

const service = jest.mocked(clientesService);

describe('Clientes Controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchClientesController', () => {
    it('debería retornar 400 si falta el parámetro query', async () => {
      const { req, res, next } = createMockReqRes({ query: {} });

      await searchClientesController(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: "Parámetro de búsqueda 'query' inválido" })
      );
      expect(service.searchClientesService).not.toHaveBeenCalled();
    });

    it('debería retornar 400 si query es solo espacios', async () => {
      const { req, res, next } = createMockReqRes({ query: { query: '   ' } });

      await searchClientesController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(service.searchClientesService).not.toHaveBeenCalled();
    });

    it('debería retornar clientes para una búsqueda válida', async () => {
      service.searchClientesService.mockResolvedValue([{ id_cliente: 1, descripcion: 'Perez' }] as any);
      const { req, res, next } = createMockReqRes({ query: { query: 'Perez' } });

      await searchClientesController(req, res, next);

      expect(service.searchClientesService).toHaveBeenCalledWith('Perez');
      expect(res.json).toHaveBeenCalledWith([{ id_cliente: 1, descripcion: 'Perez' }]);
    });

    it('debería retornar 500 ante error del servicio', async () => {
      service.searchClientesService.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({ query: { query: 'Perez' } });

      await searchClientesController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });
});
