/**
 * Tests de controllers: web controllers
 * (suscripciones, articulosPublic, articulosImagenes, images)
 * Capa: Controller
 * Plataforma: Web
 */

jest.mock('../../adapters/images/uploadImages', () => ({
  uploadImageToCloudflare: jest.fn(),
}));
jest.mock('../../domain/services/web/suscripcionesServices');
jest.mock('../../domain/services/web/articulosPublicServices');
jest.mock('../../domain/services/web/articulosImagenesServices');
jest.mock('../../domain/services/web/imagesServices');

import { createMockReqRes } from '../helpers/testHelpers';
import { createSuscripcion, getAllSuscripciones, getSuscripcionById, deleteSuscripcion } from '../../controllers/web/suscripcionesController';
import { getArticulosPublicController } from '../../controllers/web/articulosPublicController';
import { linkImageToArticulo, unlinkImageFromArticulo, getArticulosByImageId, updateImageOrder } from '../../controllers/web/articulosImagenesController';
import { BadRequestError, ConflictError } from '../../adapters/errors/AppError';
import { getImagesBySection, deleteImageById, uploadImage, createMediaUploadUrl, getDrafts, putDraft, deleteDraftByIdController, publishDraftsController, getPreviewImages, getGallery } from '../../controllers/web/imagesController';

import * as suscripcionesService from '../../domain/services/web/suscripcionesServices';
import * as articulosPublicService from '../../domain/services/web/articulosPublicServices';
import * as articulosImagenesService from '../../domain/services/web/articulosImagenesServices';
import * as imagesService from '../../domain/services/web/imagesServices';

const suscService = jest.mocked(suscripcionesService);
const artPubService = jest.mocked(articulosPublicService);
const artImgService = jest.mocked(articulosImagenesService);
const imgService = jest.mocked(imagesService);

describe('Web Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── Suscripciones ────────────

  describe('createSuscripcion', () => {
    it('debería retornar 400 si faltan datos', async () => {
      const { req, res, next } = createMockReqRes({ body: { nombre: 'Test' } });
      await createSuscripcion(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    /**
     * CASO: Duplicado de email
     * REFERENCIA: Prevenir spam de suscripciones
     */
    it('debería retornar 409 si el email ya existe', async () => {
      suscService.fetchSuscripcionByEmail.mockResolvedValue({ id: 1 } as any);
      const { req, res, next } = createMockReqRes({
        body: { nombre: 'T', telefono: '123', email: 'dup@t.com', localidad: 'L' },
      });
      await createSuscripcion(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    });

    it('debería retornar 201 al crear suscripción', async () => {
      suscService.fetchSuscripcionByEmail.mockResolvedValue(null as any);
      suscService.addSuscripcion.mockResolvedValue({ id: 1 } as any);
      const { req, res, next } = createMockReqRes({
        body: { nombre: 'T', telefono: '123', email: 'new@t.com', localidad: 'L' },
      });
      await createSuscripcion(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('getSuscripcionById', () => {
    it('debería retornar 400 si falta id', async () => {
      const { req, res, next } = createMockReqRes({ params: {} });
      await getSuscripcionById(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 404 si no existe', async () => {
      suscService.fetchSuscripcionById.mockResolvedValue(null as any);
      const { req, res, next } = createMockReqRes({ params: { id: '999' } });
      await getSuscripcionById(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('deleteSuscripcion', () => {
    it('debería retornar 404 si no existe', async () => {
      suscService.fetchSuscripcionById.mockResolvedValue(null as any);
      const { req, res, next } = createMockReqRes({ params: { id: '999' } });
      await deleteSuscripcion(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  // ──────────── ArticulosPublic ────────────

  describe('getArticulosPublicController', () => {
    it('debería retornar 400 si faltan parámetros obligatorios', async () => {
      const { req, res, next } = createMockReqRes({ query: {} });
      await getArticulosPublicController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar artículos con parámetros válidos', async () => {
      artPubService.fetchArticulosPublic.mockResolvedValue({ articulos: [] } as any);
      const { req, res, next } = createMockReqRes({
        query: { rubro: 'electro', seccionImagen: 'slider', page: '1', limit: '10' },
      });
      await getArticulosPublicController(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ──────────── ArticulosImagenes ────────────

  describe('linkImageToArticulo', () => {
    it('debería retornar 404 si faltan datos', async () => {
      const { req, res, next } = createMockReqRes({ body: { articulo_id: 1 } });
      await linkImageToArticulo(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 201 al crear enlace', async () => {
      artImgService.addImageToArticulo.mockResolvedValue({ id: 1 } as any);
      const { req, res, next } = createMockReqRes({ body: { articulo_id: 1, image_id: 2 } });
      await linkImageToArticulo(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('updateImageOrder', () => {
    it('debería retornar 404 si faltan parámetros', async () => {
      const { req, res, next } = createMockReqRes({ params: {}, body: {} });
      await updateImageOrder(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  // ──────────── Images ────────────

  describe('getImagesBySection', () => {
    it('debería retornar 400 si falta sección', async () => {
      const { req, res, next } = createMockReqRes({ query: {} });
      await getImagesBySection(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
  });

  describe('deleteImageById', () => {
    it('debería retornar 400 si id no es número', async () => {
      const { req, res, next } = createMockReqRes({ params: { id: 'abc' } });
      await deleteImageById(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
  });

  describe('createMediaUploadUrl', () => {
    it('debería retornar 201 con los datos de subida', async () => {
      imgService.prepararSubidaMedia.mockResolvedValue({ mediaType: 'image', method: 'POST', uploadUrl: 'u', token: 't' } as any);
      const { req, res, next } = createMockReqRes({ body: { nombre: 'a.jpg', contentType: 'image/jpeg', size: 10 } });
      await createMediaUploadUrl(req, res, next);
      expect(imgService.prepararSubidaMedia).toHaveBeenCalledWith({ nombre: 'a.jpg', contentType: 'image/jpeg', size: 10 });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('debería propagar el 400 del service', async () => {
      imgService.prepararSubidaMedia.mockRejectedValue(new BadRequestError('Tipo de archivo inválido. Solo se permiten imágenes'));
      const { req, res, next } = createMockReqRes({ body: { nombre: 'malware.exe', contentType: 'application/x-executable', size: 10 } });
      await createMediaUploadUrl(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
  });

  describe('uploadImage', () => {
    it('debería retornar 400 si falta sección', async () => {
      const { req, res, next } = createMockReqRes({ body: { token: 't', description: 'd', articleId: '1' } });
      await uploadImage(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(imgService.confirmarSubidaMedia).not.toHaveBeenCalled();
    });

    it('debería retornar 400 si falta descripción', async () => {
      const { req, res, next } = createMockReqRes({ body: { token: 't', section: 'products' } });
      await uploadImage(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 201 con confirmación válida', async () => {
      imgService.confirmarSubidaMedia.mockResolvedValue({
        image: { id: 1 },
        articleLink: { id: 1 },
        cloudflareData: { id: 'cf-1', url: 'url' },
      } as any);
      const { req, res, next } = createMockReqRes({
        body: { token: 't', section: ' products ', description: 'desc', articleId: 1, orden: '2', width: 800, height: 600 },
      });
      await uploadImage(req, res, next);
      expect(imgService.confirmarSubidaMedia).toHaveBeenCalledWith({
        token: 't', section: 'products', description: 'desc', articleId: '1', orden: 2, width: 800, height: 600,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ cloudflare: { id: 'cf-1', url: 'url' } }),
      }));
    });
  });

  // ──────────── Images: borradores / preview / galería ────────────

  describe('image drafts', () => {
    it('getDrafts retorna 200 con la lista', async () => {
      imgService.fetchDrafts.mockResolvedValue([{ id: 1 }] as any);
      const { req, res, next } = createMockReqRes();
      await getDrafts(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });

    it('putDraft retorna 400 sin sección', async () => {
      const { req, res, next } = createMockReqRes({ body: { description: 'd', image_id: 1 } });
      await putDraft(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('putDraft retorna 400 con image_id inválido', async () => {
      const { req, res, next } = createMockReqRes({ body: { section: 's', description: 'd', image_id: 'x' } });
      await putDraft(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it("putDraft acepta description '*'", async () => {
      imgService.saveDraft.mockResolvedValue({ id: 2 } as any);
      const { req, res, next } = createMockReqRes({ body: { section: 'header', description: '*', image_id: 4 } });
      await putDraft(req, res, next);
      expect(imgService.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ description: '*', image_id: 4 }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('putDraft con image_id null guarda un clear', async () => {
      imgService.saveDraft.mockResolvedValue({ id: 1, action: 'clear' } as any);
      const { req, res, next } = createMockReqRes({
        body: { section: 's', description: 'd', image_id: null },
        user: { userId: 7 },
      });
      await putDraft(req, res, next);
      expect(imgService.saveDraft).toHaveBeenCalledWith({ section: 's', description: 'd', image_id: null, updated_by: 7 });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('deleteDraftByIdController retorna 400 si id inválido', async () => {
      const { req, res, next } = createMockReqRes({ params: { id: 'abc' } });
      await deleteDraftByIdController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('publishDraftsController retorna 200', async () => {
      imgService.publishAllDrafts.mockResolvedValue({ published: 2 });
      const { req, res, next } = createMockReqRes();
      await publishDraftsController(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ published: 2 });
    });

    it('getPreviewImages retorna 400 sin sección', async () => {
      const { req, res, next } = createMockReqRes({ query: {} });
      await getPreviewImages(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('getGallery retorna 200', async () => {
      imgService.fetchGallery.mockResolvedValue([] as any);
      const { req, res, next } = createMockReqRes();
      await getGallery(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('deleteImageById propaga 409 con slots cuando está en uso', async () => {
      imgService.removeImageById.mockRejectedValue(new ConflictError('en uso', { slots: [{ section: 'home', description: 'x', draft: false }] }));
      const { req, res, next } = createMockReqRes({ params: { id: '5' } });
      await deleteImageById(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, details: { slots: expect.any(Array) } }));
    });
  });
});
