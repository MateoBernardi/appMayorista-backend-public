/**
 * Tests de dominio: novedadesServices
 * Capa: Domain Service
 * Plataforma: Interno (novedades/anuncios)
 */

jest.mock('../../adapters/db/novedadesRepo');

import { fetchNovedades, addNovedad, removeNovedad, modifyNovedad } from '../../domain/services/novedadesServices';
import * as novedadesRepo from '../../adapters/db/novedadesRepo';

const mockRepo = jest.mocked(novedadesRepo);

describe('NovedadesServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── fetchNovedades ────────────

  describe('fetchNovedades', () => {
    it('debería retornar novedades sin llamar a expireNovedad (se ejecuta por cron)', async () => {
      mockRepo.getNovedades.mockResolvedValue([]);
      
      await fetchNovedades();
      
      expect(mockRepo.getNovedades).toHaveBeenCalled();
      expect(mockRepo.expireNovedad).not.toHaveBeenCalled();
    });

    it('debería retornar lista de novedades', async () => {
      mockRepo.getNovedades.mockResolvedValue([
        { id: 1, titulo: 'Nov1' },
        { id: 2, titulo: 'Nov2' },
      ] as any);

      const result = await fetchNovedades();
      expect(result).toHaveLength(2);
    });
  });

  // ──────────── addNovedad ────────────

  describe('addNovedad', () => {
    it('debería crear novedad con todos los campos', async () => {
      mockRepo.createNovedad.mockResolvedValue({ id: 1, titulo: 'Test' } as any);
      const result = await addNovedad('Titulo', 'Desc', 1, 2, 10);
      expect(mockRepo.createNovedad).toHaveBeenCalledWith('Titulo', 'Desc', 1, 2, 10);
      expect(result).toHaveProperty('id');
    });
  });

  // ──────────── removeNovedad ────────────

  describe('removeNovedad', () => {
    it('debería eliminar novedad por id', async () => {
      mockRepo.deleteNovedad.mockResolvedValue({ id: 5 });
      const result = await removeNovedad(5);
      expect(result).toEqual({ id: 5 });
    });
  });

  // ──────────── modifyNovedad ────────────

  describe('modifyNovedad', () => {
    it('debería actualizar novedad con datos proporcionados', async () => {
      mockRepo.updateNovedad.mockResolvedValue({ id: 1, titulo: 'Updated' } as any);
      const result = await modifyNovedad(1, 'Updated', 'NewDesc', 2, 3, 10);
      expect(mockRepo.updateNovedad).toHaveBeenCalledWith(1, 'Updated', 'NewDesc', 2, 3, 10);
    });
  });
});
