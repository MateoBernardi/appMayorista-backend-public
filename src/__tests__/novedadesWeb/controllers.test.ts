jest.mock('../../domain/services/web/novedadesWebServices');

import { createMockReqRes } from '../helpers/testHelpers';
import {
  createNovedadWebController,
  deleteNovedadWebController,
  listNovedadesWebController,
  listNovedadesWebPublicasController,
  updateNovedadWebController,
} from '../../controllers/web/novedadesWebController';
import * as novedadesWebService from '../../domain/services/web/novedadesWebServices';
import { BadRequestError, NotFoundError } from '../../adapters/errors/AppError';
import { NovedadWebDTO } from '../../domain/dto/NovedadWebDTO';

const service = jest.mocked(novedadesWebService);

describe('NovedadesWeb Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── listNovedadesWebController ────────────

  describe('listNovedadesWebController', () => {
    it('debería listar todas las novedades (admin)', async () => {
      service.fetchNovedadesWeb.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes();

      await listNovedadesWebController(req, res, next);

      expect(service.fetchNovedadesWeb).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── createNovedadWebController ────────────

  describe('createNovedadWebController', () => {
    it('debería crear la novedad usando el userContextId autenticado', async () => {
      const creada = { id: 1 } as NovedadWebDTO;
      service.addNovedadWeb.mockResolvedValue(creada);
      const { req, res, next } = createMockReqRes({
        body: { titulo: 'x', preview: 'y', cuerpo: 'z' },
        user: { userContextId: 42 },
      });

      await createNovedadWebController(req, res, next);

      expect(service.addNovedadWeb).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'x', preview: 'y', cuerpo: 'z', created_by: 42 }));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(creada);
    });

    it('debería propagar un 401 si no hay usuario autenticado', async () => {
      const { req, res, next } = createMockReqRes({ body: { titulo: 'x', preview: 'y', cuerpo: 'z' } });

      await createNovedadWebController(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    it('debería propagar un 400 si el servicio rechaza los datos', async () => {
      service.addNovedadWeb.mockRejectedValue(new BadRequestError('El título es requerido.'));
      const { req, res, next } = createMockReqRes({ body: { titulo: '', preview: 'y', cuerpo: 'z' }, user: { userContextId: 1 } });

      await createNovedadWebController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(BadRequestError));
    });

    it('debería convertir publicada_en a Date si viene en el body', async () => {
      service.addNovedadWeb.mockResolvedValue({ id: 1 } as NovedadWebDTO);
      const { req, res, next } = createMockReqRes({
        body: { titulo: 'x', preview: 'y', cuerpo: 'z', publicada_en: '2026-10-01T10:00:00-03:00' },
        user: { userContextId: 1 },
      });

      await createNovedadWebController(req, res, next);

      expect(service.addNovedadWeb).toHaveBeenCalledWith(expect.objectContaining({ publicada_en: expect.any(Date) }));
    });
  });

  // ──────────── updateNovedadWebController ────────────

  describe('updateNovedadWebController', () => {
    it('debería propagar un 404 si la novedad no existe', async () => {
      service.modifyNovedadWeb.mockRejectedValue(new NotFoundError('Novedad no encontrada.'));
      const { req, res, next } = createMockReqRes({ params: { id: '999' }, body: { titulo: 'x' } });

      await updateNovedadWebController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });
  });

  // ──────────── deleteNovedadWebController ────────────

  describe('deleteNovedadWebController', () => {
    it('debería eliminar (soft-delete) y devolver el id', async () => {
      service.removeNovedadWeb.mockResolvedValue({ id: 5 });
      const { req, res, next } = createMockReqRes({ params: { id: '5' } });

      await deleteNovedadWebController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 5 });
    });

    it('debería propagar un 404 si ya estaba eliminada o no existe', async () => {
      service.removeNovedadWeb.mockRejectedValue(new NotFoundError('Novedad no encontrada.'));
      const { req, res, next } = createMockReqRes({ params: { id: '999' } });

      await deleteNovedadWebController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });
  });

  // ──────────── listNovedadesWebPublicasController ────────────

  describe('listNovedadesWebPublicasController', () => {
    it('debería listar solo las publicadas', async () => {
      service.fetchNovedadesWebPublicadas.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes();

      await listNovedadesWebPublicasController(req, res, next);

      expect(service.fetchNovedadesWebPublicadas).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
