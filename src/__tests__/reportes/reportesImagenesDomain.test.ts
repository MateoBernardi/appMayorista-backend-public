/**
 * Tests de dominio: reportesImagenesServices
 * Capa: Domain Service
 * Plataforma: Interno (RRHH - imágenes de reportes)
 */

jest.mock('../../adapters/db/reportesImagenesRepo');
jest.mock('../../adapters/db/web/imagesRepo');
jest.mock('../../adapters/images/uploadImages', () => ({
  uploadImageToCloudflare: jest.fn(),
  getImageVariants: jest.fn(),
  deleteImageFromCloudflare: jest.fn(),
}));

import * as reportesImagenesRepo from '../../adapters/db/reportesImagenesRepo';
import * as imagesRepo from '../../adapters/db/web/imagesRepo';
import * as uploadImages from '../../adapters/images/uploadImages';
import {
  addImageToReporte,
  removeImageFromReporte,
  fetchImagesByReporteId,
  changeImageOrderForReporte,
  uploadImageWithReporteLink,
} from '../../domain/services/reportesImagenesServices';

const repo = jest.mocked(reportesImagenesRepo);
const imgRepo = jest.mocked(imagesRepo);
const cfUpload = jest.mocked(uploadImages);

const mockLink = {
  id: 1,
  reporte_id: 10,
  image_id: 5,
  orden: 0,
  created_at: '2027-01-01',
  updated_at: '2027-01-01',
  deleted_at: null,
};

const mockImageResult = {
  ...mockLink,
  url: 'https://cdn.example.com/img1.jpg',
  section: 'reportes',
  imagen_descripcion: 'Foto del incidente',
};

describe('ReportesImagenesServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── addImageToReporte ────────────

  describe('addImageToReporte', () => {
    it('debería vincular imagen a reporte con orden', async () => {
      repo.linkImageToReporte.mockResolvedValue(mockLink);

      const result = await addImageToReporte(10, 5, 0);

      expect(repo.linkImageToReporte).toHaveBeenCalledWith({ reporte_id: 10, image_id: 5, orden: 0 });
      expect(result).toEqual(mockLink);
    });
  });

  // ──────────── removeImageFromReporte ────────────

  describe('removeImageFromReporte', () => {
    it('debería desvincular imagen de reporte', async () => {
      repo.unlinkImageFromReporte.mockResolvedValue(mockLink);

      const result = await removeImageFromReporte(10, 5, 0);

      expect(repo.unlinkImageFromReporte).toHaveBeenCalledWith(10, 5, 0);
      expect(result).toEqual(mockLink);
    });

    it('debería retornar undefined si el enlace no existe', async () => {
      repo.unlinkImageFromReporte.mockResolvedValue(undefined);

      const result = await removeImageFromReporte(99, 99, 0);
      expect(result).toBeUndefined();
    });
  });

  // ──────────── fetchImagesByReporteId ────────────

  describe('fetchImagesByReporteId', () => {
    it('debería retornar imágenes del reporte ordenadas', async () => {
      const images = [
        { ...mockImageResult, orden: 0 },
        { ...mockImageResult, image_id: 6, orden: 1, url: 'https://cdn.example.com/img2.jpg' },
      ];
      repo.getImagesByReporteId.mockResolvedValue(images);

      const result = await fetchImagesByReporteId(10);

      expect(repo.getImagesByReporteId).toHaveBeenCalledWith(10);
      expect(result).toHaveLength(2);
      expect(result[0].orden).toBe(0);
      expect(result[1].orden).toBe(1);
    });

    it('debería retornar array vacío si no hay imágenes', async () => {
      repo.getImagesByReporteId.mockResolvedValue([]);

      const result = await fetchImagesByReporteId(99);
      expect(result).toEqual([]);
    });
  });

  // ──────────── changeImageOrderForReporte ────────────

  describe('changeImageOrderForReporte', () => {
    it('debería actualizar orden directamente si no hay conflicto', async () => {
      const updated = { ...mockLink, orden: 2 };
      repo.updateImageOrderForReporte.mockResolvedValue(updated);

      const result = await changeImageOrderForReporte(10, 5, 2);

      expect(repo.updateImageOrderForReporte).toHaveBeenCalledWith(10, 5, 2);
      expect(result.orden).toBe(2);
    });

    it('debería hacer swap si hay conflicto de unique constraint', async () => {
      const uniqueError = new Error('duplicate key') as any;
      uniqueError.code = '23505';
      repo.updateImageOrderForReporte.mockRejectedValue(uniqueError);

      // Simular que la imagen con orden=1 ya existe
      repo.getImagesByReporteId.mockResolvedValueOnce([
        { ...mockImageResult, image_id: 5, orden: 0 },
        { ...mockImageResult, image_id: 6, orden: 1 },
      ]);
      repo.swapImageOrders.mockResolvedValue({ image1_id: 5, order1: 0, image2_id: 6, order2: 1 });
      // Después del swap, consulta actualizada
      repo.getImagesByReporteId.mockResolvedValueOnce([
        { ...mockImageResult, image_id: 5, orden: 1 },
        { ...mockImageResult, image_id: 6, orden: 0 },
      ]);

      const result = await changeImageOrderForReporte(10, 5, 1);

      expect(repo.swapImageOrders).toHaveBeenCalledWith(10, 5, 6);
      expect(result.orden).toBe(1);
    });

    it('debería propagar error si no es conflicto de unique', async () => {
      repo.updateImageOrderForReporte.mockRejectedValue(new Error('DB error'));

      await expect(changeImageOrderForReporte(10, 5, 2)).rejects.toThrow('DB error');
    });
  });

  // ──────────── uploadImageWithReporteLink ────────────

  describe('uploadImageWithReporteLink', () => {
    const uploadParams = {
      file: Buffer.from('fake-image'),
      filename: 'foto.jpg',
      description: 'Foto del incidente',
      reporteId: 10,
      orden: 1,
    };

    const cfResponse = {
      success: true,
      result: {
        id: 'cf-img-123',
        filename: 'foto.jpg',
        uploaded: '2027-01-01',
        requireSignedURLs: false,
        variants: ['https://cdn.cf.com/foto/public'],
      },
    };

    const imageRecord = {
      id: 42,
      url: 'https://cdn.cf.com/foto/public',
      section: 'reportes',
      description: 'Foto del incidente',
      cf_image_id: 'cf-img-123',
    };

    it('debería subir imagen, crear registro y vincular al reporte', async () => {
      cfUpload.uploadImageToCloudflare.mockResolvedValue(cfResponse);
      imgRepo.createImage.mockResolvedValue(imageRecord);
      repo.linkImageToReporte.mockResolvedValue({ ...mockLink, image_id: 42, orden: 1 });

      const result = await uploadImageWithReporteLink(uploadParams);

      expect(cfUpload.uploadImageToCloudflare).toHaveBeenCalledWith({
        file: uploadParams.file,
        filename: 'foto.jpg',
        requireSignedURLs: false,
      });
      expect(imgRepo.createImage).toHaveBeenCalledWith({
        url: 'https://cdn.cf.com/foto/public',
        section: 'reportes',
        description: 'Foto del incidente',
        cf_image_id: 'cf-img-123',
      });
      expect(repo.linkImageToReporte).toHaveBeenCalledWith({
        reporte_id: 10,
        image_id: 42,
        orden: 1,
      });
      expect(result.image).toEqual(imageRecord);
      expect(result.cloudflareData.id).toBe('cf-img-123');
    });

    it('debería propagar error si Cloudflare falla', async () => {
      cfUpload.uploadImageToCloudflare.mockRejectedValue(new Error('CF error'));

      await expect(uploadImageWithReporteLink(uploadParams)).rejects.toThrow('CF error');
    });
  });
});
