/**
 * Tests de controllers: novedadesController
 * Capa: Controller
 * Plataforma: Interno
 */

jest.mock('../../domain/services/novedadesServices');
jest.mock('../../domain/services/devicesService');
jest.mock('../../domain/services/usuariosServices');

import { createMockReqRes } from '../helpers/testHelpers';
import {
  getNovedadesController,
  createNovedadController,
  deleteNovedadController,
  updateNovedadController,
} from '../../controllers/novedadesController';
import * as novedadesService from '../../domain/services/novedadesServices';
import * as usuariosService from '../../domain/services/usuariosServices';

const service = jest.mocked(novedadesService);
const mockUsuarios = jest.mocked(usuariosService);

describe('Novedades Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── getNovedadesController ────────────

  describe('getNovedadesController', () => {
    it('debería retornar 200 con novedades', async () => {
      service.fetchNovedades.mockResolvedValue([{ id: 1, titulo: 'Test' }] as any);
      const { req, res, next } = createMockReqRes({});
      await getNovedadesController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería propagar un error 500 al middleware sin datos sensibles', async () => {
      service.fetchNovedades.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({});
      await getNovedadesController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ──────────── createNovedadController ────────────

  describe('createNovedadController', () => {
    it('debería propagar un error 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, body: {} });
      await createNovedadController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    /**
     * CASO: created_by forzado desde token
     * RIESGO: Mass assignment
     * REFERENCIA: OWASP API03:2023
     */
    it('debería usar userContextId del token como created_by', async () => {
      service.addNovedad.mockResolvedValue({ id: 1, titulo: 'Test' } as any);
      mockUsuarios.getAllUserIdsExcept.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { titulo: 'T', descripcion: 'D', id_etiqueta: 1, prioridad: 1, created_by: 999 },
      });
      await createNovedadController(req, res, next);
      expect(service.addNovedad).toHaveBeenCalledWith('T', 'D', 1, 1, 10);
    });

    it('debería retornar 201 al crear novedad', async () => {
      service.addNovedad.mockResolvedValue({ id: 1, titulo: 'Test' } as any);
      mockUsuarios.getAllUserIdsExcept.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { titulo: 'T', descripcion: 'D', id_etiqueta: 1, prioridad: 1 },
      });
      await createNovedadController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('debería propagar un error 400 si addNovedad retorna null', async () => {
      service.addNovedad.mockResolvedValue(null as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { titulo: 'T', descripcion: 'D', id_etiqueta: 1, prioridad: 1 },
      });
      await createNovedadController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
  });

  // ──────────── deleteNovedadController ────────────

  describe('deleteNovedadController', () => {
    it('debería propagar un error 404 si id es 0 o NaN', async () => {
      const { req, res, next } = createMockReqRes({ params: { id: 'abc' } });
      await deleteNovedadController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 200 al eliminar novedad', async () => {
      service.removeNovedad.mockResolvedValue({ id: 5 });
      const { req, res, next } = createMockReqRes({ params: { id: '5' } });
      await deleteNovedadController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── updateNovedadController ────────────

  describe('updateNovedadController', () => {
    it('debería propagar un error 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' }, body: {} });
      await updateNovedadController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería propagar un error 404 si id es inválido', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        params: { id: 'abc' },
        body: { titulo: 'Updated' },
      });
      await updateNovedadController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 200 al actualizar novedad', async () => {
      service.modifyNovedad.mockResolvedValue({ id: 1, titulo: 'Updated' } as any);
      mockUsuarios.getAllUserIdsExcept.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        params: { id: '1' },
        body: { titulo: 'Updated', descripcion: 'D', id_etiqueta: 1, prioridad: 1 },
      });
      await updateNovedadController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
