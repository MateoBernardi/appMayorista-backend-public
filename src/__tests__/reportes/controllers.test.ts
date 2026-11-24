/**
 * Tests de controllers: reportesControllers
 * Capa: Controller
 * Plataforma: Interno (RRHH)
 */

jest.mock('../../domain/services/reportesServices');
jest.mock('../../domain/services/devicesService');

import { createMockReqRes } from '../helpers/testHelpers';
import {
  getReportesByUser,
  createReporte,
  updateReporte,
  getReportesRanking,
  getReportesManaged,
  getTopEmployeeByReportes,
  getUpgradedEmployeeByReportes,
} from '../../controllers/reportesControllers';
import * as reportesService from '../../domain/services/reportesServices';

const service = jest.mocked(reportesService);

describe('Reportes Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── getReportesByUser ────────────

  describe('getReportesByUser', () => {
    it('debería propagar un error 401 si falta contexto de usuario', async () => {
      const { req, res, next } = createMockReqRes({ query: {}, user: {} });
      await getReportesByUser(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería propagar un error 403 si el usuario no es management y consulta a otro usuario', async () => {
      const { req, res, next } = createMockReqRes({
        query: { usuarioId: '10' },
        user: { userContextId: 20, role: 'empleado-admin' },
      });

      await getReportesByUser(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
      expect(service.getReportesByUser).not.toHaveBeenCalled();
    });

    it('debería permitir consulta propia para rol no management', async () => {
      service.getReportesByUser.mockResolvedValue([{ id: 1 }] as any);
      const { req, res, next } = createMockReqRes({
        query: { usuarioId: '10' },
        user: { userContextId: 10, role: 'empleado-admin' },
      });

      await getReportesByUser(req, res, next);
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });

    it('debería permitir consulta a terceros para roles management', async () => {
      service.getReportesByUser.mockResolvedValue([{ id: 1 }] as any);
      const { req, res, next } = createMockReqRes({
        query: { user_context_id: '10' },
        user: { userContextId: 99, role: 'gerencia' },
      });

      await getReportesByUser(req, res, next);
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });
  });

  // ──────────── createReporte ────────────

  describe('createReporte', () => {
    it('debería propagar un error 401 si falta autenticación', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, body: {} });
      await createReporte(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    /**
     * CASO: creador_id forzado desde token
     * RIESGO: Mass assignment - usuario envía creador_id en body
     * REFERENCIA: OWASP API03:2023
     */
    it('debería usar userContextId del token como creador_id', async () => {
      service.createReporte.mockResolvedValue({ id: 1 } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: {
          usuario_reportado_id: 20,
          titulo: 'T', descripcion: 'D',
          categoria: 'POSITIVO',
          fecha_incidente: '2025-01-01',
          creador_id: 999, // intento spoofing
        },
      });
      await createReporte(req, res, next);
      expect(service.createReporte).toHaveBeenCalledWith(
        expect.objectContaining({ creador_id: 10 })
      );
    });

    it('debería retornar 201 al crear reporte', async () => {
      service.createReporte.mockResolvedValue({ id: 1 } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { usuario_reportado_id: 20, titulo: 'T', descripcion: 'D', categoria: 'POSITIVO' },
      });
      await createReporte(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ──────────── updateReporte ────────────

  describe('updateReporte', () => {
    it('debería propagar un error 401 si falta autenticación', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' }, body: {} });
      await updateReporte(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería propagar un error 404 si falta id', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: {},
        body: { estado: 'ASENTADO' },
      });
      await updateReporte(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  // ──────────── getReportesRanking ────────────

  describe('getReportesRanking', () => {
    /**
     * CASO: El ranking expone error.stack en producción
     * RIESGO: Information disclosure
     * REFERENCIA: OWASP API08:2023
     */
    it('NO debería exponer stack trace en error (potencial riesgo)', async () => {
      const error = new Error('DB error');
      service.getReportesRanking.mockRejectedValue(error);
      const { req, res, next } = createMockReqRes({});
      await getReportesRanking(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
      // NOTA: el error original no se propaga tal cual; asAppError lo reemplaza por un InternalServerError genérico.
      expect(next.mock.calls[0][0]).not.toBe(error);
    });

    it('debería pasar el estado al service cuando es válido', async () => {
      service.getReportesRanking.mockResolvedValue([] as any);
      const { req, res, next } = createMockReqRes({ query: { estado: 'DISPUTA' } });
      await getReportesRanking(req, res, next);
      expect(service.getReportesRanking).toHaveBeenCalledWith('DISPUTA');
    });

    it('debería ignorar un estado inválido en el query', async () => {
      service.getReportesRanking.mockResolvedValue([] as any);
      const { req, res, next } = createMockReqRes({ query: { estado: 'NO_EXISTE' } });
      await getReportesRanking(req, res, next);
      expect(service.getReportesRanking).toHaveBeenCalledWith(undefined);
    });
  });

  // ──────────── getReportesManaged ────────────

  describe('getReportesManaged', () => {
    it('debería propagar un error 401 si falta contexto de usuario', async () => {
      const { req, res, next } = createMockReqRes({ query: {}, user: {} });
      await getReportesManaged(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería usar page/pageSize por defecto y pasar el estado filtrado', async () => {
      service.getReportesManaged.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 } as any);
      const { req, res, next } = createMockReqRes({
        query: { estado: 'PENDIENTE' },
        user: { userContextId: 10, role: 'encargado' },
      });

      await getReportesManaged(req, res, next);
      expect(service.getReportesManaged).toHaveBeenCalledWith(10, { page: 1, pageSize: 20, estado: 'PENDIENTE' });
      expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, page: 1, pageSize: 20 });
    });

    it('debería propagar page/pageSize del query', async () => {
      service.getReportesManaged.mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 } as any);
      const { req, res, next } = createMockReqRes({
        query: { page: '2', pageSize: '10' },
        user: { userContextId: 10, role: 'gerencia' },
      });

      await getReportesManaged(req, res, next);
      expect(service.getReportesManaged).toHaveBeenCalledWith(10, { page: 2, pageSize: 10, estado: undefined });
    });

    it('debería propagar el filtro de rol del query', async () => {
      service.getReportesManaged.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 } as any);
      const { req, res, next } = createMockReqRes({
        query: { rol: 'empleado-super' },
        user: { userContextId: 10, role: 'encargado' },
      });

      await getReportesManaged(req, res, next);
      expect(service.getReportesManaged).toHaveBeenCalledWith(10, { page: 1, pageSize: 20, estado: undefined, rol: 'empleado-super' });
    });
  });
});
