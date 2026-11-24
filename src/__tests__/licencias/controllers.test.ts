/**
 * Tests de controllers: licenciasControllers
 * Capa: Controller
 * Plataforma: Interno
 */

jest.mock('../../domain/services/licenciasServices');
jest.mock('../../domain/services/devicesService');
jest.mock('../../domain/services/horariosServices');

import * as licenciasService from '../../domain/services/licenciasServices';
import * as devicesService from '../../domain/services/devicesService';
import { createMockReqRes } from '../helpers/testHelpers';
import {
  getTiposLicencia,
  getSaldosUsuario,
  getSaldoFrancosEmpleado,
  getSaldoVacacionesEmpleado,
  getSolicitudesUsuario,
  crearSolicitud,
  adjuntarArchivo,
  cancelarSolicitud,
  aprobarSolicitud,
  rechazarSolicitud,
} from '../../controllers/licenciasControllers';

const service = jest.mocked(licenciasService);
const devices = jest.mocked(devicesService);

describe('Licencias Controllers', () => {
  beforeEach(() => jest.resetAllMocks());

  // ─────────────────────────── getTiposLicencia ───────────────────────────

  describe('getTiposLicencia', () => {
    it('debería retornar 200 con tipos de licencia', async () => {
      const tipos = [{ id: 1, nombre: 'Vacaciones' }];
      service.getTiposLicencia.mockResolvedValue(tipos as any);
      const { req, res, next } = createMockReqRes();

      await getTiposLicencia(req, res, next);

      expect(res.json).toHaveBeenCalledWith(tipos);
    });

    /**
     * CASO: Error interno del servicio
     * RIESGO: Information disclosure
     * REFERENCIA: OWASP API08:2023
     */
    it('debería retornar 500 con mensaje genérico si el servicio falla', async () => {
      service.getTiposLicencia.mockRejectedValue(new Error('DB connection lost'));
      const { req, res, next } = createMockReqRes();

      await getTiposLicencia(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 500,
        message: 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.',
      }));
    });
  });

  // ─────────────────────────── getSaldosUsuario ───────────────────────────

  describe('getSaldoFrancosEmpleado / getSaldoVacacionesEmpleado', () => {
    it('francos: 400 si el id es inválido', async () => {
      const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: 'abc' } });
      await getSaldoFrancosEmpleado(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('francos: 200 con el saldo del empleado', async () => {
      service.getSaldoFrancosEmpleado.mockResolvedValue({ user_context_id: 7, horas: -2 });
      const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: '7' } });
      await getSaldoFrancosEmpleado(req, res, next);
      expect(service.getSaldoFrancosEmpleado).toHaveBeenCalledWith(7);
      expect(res.json).toHaveBeenCalledWith({ user_context_id: 7, horas: -2 });
    });

    it('vacaciones: 400 si el id es inválido', async () => {
      const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: '0' } });
      await getSaldoVacacionesEmpleado(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('vacaciones: 200 con los saldos del empleado', async () => {
      service.getSaldoVacacionesEmpleado.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({ user: { userContextId: 1 }, params: { id: '7' } });
      await getSaldoVacacionesEmpleado(req, res, next);
      expect(service.getSaldoVacacionesEmpleado).toHaveBeenCalledWith(7);
      expect(res.json).toHaveBeenCalledWith([]);
    });
  });

  describe('getSaldosUsuario', () => {
    /**
     * CASO: Sin autenticación
     * REFERENCIA: OWASP API02:2023
     */
    it('debería retornar 401 si no hay userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {} });
      await getSaldosUsuario(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar saldos del usuario autenticado', async () => {
      service.getSaldosUsuario.mockResolvedValue({ ausencias: [], francos: 0 });
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });

      await getSaldosUsuario(req, res, next);

      expect(service.getSaldosUsuario).toHaveBeenCalledWith(10);
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ─────────────────────────── getSolicitudesUsuario ───────────────────────────

  describe('getSolicitudesUsuario', () => {
    it('debería retornar 401 si no hay userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {} });
      await getSolicitudesUsuario(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería usar userContextId del token para filtrar', async () => {
      service.getSolicitudesUsuario.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });

      await getSolicitudesUsuario(req, res, next);

      expect(service.getSolicitudesUsuario).toHaveBeenCalledWith(10);
    });
  });

  // ─────────────────────────── crearSolicitud ───────────────────────────

  describe('crearSolicitud', () => {
    it('debería retornar 401 si no hay userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, body: {} });
      await crearSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    /**
     * CASO: El controller fuerza usuario_id desde token
     * RIESGO: Mass assignment - usuario envía usuario_id en body
     * REFERENCIA: OWASP API03:2023
     */
    it('debería usar userContextId del token como usuario_id, ignorando body', async () => {
      service.crearSolicitud.mockResolvedValue({} as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00', cantidad_dias: 5 },
      });

      await crearSolicitud(req, res, next);

      expect(service.crearSolicitud).toHaveBeenCalledWith(10, expect.objectContaining({
        tipo_licencia_id: 1,
        fecha_inicio: expect.any(Date),
        cantidad_dias: 5,
      }));
    });

    it('debería retornar 201 en creación exitosa', async () => {
      service.crearSolicitud.mockResolvedValue({ id: 1 } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00', cantidad_dias: 5 },
      });

      await crearSolicitud(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('debería retornar 422 si el servicio lanza AppError de saldo insuficiente', async () => {
      const { UnprocessableEntityError } = await import('../../adapters/errors/AppError');
      service.crearSolicitud.mockRejectedValue(new UnprocessableEntityError('Saldo insuficiente'));
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00', cantidad_dias: 5 },
      });

      await crearSolicitud(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422, message: 'Saldo insuficiente' }));
    });

    it('debería retornar 400 si falta tipo_licencia_id o fecha_inicio', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { fecha_inicio: '2027-01-01T09:00', cantidad_dias: 5 },
      });
      await crearSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 400 si no se envía ni cantidad_dias ni cantidad_horas', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00' },
      });
      await crearSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 400 si se envían ambos cantidad_dias y cantidad_horas', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00', cantidad_dias: 2, cantidad_horas: 4 },
      });
      await crearSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 400 si cantidad_dias no es número positivo', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00', cantidad_dias: -1 },
      });
      await crearSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 400 si cantidad_horas no es número positivo', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 1, fecha_inicio: '2027-01-01T09:00', cantidad_horas: 0 },
      });
      await crearSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería crear solicitud con cantidad_horas exitosamente', async () => {
      service.crearSolicitud.mockResolvedValue({ id: 2 } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { tipo_licencia_id: 3, fecha_inicio: '2027-01-01T09:00', cantidad_horas: 4 },
      });

      await crearSolicitud(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(service.crearSolicitud).toHaveBeenCalledWith(10, expect.objectContaining({
        tipo_licencia_id: 3,
        cantidad_horas: 4,
      }));
    });
  });

  // ─────────────────────────── adjuntarArchivo ───────────────────────────

  describe('adjuntarArchivo', () => {
    it('debería retornar 401 si no hay userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' } });
      await adjuntarArchivo(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 404 si no se provee archivo_id', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        params: { id: '1' },
        body: {},
      });
      await adjuntarArchivo(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 404 si solicitudId es inválido', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        params: { id: 'abc' },
        body: { archivo_id: 1 },
      });
      await adjuntarArchivo(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  // ─────────────────────────── cancelarSolicitud ───────────────────────────

  describe('cancelarSolicitud', () => {
    it('debería retornar 401 si no hay userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' } });
      await cancelarSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 404 si id es 0 o NaN', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        params: { id: '0' },
      });
      await cancelarSolicitud(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  // ─────────────────────────── aprobarSolicitud ───────────────────────────

  describe('aprobarSolicitud', () => {
    it('debería retornar 200 en aprobación exitosa', async () => {
      service.aprobarSolicitud.mockResolvedValue(undefined);
      service.getUsuarioIdDeSolicitud.mockResolvedValue(10);
      devices.sendNotificationToUser.mockResolvedValue({ success: true, sentCount: 1, errors: [] });
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 20 },
        params: { id: '1' },
        body: { observacion: 'OK' },
      });
      await aprobarSolicitud(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
      expect(devices.sendNotificationToUser).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          data: expect.objectContaining({ domain: 'licencias', event: 'status_changed' }),
        })
      );
    });

    /**
     * CASO: Error de servicio expone error.message
     * RIESGO: Information disclosure
     * REFERENCIA: OWASP API08:2023
     */
    it('debería retornar 500 si el servicio falla sin datos sensibles', async () => {
      service.aprobarSolicitud.mockRejectedValue(new Error('Saldo insuficiente'));
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 20 },
        params: { id: '1' },
        body: {},
      });
      await aprobarSolicitud(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 500,
        message: 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.',
      }));
    });
  });

  // ─────────────────────────── rechazarSolicitud ───────────────────────────

  describe('rechazarSolicitud', () => {
    it('debería retornar 200 en rechazo exitoso', async () => {
      service.rechazarSolicitud.mockResolvedValue(undefined);
      service.getUsuarioIdDeSolicitud.mockResolvedValue(10);
      devices.sendNotificationToUser.mockResolvedValue({ success: true, sentCount: 1, errors: [] });
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 20 },
        params: { id: '1' },
        body: { observacion: 'No aprobado' },
      });
      await rechazarSolicitud(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
      expect(devices.sendNotificationToUser).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          data: expect.objectContaining({ domain: 'licencias', event: 'status_changed' }),
        })
      );
    });

    it('debería retornar 500 si el servicio falla sin datos sensibles', async () => {
      service.rechazarSolicitud.mockRejectedValue(new Error('DB error'));
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 20 },
        params: { id: '1' },
        body: { observacion: 'No aprobado' },
      });
      await rechazarSolicitud(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 500,
        message: 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.',
      }));
    });
  });
});
