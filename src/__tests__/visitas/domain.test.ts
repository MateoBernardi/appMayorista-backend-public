jest.mock('../../adapters/db/visitasRepo');

import * as visitasRepo from '../../adapters/db/visitasRepo';
import {
  registerVisita,
  fetchVisitasByCliente,
  editVisita,
  removeVisita,
} from '../../domain/services/visitasServices';

const mockRepo = jest.mocked(visitasRepo);

describe('VisitasServices', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('registerVisita', () => {
    it('should create a visita and return its id', async () => {
      mockRepo.createVisita.mockResolvedValue(42);
      const result = await registerVisita(1, 'Exitosa', null, null);
      expect(mockRepo.createVisita).toHaveBeenCalledWith(1, 'Exitosa', null, null);
      expect(result).toBe(42);
    });

    it('should throw when resultado is empty string', async () => {
      await expect(registerVisita(1, '', null, null)).rejects.toThrow('El resultado es requerido');
      expect(mockRepo.createVisita).not.toHaveBeenCalled();
    });

    it('should throw when resultado is only whitespace', async () => {
      await expect(registerVisita(1, '   ', null, null)).rejects.toThrow('El resultado es requerido');
    });

    it('should forward optional fields to the repo', async () => {
      mockRepo.createVisita.mockResolvedValue(10);
      const proxima = new Date('2026-06-01');
      await registerVisita(5, 'Exitosa', 'obs', proxima);
      expect(mockRepo.createVisita).toHaveBeenCalledWith(5, 'Exitosa', 'obs', proxima);
    });
  });

  describe('fetchVisitasByCliente', () => {
    it('should delegate to repo and return its result', async () => {
      const visitas = [{ id: 1, resultado: 'Exitosa' }] as any;
      mockRepo.getVisitasByCliente.mockResolvedValue(visitas);
      const result = await fetchVisitasByCliente(3);
      expect(mockRepo.getVisitasByCliente).toHaveBeenCalledWith(3);
      expect(result).toBe(visitas);
    });
  });

  describe('editVisita', () => {
    it('should throw when no fields are provided', async () => {
      await expect(editVisita(1, {})).rejects.toThrow('No se enviaron campos para actualizar');
      expect(mockRepo.updateVisita).not.toHaveBeenCalled();
    });

    it('should throw when repo returns null (not found)', async () => {
      mockRepo.updateVisita.mockResolvedValue(null as any);
      await expect(editVisita(99, { resultado: 'ok' })).rejects.toThrow('Visita no encontrada');
    });

    it('should return the updated visita on success', async () => {
      const updated = { id: 1, resultado: 'ok' } as any;
      mockRepo.updateVisita.mockResolvedValue(updated);
      const result = await editVisita(1, { resultado: 'ok' });
      expect(mockRepo.updateVisita).toHaveBeenCalledWith(1, { resultado: 'ok' });
      expect(result).toBe(updated);
    });
  });

  describe('removeVisita', () => {
    it('should throw when repo returns null (not found)', async () => {
      mockRepo.softDeleteVisita.mockResolvedValue(null as any);
      await expect(removeVisita(99)).rejects.toThrow('Visita no encontrada');
    });

    it('should return the deleted visita on success', async () => {
      const deleted = { id: 1 } as any;
      mockRepo.softDeleteVisita.mockResolvedValue(deleted);
      const result = await removeVisita(1);
      expect(mockRepo.softDeleteVisita).toHaveBeenCalledWith(1);
      expect(result).toBe(deleted);
    });
  });
});
