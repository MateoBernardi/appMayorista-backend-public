/**
 * Tests de controllers: archivosControllers
 * Capa: Controller
 * Plataforma: Transversal
 */

jest.mock('../../domain/services/archivosServices');
jest.mock('../../domain/services/devicesService');
jest.mock('../../adapters/db/rolesRepo');
jest.mock('../../adapters/archivos/archivosApi');

import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../adapters/errors/AppError';
import * as archivosService from '../../domain/services/archivosServices';
import { sendNotificationToMultipleUsers } from '../../domain/services/devicesService';
import { createMockReqRes } from '../helpers/testHelpers';
import {
  getArchivosController,
  getArchivosPersonalesController,
  searchArchivosByPersonaController,
  createArchivoController,
  createArchivoMetadataController,
  getArchivoUrlController,
  updateArchivoController,
  deleteArchivoController,
  searchArchivoByNombreController,
  moveArchivoController,
  getArchivoPermisosController,
  patchArchivoPermisosController,
  getArchivoViewersController,
} from '../../controllers/archivosControllers';

const service = jest.mocked(archivosService);
const mockedSendNotificationToMultipleUsers = jest.mocked(sendNotificationToMultipleUsers);

describe('Archivos Controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.resolveArchivoRecipientsToNotify.mockResolvedValue([]);
    service.resolveArchivoNotificationRecipients.mockResolvedValue([]);
  });

  // ─────────────────────────── getArchivosController ───────────────────────────

  describe('getArchivosController', () => {
    /**
     * CASO: Sin autenticación
     * REFERENCIA: OWASP API02:2023
     */
    it('debería retornar 401 si falta role', async () => {
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
      await getArchivosController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: { role: 'admin' } });
      await getArchivosController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 200 si no hay archivos (array vacío)', async () => {
      service.fetchArchivos.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({ user: { role: 'admin', userContextId: 10 } });
      await getArchivosController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería retornar 200 con archivos', async () => {
      service.fetchArchivos.mockResolvedValue([{ id: 1, nombre: 'test' }] as any);
      const { req, res, next } = createMockReqRes({ user: { role: 'admin', userContextId: 10 } });
      await getArchivosController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería exponer opened_at en respuesta para archivos leídos y no leídos', async () => {
      const openedAt = new Date('2026-04-09T14:00:00.000Z');
      const archivos = [
        { id: 1, nombre: 'sin-leer', opened_at: null },
        { id: 2, nombre: 'leido', opened_at: openedAt },
      ];

      service.fetchArchivos.mockResolvedValue(archivos as any);
      const { req, res, next } = createMockReqRes({ user: { role: 'admin', userContextId: 10 } });

      await getArchivosController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(archivos);
      expect((res.json as jest.Mock).mock.calls[0][0][0].opened_at).toBeNull();
      expect((res.json as jest.Mock).mock.calls[0][0][1].opened_at).toEqual(openedAt);
    });

    /**
     * CASO: Error interno no expone detalles
     * REFERENCIA: OWASP API08:2023
     */
    it('debería retornar 500 sin detalles internos si el servicio falla', async () => {
      service.fetchArchivos.mockRejectedValue(new Error('pg connection error at 10.0.0.5'));
      const { req, res, next } = createMockReqRes({ user: { role: 'admin', userContextId: 10 } });
      await getArchivosController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
      expect(JSON.stringify((next as jest.Mock).mock.calls[0][0].message)).not.toContain('10.0.0.5');
    });
  });

  // ─────────────────────────── getArchivosPersonalesController ───────────────────────────

  describe('getArchivosPersonalesController', () => {
    it('debería retornar 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {} });
      await getArchivosPersonalesController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 200 si no hay archivos personales (array vacío)', async () => {
      service.fetchArchivosPersonales.mockResolvedValue([]);
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
      await getArchivosPersonalesController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería retornar 200 con archivos personales', async () => {
      service.fetchArchivosPersonales.mockResolvedValue([{ id: 1, nombre: 'personal' }] as any);
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
      await getArchivosPersonalesController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería exponer opened_at en respuesta de archivos personales', async () => {
      const openedAt = new Date('2026-04-09T15:00:00.000Z');
      const archivos = [
        { id: 1, nombre: 'personal-sin-leer', opened_at: null },
        { id: 2, nombre: 'personal-leido', opened_at: openedAt },
      ];

      service.fetchArchivosPersonales.mockResolvedValue(archivos as any);
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });

      await getArchivosPersonalesController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(archivos);
      expect((res.json as jest.Mock).mock.calls[0][0][0].opened_at).toBeNull();
      expect((res.json as jest.Mock).mock.calls[0][0][1].opened_at).toEqual(openedAt);
    });

    it('debería retornar 500 sin detalles internos si el servicio falla', async () => {
      service.fetchArchivosPersonales.mockRejectedValue(new Error('pg connection error at 10.0.0.5'));
      const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
      await getArchivosPersonalesController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
      expect(JSON.stringify((next as jest.Mock).mock.calls[0][0].message)).not.toContain('10.0.0.5');
    });
  });

  // ─────────────────────────── searchArchivosByPersonaController ───────────────────────────

  describe('searchArchivosByPersonaController', () => {
    it('debería retornar 400 si término de búsqueda es muy corto', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userRol: 'admin', userContextId: 10 },
        query: { search: 'a' },
      });
      await searchArchivosByPersonaController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('debería retornar 401 si falta autorización', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, query: { search: 'test' } });
      await searchArchivosByPersonaController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
  });

  // ─────────────────────────── createArchivoController ───────────────────────────

  describe('createArchivoController', () => {
    it('debería retornar 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {} });
      await createArchivoController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 404 si falta el archivo', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test' },
      });
      await createArchivoController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    /**
     * CASO: created_by forzado desde token
     * RIESGO: Mass assignment - usuario envía created_by en body
     * REFERENCIA: OWASP API03:2023
     */
    it('debería usar userContextId del token como created_by', async () => {
      service.addArchivo.mockResolvedValue({ archivo: { id: 1 } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test', created_by: 999 },
        file: { buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 100, originalname: 'test.pdf' },
      });
      await createArchivoController(req, res, next);
      expect(service.addArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: 10 }),
        'admin',
        expect.any(Buffer)
      );
    });

    it('debería retornar 201 en creación exitosa', async () => {
      service.addArchivo.mockResolvedValue({ archivo: { id: 1 } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test', id_carpeta: 7 },
        file: { buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 100, originalname: 'test.pdf' },
      });
      await createArchivoController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(service.addArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ id_carpeta: 7 }),
        'admin',
        expect.any(Buffer)
      );
    });

    it('debería retornar 207 cuando hay warnings de permisos', async () => {
      service.addArchivo.mockResolvedValue({
        archivo: { id: 1 },
        warnings: { invalid_roles: ['empleado'], invalid_users: ['Juan Perez'], reason: 'x' },
      } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test', id_carpeta: 7 },
        file: { buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 100, originalname: 'test.pdf' },
      });

      await createArchivoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(207);
    });

    it('debería pasar uso EMPRESA por defecto si no se envía', async () => {
      service.addArchivo.mockResolvedValue({ archivo: { id: 1 } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test' },
        file: { buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 100, originalname: 'test.pdf' },
      });
      await createArchivoController(req, res, next);
      expect(service.addArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ uso: 'EMPRESA' }),
        'admin',
        expect.any(Buffer)
      );
    });

    it('debería aceptar uso LICENCIA cuando se envía', async () => {
      service.addArchivo.mockResolvedValue({ archivo: { id: 1 } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test', uso: 'LICENCIA' },
        file: { buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 100, originalname: 'test.pdf' },
      });
      await createArchivoController(req, res, next);
      expect(service.addArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ uso: 'LICENCIA' }),
        'admin',
        expect.any(Buffer)
      );
    });

    it('debería ignorar valor de uso inválido y usar EMPRESA', async () => {
      service.addArchivo.mockResolvedValue({ archivo: { id: 1 } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { nombre: 'test', uso: 'INVALIDO' },
        file: { buffer: Buffer.from('test'), mimetype: 'application/pdf', size: 100, originalname: 'test.pdf' },
      });
      await createArchivoController(req, res, next);
      expect(service.addArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ uso: 'EMPRESA' }),
        'admin',
        expect.any(Buffer)
      );
    });
  });

  describe('createArchivoMetadataController', () => {
    it('debería incluir el nombre de carpeta en el body de notificación cuando llega en req.body', async () => {
      service.addArchivo.mockResolvedValue({
        archivo: { id: 99, nombre: 'manual.pdf' },
        resolvedPermisos: { allowed_roles: [], usuarios_compartidos: [20] },
      } as any);
      service.resolveArchivoRecipientsToNotify.mockResolvedValue([20]);
      mockedSendNotificationToMultipleUsers.mockResolvedValue({
        success: true,
        results: new Map(),
        totalSent: 1,
      });

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: {
          nombre: 'manual.pdf',
          ruta_r2: 'uploads/10/manual.pdf',
          tamaño: 100,
          titulo: 'Manual',
          tipo: 'application/pdf',
          usuarios_compartidos: [20],
          nombre_carpeta: 'Recursos Humanos',
        },
      });

      await createArchivoMetadataController(req, res, next);

      expect(service.resolveArchivoRecipientsToNotify).toHaveBeenCalledWith(
        [],
        [20],
        [],
        99,
        false
      );
      expect(mockedSendNotificationToMultipleUsers).toHaveBeenCalledWith(
        [20],
        expect.objectContaining({
          body: '"manual.pdf" ha sido compartido contigo en la carpeta "Recursos Humanos."',
          data: expect.objectContaining({ carpeta_nombre: 'Recursos Humanos' }),
        })
      );
    });

    it('debería mantener body de notificación sin carpeta cuando no llega nombre de carpeta', async () => {
      service.addArchivo.mockResolvedValue({
        archivo: { id: 100, nombre: 'instructivo.pdf' },
        resolvedPermisos: { allowed_roles: [], usuarios_compartidos: [20] },
      } as any);
      service.resolveArchivoRecipientsToNotify.mockResolvedValue([20]);
      mockedSendNotificationToMultipleUsers.mockResolvedValue({
        success: true,
        results: new Map(),
        totalSent: 1,
      });

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: {
          nombre: 'instructivo.pdf',
          ruta_r2: 'uploads/10/instructivo.pdf',
          tamaño: 100,
          titulo: 'Instructivo',
          tipo: 'application/pdf',
          usuarios_compartidos: [20],
        },
      });

      await createArchivoMetadataController(req, res, next);

      expect(mockedSendNotificationToMultipleUsers).toHaveBeenCalledWith(
        [20],
        expect.objectContaining({
          body: '"instructivo.pdf" ha sido compartido contigo.',
          data: expect.not.objectContaining({ carpeta_nombre: expect.anything() }),
        })
      );
    });

    it('debería propagar statusCode y mensaje real cuando addArchivo falla', async () => {
      service.addArchivo.mockRejectedValue(new ForbiddenError('No tenés permisos sobre la carpeta destino para crear este archivo.'));

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'vendedor' },
        body: {
          nombre: 'manual.pdf',
          ruta_r2: 'uploads/10/manual.pdf',
          tamaño: 100,
          titulo: 'Manual',
          tipo: 'application/pdf',
          id_carpeta: 7,
        },
      });

      await createArchivoMetadataController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 403,
        message: 'No tenés permisos sobre la carpeta destino para crear este archivo.',
      }));
    });
  });

  // ─────────────────────────── getArchivoUrlController ───────────────────────────

  describe('getArchivoUrlController', () => {
    it('debería retornar 400 si id es inválido', async () => {
      const { req, res, next } = createMockReqRes({ params: { id: 'abc' } });
      await getArchivoUrlController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('debería retornar 200 con url firmada', async () => {
      service.getArchivoUrl.mockResolvedValue({
        archivo: { id: 1, nombre: 'test' },
        url: 'https://signed.url',
      } as any);
      const { req, res, next } = createMockReqRes({ params: { id: '1' }, user: { userContextId: 10 } });
      await getArchivoUrlController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    /**
     * CASO: Error del servicio expone error.message
     * RIESGO: Information disclosure
     * REFERENCIA: OWASP API08:2023
     */
    it('debería retornar mensaje de error del servicio en 500', async () => {
      service.getArchivoUrl.mockRejectedValue(new Error('R2 presigned URL generation failed'));
      const { req, res, next } = createMockReqRes({ params: { id: '1' }, user: { userContextId: 10 } });
      await getArchivoUrlController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });

  // ─────────────────────────── updateArchivoController ───────────────────────────

  describe('updateArchivoController', () => {
    it('debería retornar 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' } });
      await updateArchivoController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 400 si id es inválido', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: 'abc' },
        body: { nombre: 'updated' },
      });
      await updateArchivoController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería pasar role al servicio y responder archivo cuando no hay warnings', async () => {
      service.modifyArchivo.mockResolvedValue({ archivo: { id: 1, nombre: 'updated' } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { nombre: 'updated' },
      });

      await updateArchivoController(req, res, next);

      expect(service.modifyArchivo).toHaveBeenCalledWith(10, 1, expect.objectContaining({ nombre: 'updated' }), 'admin');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería responder payload con warnings cuando el update sanea permisos', async () => {
      service.modifyArchivo.mockResolvedValue({
        archivo: { id: 1, nombre: 'updated' },
        warnings: { invalid_roles: ['empleado'], invalid_users: ['Ana Gomez'], reason: 'x' },
      } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { allowed_roles: ['admin', 'empleado'] },
      });

      await updateArchivoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ warnings: expect.any(Object) }));
    });

    it('debería resolver destinatarios vía el servicio (marcando isUpdate) antes de persistir y notificar a los devueltos', async () => {
      service.modifyArchivo.mockResolvedValue({ archivo: { id: 1, nombre: 'updated' } } as any);
      service.resolveArchivoRecipientsToNotify.mockResolvedValue([21, 30]);
      mockedSendNotificationToMultipleUsers.mockResolvedValue({
        success: true,
        results: new Map(),
        totalSent: 1,
      });

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { allowed_roles: ['gerencia'], usuarios_compartidos: [20, 21] },
      });

      await updateArchivoController(req, res, next);

      expect(service.resolveArchivoRecipientsToNotify).toHaveBeenCalledWith(
        ['gerencia'],
        [20, 21],
        [],
        1,
        true
      );

      const resolveOrder = service.resolveArchivoRecipientsToNotify.mock.invocationCallOrder[0];
      const modifyOrder = service.modifyArchivo.mock.invocationCallOrder[0];
      expect(resolveOrder).toBeLessThan(modifyOrder);

      expect(mockedSendNotificationToMultipleUsers).toHaveBeenCalledWith(
        [21, 30],
        expect.objectContaining({ body: '"updated" ha sido compartido contigo.' })
      );
    });

    it('no debería consultar destinatarios ni notificar si no se actualizan roles ni usuarios compartidos', async () => {
      service.modifyArchivo.mockResolvedValue({ archivo: { id: 1, nombre: 'updated' } } as any);

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { nombre: 'updated' },
      });

      await updateArchivoController(req, res, next);

      expect(service.resolveArchivoRecipientsToNotify).not.toHaveBeenCalled();
      expect(mockedSendNotificationToMultipleUsers).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── deleteArchivoController ───────────────────────────

  describe('deleteArchivoController', () => {
    it('debería retornar 401 si falta autorización', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' } });
      await deleteArchivoController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 404 si id es 0 o negativo', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '0' },
      });
      await deleteArchivoController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('debería retornar 200 en eliminación exitosa', async () => {
      service.removeArchivo.mockResolvedValue({ id: 1 });
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
      });
      await deleteArchivoController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('moveArchivoController', () => {
    it('debería retornar 401 si falta autorización', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, params: { id: '1' }, body: { id_carpeta: 2 } });
      await moveArchivoController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 400 si id_carpeta falta', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: {},
      });
      await moveArchivoController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('debería retornar 200 si se mueve correctamente', async () => {
      service.moveArchivo.mockResolvedValue({ archivo: { id: 1, id_carpeta: 4 } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { id_carpeta: 4 },
      });
      await moveArchivoController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(service.moveArchivo).toHaveBeenCalledWith(1, 4, 10, 'admin');
    });

    it('debería retornar 207 si move devuelve warnings', async () => {
      service.moveArchivo.mockResolvedValue({
        archivo: { id: 1, id_carpeta: 4 },
        warnings: { invalid_roles: ['empleado'], invalid_users: ['Juan Perez'], reason: 'x' },
      } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { id_carpeta: 4 },
      });

      await moveArchivoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(207);
    });

    it('debería permitir mover a Sin carpeta con id_carpeta null', async () => {
      service.moveArchivo.mockResolvedValue({ archivo: { id: 1, id_carpeta: null } } as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { id_carpeta: null },
      });

      await moveArchivoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(service.moveArchivo).toHaveBeenCalledWith(1, null, 10, 'admin');
    });

    it('debería retornar 400 si id_carpeta es inválido', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { id_carpeta: 'abc' },
      });

      await moveArchivoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('debería devolver permisos de archivo con 200', async () => {
      service.getArchivoPermisos.mockResolvedValue({
        resource_type: 'archivo',
        resource_id: 1,
        owner_id: 10,
        allowed_roles: ['admin'],
        allowed_users: ['Juan Perez'],
      });
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
      });

      await getArchivoPermisosController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(service.getArchivoPermisos).toHaveBeenCalledWith(1, 10);
    });

    it('debería patch permisos de archivo con 200', async () => {
      service.patchPermisosArchivo.mockResolvedValue({
        resource_type: 'archivo',
        resource_id: 1,
        owner_id: 10,
        allowed_roles: ['admin'],
        allowed_users: ['Juan Perez'],
      });
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        params: { id: '1' },
        body: { allowed_roles: ['empleado'], ids: [20] },
      });

      await patchArchivoPermisosController(req, res, next);

      expect(service.patchPermisosArchivo).toHaveBeenCalledWith(1, { allowed_roles: ['empleado'], ids: [20] }, 10);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getArchivoViewersController', () => {
    it('debería retornar 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, body: { archivo_id: 1 } });

      await getArchivoViewersController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 400 si archivo_id es inválido', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { archivo_id: 'abc' },
      });

      await getArchivoViewersController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('debería retornar 200 con viewers del archivo', async () => {
      const viewers = [
        { user_context_id: 20, nombre: 'Ana', apellido: 'Gomez', visto_en: new Date('2026-04-09T10:00:00.000Z') },
      ];

      service.getArchivoViewersService.mockResolvedValue(viewers as any);
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { archivo_id: 1 },
      });

      await getArchivoViewersController(req, res, next);

      expect(service.getArchivoViewersService).toHaveBeenCalledWith(1, 10);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(viewers);
    });

    it('debería retornar 401 cuando el servicio rechaza por no ownership', async () => {
      service.getArchivoViewersService.mockRejectedValue(new UnauthorizedError('No autorizado.'));
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { archivo_id: 1 },
      });

      await getArchivoViewersController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería retornar 404 cuando el archivo no existe', async () => {
      service.getArchivoViewersService.mockRejectedValue(new NotFoundError('Archivo no encontrado.'));
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { archivo_id: 999 },
      });

      await getArchivoViewersController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 500 ante error inesperado', async () => {
      service.getArchivoViewersService.mockRejectedValue(new Error('Unexpected DB error'));
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, role: 'admin' },
        body: { archivo_id: 1 },
      });

      await getArchivoViewersController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });
  });
});
