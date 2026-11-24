jest.mock('../../adapters/db/web/novedadesWebRepo');

import {
  addNovedadWeb,
  fetchNovedadWebOrThrow,
  modifyNovedadWeb,
  removeNovedadWeb,
  sweepNovedadesWebPublicacionProgramada,
} from '../../domain/services/web/novedadesWebServices';
import * as novedadesWebRepo from '../../adapters/db/web/novedadesWebRepo';
import { BadRequestError, NotFoundError } from '../../adapters/errors/AppError';
import { NovedadWebDTO } from '../../domain/dto/NovedadWebDTO';

const mockRepo = jest.mocked(novedadesWebRepo);

const baseNovedad: NovedadWebDTO = {
  id: 1,
  titulo: 'Título',
  preview: 'Resumen',
  cuerpo: 'Cuerpo',
  imagen: null,
  publicada_en: new Date(),
  estado: 'Borrador',
  created_by: 1,
  created_at: new Date(),
  updated_at: null,
  deleted_at: null,
};

describe('NovedadesWebServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── addNovedadWeb (validación) ────────────

  describe('addNovedadWeb', () => {
    it('debería rechazar un título vacío', async () => {
      await expect(addNovedadWeb({ titulo: '', preview: 'x', cuerpo: 'y', created_by: 1 })).rejects.toBeInstanceOf(BadRequestError);
    });

    it('debería rechazar un título mayor a 140 caracteres', async () => {
      await expect(addNovedadWeb({ titulo: 'a'.repeat(141), preview: 'x', cuerpo: 'y', created_by: 1 })).rejects.toBeInstanceOf(BadRequestError);
    });

    it('debería rechazar un preview vacío', async () => {
      await expect(addNovedadWeb({ titulo: 'x', preview: '', cuerpo: 'y', created_by: 1 })).rejects.toBeInstanceOf(BadRequestError);
    });

    it('debería rechazar un preview mayor a 280 caracteres', async () => {
      await expect(addNovedadWeb({ titulo: 'x', preview: 'a'.repeat(281), cuerpo: 'y', created_by: 1 })).rejects.toBeInstanceOf(BadRequestError);
    });

    it('debería rechazar cuerpo vacío', async () => {
      await expect(addNovedadWeb({ titulo: 'x', preview: 'y', cuerpo: '', created_by: 1 })).rejects.toBeInstanceOf(BadRequestError);
    });

    it('debería rechazar un estado inválido', async () => {
      await expect(
        addNovedadWeb({ titulo: 'x', preview: 'y', cuerpo: 'z', created_by: 1, estado: 'Archivada' as any })
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('debería crear la novedad pasando los datos al repo', async () => {
      mockRepo.createNovedadWeb.mockResolvedValue(baseNovedad);

      await addNovedadWeb({ titulo: 'x', preview: 'y', cuerpo: 'z', created_by: 1, estado: 'Publicada' });

      expect(mockRepo.createNovedadWeb).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: 'x', preview: 'y', cuerpo: 'z', created_by: 1, estado: 'Publicada' })
      );
    });
  });

  // ──────────── fetchNovedadWebOrThrow ────────────

  describe('fetchNovedadWebOrThrow', () => {
    it('debería lanzar NotFoundError si no existe', async () => {
      mockRepo.getNovedadWebById.mockResolvedValue(undefined);

      await expect(fetchNovedadWebOrThrow(999)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ──────────── modifyNovedadWeb ────────────

  describe('modifyNovedadWeb', () => {
    it('debería lanzar NotFoundError al actualizar una novedad inexistente', async () => {
      mockRepo.getNovedadWebById.mockResolvedValue(undefined);

      await expect(modifyNovedadWeb(999, { titulo: 'nuevo' })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('debería rechazar un estado inválido en la actualización', async () => {
      await expect(modifyNovedadWeb(1, { estado: 'archivado' as any })).rejects.toBeInstanceOf(BadRequestError);
      expect(mockRepo.getNovedadWebById).not.toHaveBeenCalled();
    });

    it('debería actualizar pasando los campos provistos al repo', async () => {
      mockRepo.getNovedadWebById.mockResolvedValue(baseNovedad);
      mockRepo.updateNovedadWeb.mockResolvedValue({ ...baseNovedad, estado: 'Publicada' });

      await modifyNovedadWeb(1, { estado: 'Publicada' });

      expect(mockRepo.updateNovedadWeb).toHaveBeenCalledWith(1, { estado: 'Publicada' });
    });
  });

  // ──────────── removeNovedadWeb ────────────

  describe('removeNovedadWeb', () => {
    it('debería lanzar NotFoundError al eliminar una novedad inexistente', async () => {
      mockRepo.deleteNovedadWeb.mockResolvedValue(undefined);

      await expect(removeNovedadWeb(999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('debería devolver el id al eliminar correctamente', async () => {
      mockRepo.deleteNovedadWeb.mockResolvedValue(baseNovedad);

      await expect(removeNovedadWeb(1)).resolves.toEqual({ id: 1 });
    });
  });

  // ──────────── sweepNovedadesWebPublicacionProgramada ────────────

  describe('sweepNovedadesWebPublicacionProgramada', () => {
    it('debería devolver los ids publicados por el repo', async () => {
      mockRepo.sweepNovedadesWebProgramadas.mockResolvedValue([1, 2]);

      await expect(sweepNovedadesWebPublicacionProgramada()).resolves.toEqual([1, 2]);
    });
  });
});
