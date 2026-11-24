jest.mock('../../adapters/db/articulosOfertasRepo');

import { listarOfertasService } from '../../domain/services/articulosOfertasServices';
import * as articulosOfertasRepo from '../../adapters/db/articulosOfertasRepo';

const mockRepo = jest.mocked(articulosOfertasRepo);

describe('ArticulosOfertasServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── listarOfertasService ────────────

  describe('listarOfertasService', () => {
    it('debería pasar soloActivas al repo sin rubro por defecto', async () => {
      mockRepo.listarOfertasConArticulo.mockResolvedValue([]);

      await listarOfertasService(true);

      expect(mockRepo.listarOfertasConArticulo).toHaveBeenCalledWith(true, undefined);
    });

    it('debería pasar el rubro opcional al repo', async () => {
      mockRepo.listarOfertasConArticulo.mockResolvedValue([]);

      await listarOfertasService(true, 'I');

      expect(mockRepo.listarOfertasConArticulo).toHaveBeenCalledWith(true, 'I');
    });
  });
});
