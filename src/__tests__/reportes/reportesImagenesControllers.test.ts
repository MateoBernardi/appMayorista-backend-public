/**
 * Tests de controller: reportesImagenesController
 * Capa: Controller
 * Plataforma: Interno (RRHH - imágenes de reportes)
 */

jest.mock('../../adapters/images/uploadImages', () => ({
  uploadImageToCloudflare: jest.fn(),
}));
jest.mock('../../domain/services/reportesImagenesServices');

import * as reportesImagenesServices from '../../domain/services/reportesImagenesServices';
import { createMockReqRes } from '../helpers/testHelpers';
import {
  linkImageToReporte,
  unlinkImageFromReporte,
  getImagesByReporteId,
  updateImageOrder,
  uploadReporteImage,
} from '../../controllers/reportesImagenesController';

const service = jest.mocked(reportesImagenesServices);

describe('ReportesImagenesController', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── linkImageToReporte ────────────

  describe('linkImageToReporte', () => {
    it('debería retornar 201 al vincular imagen exitosamente', async () => {
      const mockResult = { id: 1, reporte_id: 10, image_id: 5, orden: 0 };
      service.addImageToReporte.mockResolvedValue(mockResult);
      const { req, res, next } = createMockReqRes({
        body: { reporte_id: 10, image_id: 5, orden: 0 },
      });

      await linkImageToReporte(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockResult);
    });

    it('debería retornar 400 si falta reporte_id', async () => {
      const { req, res, next } = createMockReqRes({
        body: { image_id: 5, orden: 0 },
      });

      await linkImageToReporte(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 400 si falta image_id', async () => {
      const { req, res, next } = createMockReqRes({
        body: { reporte_id: 10, orden: 0 },
      });

      await linkImageToReporte(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 400 si falta orden', async () => {
      const { req, res, next } = createMockReqRes({
        body: { reporte_id: 10, image_id: 5 },
      });

      await linkImageToReporte(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 500 si el servicio falla', async () => {
      service.addImageToReporte.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        body: { reporte_id: 10, image_id: 5, orden: 0 },
      });

      await linkImageToReporte(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── unlinkImageFromReporte ────────────

  describe('unlinkImageFromReporte', () => {
    it('debería retornar 200 al desvincular exitosamente', async () => {
      const mockResult = { id: 1, reporte_id: 10, image_id: 5, orden: 0 };
      service.removeImageFromReporte.mockResolvedValue(mockResult);
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10', image_id: '5', orden: '0' },
      });

      await unlinkImageFromReporte(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResult);
    });

    it('debería retornar 404 si el enlace no existe', async () => {
      service.removeImageFromReporte.mockResolvedValue(undefined);
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '99', image_id: '99', orden: '0' },
      });

      await unlinkImageFromReporte(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 500 si el servicio falla', async () => {
      service.removeImageFromReporte.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10', image_id: '5', orden: '0' },
      });

      await unlinkImageFromReporte(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── getImagesByReporteId ────────────

  describe('getImagesByReporteId', () => {
    it('debería retornar 200 con imágenes del reporte', async () => {
      const images = [{ url: 'https://cdn.example.com/img1.jpg', orden: 0 }];
      service.fetchImagesByReporteId.mockResolvedValue(images);
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10' },
      });

      await getImagesByReporteId(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(images);
    });

    it('debería retornar 200 con array vacío si no hay imágenes', async () => {
      service.fetchImagesByReporteId.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '99' },
      });

      await getImagesByReporteId(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('debería retornar 500 si el servicio falla', async () => {
      service.fetchImagesByReporteId.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10' },
      });

      await getImagesByReporteId(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── updateImageOrder ────────────

  describe('updateImageOrder', () => {
    it('debería retornar 200 al actualizar orden exitosamente', async () => {
      const mockResult = { id: 1, reporte_id: 10, image_id: 5, orden: 2 };
      service.changeImageOrderForReporte.mockResolvedValue(mockResult);
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10', image_id: '5' },
        body: { newOrder: 2 },
      });

      await updateImageOrder(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResult);
    });

    it('debería retornar 400 si falta newOrder', async () => {
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10', image_id: '5' },
        body: {},
      });

      await updateImageOrder(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 404 si no se encuentra el enlace', async () => {
      service.changeImageOrderForReporte.mockResolvedValue(undefined);
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10', image_id: '5' },
        body: { newOrder: 2 },
      });

      await updateImageOrder(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 500 si el servicio falla', async () => {
      service.changeImageOrderForReporte.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        params: { reporte_id: '10', image_id: '5' },
        body: { newOrder: 2 },
      });

      await updateImageOrder(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── uploadReporteImage ────────────

  describe('uploadReporteImage', () => {
    const mockUploadResult = {
      image: { id: 42, url: 'https://cdn.cf.com/foto/public', section: 'reportes' },
      reporteLink: { reporte_id: 10, image_id: 42, orden: 1 },
      cloudflareData: { id: 'cf-123', variants: ['https://cdn.cf.com/foto/public'], url: 'https://cdn.cf.com/foto/public' },
    };

    it('debería retornar 201 al subir imagen y vincularla', async () => {
      service.uploadImageWithReporteLink.mockResolvedValue(mockUploadResult);
      const { req, res, next } = createMockReqRes({
        body: { reporteId: '10', description: 'Foto incidente', orden: '1' },
        file: { buffer: Buffer.from('img'), originalname: 'foto.jpg', mimetype: 'image/jpeg' },
      });

      await uploadReporteImage(req, res, next);

      expect(service.uploadImageWithReporteLink).toHaveBeenCalledWith({
        file: expect.any(Buffer),
        filename: 'foto.jpg',
        description: 'Foto incidente',
        reporteId: 10,
        orden: 1,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockUploadResult);
    });

    it('debería retornar 400 si no se envía archivo', async () => {
      const { req, res, next } = createMockReqRes({
        body: { reporteId: '10', description: 'Foto', orden: '1' },
      });

      await uploadReporteImage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'No se subió ningún archivo.' }));
    });

    it('debería retornar 400 si falta reporteId', async () => {
      const { req, res, next } = createMockReqRes({
        body: { description: 'Foto', orden: '1' },
        file: { buffer: Buffer.from('img'), originalname: 'foto.jpg', mimetype: 'image/jpeg' },
      });

      await uploadReporteImage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'reporteId es requerido.' }));
    });

    it('debería retornar 400 si falta description', async () => {
      const { req, res, next } = createMockReqRes({
        body: { reporteId: '10', orden: '1' },
        file: { buffer: Buffer.from('img'), originalname: 'foto.jpg', mimetype: 'image/jpeg' },
      });

      await uploadReporteImage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'description es requerida.' }));
    });

    it('debería retornar 400 si falta orden', async () => {
      const { req, res, next } = createMockReqRes({
        body: { reporteId: '10', description: 'Foto' },
        file: { buffer: Buffer.from('img'), originalname: 'foto.jpg', mimetype: 'image/jpeg' },
      });

      await uploadReporteImage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'orden es requerido.' }));
    });

    it('debería retornar 400 si el archivo no es imagen', async () => {
      const { req, res, next } = createMockReqRes({
        body: { reporteId: '10', description: 'Doc', orden: '1' },
        file: { buffer: Buffer.from('pdf'), originalname: 'doc.pdf', mimetype: 'application/pdf' },
      });

      await uploadReporteImage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'Tipo de archivo inválido. Solo se permiten imágenes.' }));
    });

    it('debería retornar 500 si el servicio falla', async () => {
      service.uploadImageWithReporteLink.mockRejectedValue(new Error('Upload error'));
      const { req, res, next } = createMockReqRes({
        body: { reporteId: '10', description: 'Foto', orden: '1' },
        file: { buffer: Buffer.from('img'), originalname: 'foto.jpg', mimetype: 'image/jpeg' },
      });

      await uploadReporteImage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });
});
