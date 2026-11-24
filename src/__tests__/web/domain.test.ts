/**
 * Tests de dominio: web services
 * (suscripcionesServices, articulosPublicServices, articulosImagenesServices, imagesServices)
 * Capa: Domain Service
 * Plataforma: Web
 */

process.env.UPLOAD_TOKEN_SECRET = 'test-upload-secret';

jest.mock('../../adapters/images/uploadImages', () => ({
  createCloudflareDirectUpload: jest.fn(),
  getCloudflareImage: jest.fn(),
  buildImageVariantUrl: jest.fn((cfImageId: string, variant: string) => `https://imagedelivery.net/hash/${cfImageId}/${variant}`),
  BASE_VARIANT: 'public',
  VISOR_VARIANT: 'visor',
}));
jest.mock('../../adapters/images/uploadVideo', () => ({
  buildVideoKey: jest.fn((nombre: string) => `site-media/123-${nombre}`),
  buildVideoUrl: jest.fn((key: string) => `https://r2.example.com/${key}`),
  generateVideoUploadUrl: jest.fn(),
  headVideo: jest.fn(),
  deleteVideo: jest.fn(),
}));
jest.mock('../../adapters/db/web/suscripcionesRepo');
jest.mock('../../adapters/db/articulosRepo');
jest.mock('../../adapters/db/web/articulosImagenesRepo');
jest.mock('../../adapters/db/web/imagesRepo');
jest.mock('../../domain/validations/web/suscripcionesValidations');

import jwt from 'jsonwebtoken';
import { addSuscripcion, fetchAllSuscripciones, removeSuscripcion } from '../../domain/services/web/suscripcionesServices';
import { fetchArticulosPublic } from '../../domain/services/web/articulosPublicServices';
import { addImageToArticulo, removeImageFromArticulo, changeImageOrderForArticulo, fetchImagesByArticuloId } from '../../domain/services/web/articulosImagenesServices';
import { prepararSubidaMedia, confirmarSubidaMedia, MAX_VIDEO_BYTES, fetchImagesBySection, removeImageById, fetchPreviewImagesBySection, fetchGallery, saveDraft } from '../../domain/services/web/imagesServices';

import * as suscripcionesRepo from '../../adapters/db/web/suscripcionesRepo';
import * as articulosRepo from '../../adapters/db/articulosRepo';
import * as articulosImagenesRepo from '../../adapters/db/web/articulosImagenesRepo';
import * as imagesRepo from '../../adapters/db/web/imagesRepo';
import * as uploadImages from '../../adapters/images/uploadImages';
import * as uploadVideo from '../../adapters/images/uploadVideo';
import { signUploadToken } from '../../domain/validations/uploadTokens';
import { SuscripcionValidationService } from '../../domain/validations/web/suscripcionesValidations';

const mockSuscRepo = jest.mocked(suscripcionesRepo);
const mockArtRepo = jest.mocked(articulosRepo);
const mockArtImgRepo = jest.mocked(articulosImagenesRepo);
const mockImagesRepo = jest.mocked(imagesRepo);
const mockUpload = jest.mocked(uploadImages);
const mockVideo = jest.mocked(uploadVideo);
const mockValidation = jest.mocked(SuscripcionValidationService);

describe('Web Services', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── SuscripcionesServices ────────────

  describe('addSuscripcion', () => {
    /**
     * CASO: Validación de datos antes de crear
     */
    it('debería lanzar error con validationErrors si datos son inválidos', async () => {
      mockValidation.validate.mockReturnValue({ isValid: false, errors: ['email inválido'] });
      try {
        await addSuscripcion({ nombre: 'T', telefono: '123', email: 'bad', localidad: 'L' });
        fail('Debería haber lanzado');
      } catch (e: any) {
        expect(e.validationErrors).toEqual(['email inválido']);
      }
    });

    it('debería crear suscripción con datos sanitizados', async () => {
      mockValidation.validate.mockReturnValue({ isValid: true, errors: [] });
      mockValidation.sanitize.mockReturnValue({ nombre: 'Clean', telefono: '123', email: 'a@b.com', localidad: 'L' });
      mockSuscRepo.createSuscripcion.mockResolvedValue({ id: 1 } as any);

      const result = await addSuscripcion({ nombre: ' dirty ', telefono: '123', email: 'a@b.com', localidad: 'L' });
      expect(mockValidation.sanitize).toHaveBeenCalled();
      expect(result).toEqual({ id: 1 });
    });
  });

  // ──────────── ArticulosPublicServices ────────────

  describe('fetchArticulosPublic', () => {
    it('debería pasar parámetros de paginación', async () => {
      mockArtRepo.getArticulosPublic.mockResolvedValue({ articulos: [], total: 0 } as any);
      await fetchArticulosPublic('rubro1', 'seccion1', 2, 15);
      expect(mockArtRepo.getArticulosPublic).toHaveBeenCalledWith('rubro1', 'seccion1', 2, 15);
    });
  });

  // ──────────── ArticulosImagenesServices ────────────

  describe('addImageToArticulo', () => {
    it('debería llamar a linkImageToArticulo con parámetros correctos', async () => {
      mockArtImgRepo.linkImageToArticulo.mockResolvedValue({ id: 1 } as any);
      await addImageToArticulo(10, 20, 1);
      expect(mockArtImgRepo.linkImageToArticulo).toHaveBeenCalledWith(
        expect.objectContaining({ articulo_id: 10, image_id: 20, orden: 1 })
      );
    });
  });

  describe('changeImageOrderForArticulo', () => {
    it('debería actualizar orden directamente si no hay conflicto', async () => {
      mockArtImgRepo.updateImageOrderForArticulo.mockResolvedValue({ id: 1 } as any);
      const result = await changeImageOrderForArticulo(10, 20, 3);
      expect(result).toEqual({ id: 1 });
    });

    /**
     * CASO: Conflicto de orden único - swap automático
     */
    it('debería hacer swap si hay conflicto de restricción única', async () => {
      const uniqueError: any = new Error('unique violation');
      uniqueError.code = '23505';
      mockArtImgRepo.updateImageOrderForArticulo.mockRejectedValue(uniqueError);
      mockArtImgRepo.getImagesByArticuloId.mockResolvedValue([
        { image_id: 20, orden: 1 },
        { image_id: 30, orden: 3 },
      ] as any);
      mockArtImgRepo.swapImageOrders.mockResolvedValue(undefined as any);
      // Después del swap, retornar imágenes actualizadas
      mockArtImgRepo.getImagesByArticuloId.mockResolvedValueOnce([
        { image_id: 20, orden: 1 },
        { image_id: 30, orden: 3 },
      ] as any).mockResolvedValueOnce([
        { image_id: 20, orden: 3 },
        { image_id: 30, orden: 1 },
      ] as any);

      const result = await changeImageOrderForArticulo(10, 20, 3);
      expect(mockArtImgRepo.swapImageOrders).toHaveBeenCalled();
    });
  });

  describe('fetchImagesByArticuloId', () => {
    it('debería construir la visorUrl con la variante fija para imágenes con cf_image_id', async () => {
      mockArtImgRepo.getImagesByArticuloId.mockResolvedValue([
        { image_id: 1, url: 'https://imagedelivery.net/hash/cf-1/public', cf_image_id: 'cf-1', media_type: 'image' },
      ] as any);

      const result = await fetchImagesByArticuloId(10);

      expect(result[0].visorUrl).toBe('https://imagedelivery.net/hash/cf-1/visor');
    });

    it('debería usar la url original como fallback para videos u otras filas sin cf_image_id', async () => {
      mockArtImgRepo.getImagesByArticuloId.mockResolvedValue([
        { image_id: 2, url: 'https://r2.example.com/video.mp4', cf_image_id: null, media_type: 'video' },
      ] as any);

      const result = await fetchImagesByArticuloId(10);

      expect(result[0].visorUrl).toBe('https://r2.example.com/video.mp4');
    });
  });

  // ──────────── ImagesServices ────────────

  describe('prepararSubidaMedia', () => {
    it('imagen: pide una URL de direct upload a Cloudflare y devuelve un token con el id', async () => {
      mockUpload.createCloudflareDirectUpload.mockResolvedValue({ id: 'cf-123', uploadURL: 'https://upload.imagedelivery.net/x' });

      const res = await prepararSubidaMedia({ nombre: 'foto.jpg', contentType: 'image/jpeg', size: 1000 });

      expect(res).toMatchObject({ mediaType: 'image', method: 'POST', uploadUrl: 'https://upload.imagedelivery.net/x' });
      expect(jwt.decode(res.token)).toMatchObject({ tipo: 'imagen', cfImageId: 'cf-123' });
      expect(mockVideo.generateVideoUploadUrl).not.toHaveBeenCalled();
    });

    it('video: firma un PUT al bucket público con tipo y tamaño', async () => {
      mockVideo.generateVideoUploadUrl.mockResolvedValue('https://r2.example/firmada');

      const res = await prepararSubidaMedia({ nombre: 'clip.mp4', contentType: 'video/mp4', size: 2000 });

      expect(res).toMatchObject({ mediaType: 'video', method: 'PUT', uploadUrl: 'https://r2.example/firmada' });
      expect(mockVideo.generateVideoUploadUrl).toHaveBeenCalledWith('site-media/123-clip.mp4', 'video/mp4', 2000, expect.any(Number));
      expect(jwt.decode(res.token)).toMatchObject({ tipo: 'video', key: 'site-media/123-clip.mp4', contentType: 'video/mp4' });
      expect(mockUpload.createCloudflareDirectUpload).not.toHaveBeenCalled();
    });

    /**
     * CASO: Tipo de archivo inválido
     * RIESGO: Upload de archivos maliciosos
     * REFERENCIA: OWASP API08:2023
     */
    it('tipo no permitido → 400', async () => {
      await expect(
        prepararSubidaMedia({ nombre: 'malware.exe', contentType: 'application/x-executable', size: 10 })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockUpload.createCloudflareDirectUpload).not.toHaveBeenCalled();
    });

    it('tamaño inválido o excedido → 400', async () => {
      await expect(prepararSubidaMedia({ nombre: 'a.jpg', contentType: 'image/jpeg', size: 0 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(prepararSubidaMedia({ nombre: 'a.jpg', contentType: 'image/jpeg', size: 11 * 1024 * 1024 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(prepararSubidaMedia({ nombre: 'a.mp4', contentType: 'video/mp4', size: MAX_VIDEO_BYTES + 1 })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('confirmarSubidaMedia', () => {
    const base = { section: 'products', description: 'desc' };

    it('imagen subida: crea el registro con la variante base, dimensiones y vínculo al artículo', async () => {
      mockUpload.getCloudflareImage.mockResolvedValue({ id: 'cf-123', draft: false });
      mockImagesRepo.createImage.mockResolvedValue({ id: 1, url: 'https://img.url/v1' } as any);
      mockArtImgRepo.linkImageToArticulo.mockResolvedValue({ id: 1 } as any);

      const result = await confirmarSubidaMedia({
        ...base,
        token: signUploadToken({ tipo: 'imagen', cfImageId: 'cf-123' }),
        articleId: '10',
        orden: 1,
        width: 800,
        height: 600,
      });

      expect(result.cloudflareData.id).toBe('cf-123');
      // Se guarda la variante base predecible, no result.variants[0]
      expect(mockImagesRepo.createImage).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://imagedelivery.net/hash/cf-123/public', cf_image_id: 'cf-123', media_type: 'image', width: 800, height: 600 })
      );
      expect(mockArtImgRepo.linkImageToArticulo).toHaveBeenCalledWith({ articulo_id: 10, image_id: 1, orden: 1 });
    });

    it('descarta dimensiones inválidas', async () => {
      mockUpload.getCloudflareImage.mockResolvedValue({ id: 'cf-1', draft: false });
      mockImagesRepo.createImage.mockResolvedValue({ id: 1 } as any);

      await confirmarSubidaMedia({ ...base, token: signUploadToken({ tipo: 'imagen', cfImageId: 'cf-1' }), width: -1, height: '600' as any });

      expect(mockImagesRepo.createImage).toHaveBeenCalledWith(expect.objectContaining({ width: null, height: null }));
    });

    it('imagen que todavía no se subió (draft) o inexistente → 400 sin registrar', async () => {
      mockUpload.getCloudflareImage.mockResolvedValueOnce({ id: 'cf-1', draft: true }).mockResolvedValueOnce(null);
      const token = signUploadToken({ tipo: 'imagen', cfImageId: 'cf-1' });

      await expect(confirmarSubidaMedia({ ...base, token })).rejects.toMatchObject({ statusCode: 400 });
      await expect(confirmarSubidaMedia({ ...base, token })).rejects.toMatchObject({ statusCode: 400 });
      expect(mockImagesRepo.createImage).not.toHaveBeenCalled();
    });

    it('video subido: registra la URL pública del bucket', async () => {
      mockVideo.headVideo.mockResolvedValue({ size: 1000 });
      mockImagesRepo.createImage.mockResolvedValue({ id: 2 } as any);

      const result = await confirmarSubidaMedia({
        ...base,
        token: signUploadToken({ tipo: 'video', key: 'site-media/123-clip.mp4', contentType: 'video/mp4' }),
      });

      expect(result.cloudflareData).toEqual({ id: null, url: 'https://r2.example.com/site-media/123-clip.mp4' });
      expect(mockImagesRepo.createImage).toHaveBeenCalledWith(
        expect.objectContaining({ media_type: 'video', cf_image_id: null, width: null, height: null })
      );
    });

    it('video más grande que el máximo → 400 y lo borra', async () => {
      mockVideo.headVideo.mockResolvedValue({ size: MAX_VIDEO_BYTES + 1 });
      const token = signUploadToken({ tipo: 'video', key: 'site-media/123-clip.mp4', contentType: 'video/mp4' });

      await expect(confirmarSubidaMedia({ ...base, token })).rejects.toMatchObject({ statusCode: 400 });
      expect(mockVideo.deleteVideo).toHaveBeenCalledWith('site-media/123-clip.mp4');
      expect(mockImagesRepo.createImage).not.toHaveBeenCalled();
    });

    it('token inválido o de otro tipo → 400 sin consultar Cloudflare', async () => {
      await expect(confirmarSubidaMedia({ ...base, token: 'basura' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        confirmarSubidaMedia({ ...base, token: signUploadToken({ tipo: 'cv', key: 'cvs-web-pendientes/x.pdf', ext: 'pdf' }) })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockUpload.getCloudflareImage).not.toHaveBeenCalled();
      expect(mockVideo.headVideo).not.toHaveBeenCalled();
    });

    it('debería propagar errores de Cloudflare', async () => {
      mockUpload.getCloudflareImage.mockRejectedValue(new Error('CF rate limit'));
      await expect(
        confirmarSubidaMedia({ ...base, token: signUploadToken({ tipo: 'imagen', cfImageId: 'cf-1' }) })
      ).rejects.toThrow('CF rate limit');
    });
  });

  describe('images: borradores, preview, galería', () => {
    it('removeImageById lanza 409 con slots si está en uso', async () => {
      const slots = [{ section: 'home', description: 'hero', draft: false }];
      mockImagesRepo.getImageSlotUsage.mockResolvedValue(slots as any);
      await expect(removeImageById(3)).rejects.toMatchObject({ statusCode: 409, details: { slots } });
      expect(mockImagesRepo.deleteById).not.toHaveBeenCalled();
    });

    it('removeImageById elimina si no está en uso', async () => {
      mockImagesRepo.getImageSlotUsage.mockResolvedValue([]);
      await removeImageById(3);
      expect(mockImagesRepo.deleteById).toHaveBeenCalledWith(3);
    });

    it('saveDraft lanza 404 si la imagen no existe', async () => {
      mockImagesRepo.getImageById.mockResolvedValue(undefined);
      await expect(saveDraft({ section: 's', description: 'd', image_id: 9, updated_by: 1 }))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it('fetchPreviewImagesBySection aplica set y clear sobre lo publicado', async () => {
      mockImagesRepo.getBySection.mockResolvedValue([
        { id: 1, section: 'home', description: 'a', url: 'old-a' },
        { id: 2, section: 'home', description: 'b', url: 'old-b' },
        { id: 3, section: 'home', description: 'c', url: 'old-c' },
      ] as any);
      mockImagesRepo.getDraftsBySection.mockResolvedValue([
        { section: 'home', description: 'a', action: 'set', image_id: 10 },
        { section: 'home', description: 'b', action: 'clear', image_id: null },
      ] as any);
      mockImagesRepo.getSetDraftImagesBySection.mockResolvedValue([
        { id: 10, section: 'galeria', url: 'new-a', slot_section: 'home', slot_description: 'a' },
      ] as any);
      const result = await fetchPreviewImagesBySection('home');
      expect(result.map((r: any) => r.url)).toEqual(['new-a', 'old-c']);
      expect(result[0]).toMatchObject({ section: 'home', description: 'a', articulo_id: null });
      expect(result[0]).not.toHaveProperty('slot_section');
    });

    it('fetchPreviewImagesBySection: draft "*" reemplaza toda la sección', async () => {
      mockImagesRepo.getBySection.mockResolvedValue([
        { id: 1, section: 'header', description: 'x', url: 'old' },
      ] as any);
      mockImagesRepo.getDraftsBySection.mockResolvedValue([
        { section: 'header', description: '*', action: 'set', image_id: 10 },
      ] as any);
      mockImagesRepo.getSetDraftImagesBySection.mockResolvedValue([
        { id: 10, section: 'galeria', description: '', url: 'new', slot_section: 'header', slot_description: '*' },
      ] as any);
      const result = await fetchPreviewImagesBySection('header');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ url: 'new', section: 'header', description: 'principal' });
    });

    it('fetchPreviewImagesBySection: draft "*" clear deja la sección vacía', async () => {
      mockImagesRepo.getBySection.mockResolvedValue([{ id: 1, section: 'header', description: 'x', url: 'old' }] as any);
      mockImagesRepo.getDraftsBySection.mockResolvedValue([{ section: 'header', description: '*', action: 'clear', image_id: null }] as any);
      mockImagesRepo.getSetDraftImagesBySection.mockResolvedValue([]);
      expect(await fetchPreviewImagesBySection('header')).toEqual([]);
    });

    it('fetchGallery combina slots publicados y de borrador en in_use', async () => {
      mockImagesRepo.getGalleryRows.mockResolvedValue([
        {
          id: 1, url: 'u', section: 'galeria', description: 'd',
          published_slots: [{ section: 'home', description: 'a', draft: false }],
          draft_slots: [{ section: 'insumos', description: 'b', draft: true }],
        },
      ] as any);
      const result = await fetchGallery();
      expect(result).toHaveLength(1);
      expect(result[0]?.in_use).toHaveLength(2);
    });
  });
});
