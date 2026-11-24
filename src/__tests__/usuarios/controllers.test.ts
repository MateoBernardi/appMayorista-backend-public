/**
 * Tests de controllers: usuariosControllers
 * Capa: Controller
 * Plataforma: Transversal
 *
 * Fidelidad: cada test refleja el comportamiento exacto del código de producción.
 */

jest.mock('../../domain/services/usuariosServices');

import { createMockReqRes } from '../helpers/testHelpers';
import {
  createUserController,
  updatePasswordController,
  getUserByIdController,
  getUsersController,
  updateUserController,
  updateUserRoleController,
  searchUsuariosController,
  searchUsuariosByRoleController,
  changePasswordController,
  bajaUsuarioController,
} from '../../controllers/usuariosControllers';
import * as usuariosService from '../../domain/services/usuariosServices';

const service = jest.mocked(usuariosService);

describe('Usuarios Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── createUserController ────────────

  describe('createUserController', () => {
    it('debería llamar a next con BadRequestError si faltan campos requeridos', async () => {
      // Producción: if (!username || !email || !password || !nombre || !apellido)
      const { req, res, next } = createMockReqRes({ body: { username: 'test' } });
      await createUserController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 400,
        message: 'Por favor, rellená todos los campos requeridos.',
      }));
    });

    it('debería retornar 201 y pasar solo los campos del DTO al servicio', async () => {
      // Producción construye un CreateUsuarioDTO con {username, email, password, nombre, apellido}
      service.createNewUser.mockResolvedValue({ id: 1, username: 'test' } as any);
      const { req, res, next } = createMockReqRes({
        body: { username: 'test', email: 't@t.com', password: 'pass1234', nombre: 'T', apellido: 'U', roleId: 999 },
      });
      await createUserController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      // Verificar que NO se pasan campos extra (mass assignment prevention)
      expect(service.createNewUser).toHaveBeenCalledWith({
        username: 'test', email: 't@t.com', password: 'pass1234', nombre: 'T', apellido: 'U',
      });
    });

    /**
     * OWASP API08:2023 – Error genérico, no expone detalles internos
     * Producción: catch → next(asAppError(error, 'Ocurrió un problema inesperado...'))
     */
    it('debería llamar a next con error 500 genérico sin info sensible', async () => {
      service.createNewUser.mockRejectedValue(new Error('argon2: memory allocation failed'));
      const { req, res, next } = createMockReqRes({
        body: { username: 'test', email: 't@t.com', password: 'pass1234', nombre: 'T', apellido: 'U' },
      });
      await createUserController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg.message).not.toContain('argon2');
    });
  });

  // ──────────── getUserByIdController ────────────

  describe('getUserByIdController', () => {
    it('debería llamar a next con NotFoundError si no se envía id', async () => {
      // Producción: if (!id) → NotFoundError
      const { req, res, next } = createMockReqRes({ params: {} });
      await getUserByIdController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería retornar 200 con el usuario y parsear id como parseInt', async () => {
      // Producción: getUserById(parseInt(id))
      service.getUserById.mockResolvedValue({ id: 5, username: 'jdoe' } as any);
      const { req, res, next } = createMockReqRes({ params: { id: '5' } });
      await getUserByIdController(req, res, next);
      expect(service.getUserById).toHaveBeenCalledWith(5);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { id: 5, username: 'jdoe' },
      }));
    });

    it('debería llamar a next si el servicio falla', async () => {
      service.getUserById.mockRejectedValue(new Error('Usuario no encontrado'));
      const { req, res, next } = createMockReqRes({ params: { id: '999' } });
      await getUserByIdController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
      // Producción: no expone error.message original (fallback genérico)
      const errorArg = (next as jest.Mock).mock.calls[0][0];
      expect(errorArg.message).not.toContain('no encontrado');
    });
  });

  // ──────────── getUsersController ────────────

  describe('getUsersController', () => {
    it('debería retornar 200 con lista de usuarios', async () => {
      service.getUsers.mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
      const { req, res, next } = createMockReqRes();
      await getUsersController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: [{ id: 1 }, { id: 2 }],
      }));
    });
  });

  // ──────────── updatePasswordController ────────────

  describe('updatePasswordController', () => {
    it('debería llamar a next con UnauthorizedError si falta userId en token', async () => {
      // Producción: const id = req.user?.userId; if (!id) → UnauthorizedError
      const { req, res, next } = createMockReqRes({ user: {}, body: {} });
      await updatePasswordController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería llamar a next con BadRequestError si faltan oldPassword o newPassword', async () => {
      // Producción: if (!oldPassword || !newPassword) → BadRequestError
      const { req, res, next } = createMockReqRes({ user: { userId: 1 }, body: {} });
      await updatePasswordController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 200 y llamar a updatePassword con los datos correctos', async () => {
      service.updatePassword.mockResolvedValue(true);
      const { req, res, next } = createMockReqRes({
        user: { userId: 1 },
        body: { oldPassword: 'old123', newPassword: 'new12345' },
      });
      await updatePasswordController(req, res, next);
      // Producción: updatePassword(id, oldPassword, newPassword)
      expect(service.updatePassword).toHaveBeenCalledWith(1, 'old123', 'new12345');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── updateUserController ────────────

  describe('updateUserController', () => {
    it('debería llamar a next con UnauthorizedError si falta userContextId en token', async () => {
      // Producción: const id = req.user?.userId; if (!id) → UnauthorizedError
      const { req, res, next } = createMockReqRes({ user: {}, body: {} });
      await updateUserController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería pasar solo username y email al servicio (ignora nombre, apellido del body)', async () => {
      // Producción destructura {username, email, nombre, apellido} del body
      // pero SOLO pasa {username, email} a updateUserData
      service.updateUserData.mockResolvedValue({ id: 1, username: 'upd' } as any);
      const { req, res, next } = createMockReqRes({
        user: { userId: 10 },
        body: { username: 'upd', email: 'e@e.com', nombre: 'Ignored', apellido: 'Ignored' },
      });
      await updateUserController(req, res, next);
      expect(service.updateUserData).toHaveBeenCalledWith(10, { username: 'upd', email: 'e@e.com' });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── updateUserRoleController ────────────

  describe('updateUserRoleController', () => {
    it('debería llamar a next con NotFoundError si faltan id o roleId', async () => {
      // Producción: if (!id || !roleId) → NotFoundError
      const { req, res, next } = createMockReqRes({ params: {}, body: {} });
      await updateUserRoleController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería parsear id con parseInt y pasar roleId directamente', async () => {
      // Producción: updateUserRoleService(parseInt(id), roleId)
      service.updateUserRoleService.mockResolvedValue(true);
      const { req, res, next } = createMockReqRes({
        params: { id: '5' },
        body: { roleId: 3 },
      });
      await updateUserRoleController(req, res, next);
      expect(service.updateUserRoleService).toHaveBeenCalledWith(5, 3);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── searchUsuariosController ────────────

  describe('searchUsuariosController', () => {
    it('debería llamar a next con BadRequestError si falta parámetro q o no es string', async () => {
      // Producción: if (!q || typeof q !== 'string') → BadRequestError
      const { req, res, next } = createMockReqRes({ query: {} });
      await searchUsuariosController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería pasar q directamente a searchUsuariosByNombreApellido', async () => {
      service.searchUsuariosByNombreApellido.mockResolvedValue([{ id: 1 }] as any);
      const { req, res, next } = createMockReqRes({ query: { q: 'john' } });
      await searchUsuariosController(req, res, next);
      expect(service.searchUsuariosByNombreApellido).toHaveBeenCalledWith('john');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── searchUsuariosByRoleController ────────────

  describe('searchUsuariosByRoleController', () => {
    it('debería llamar a next con NotFoundError si falta roleName en params', async () => {
      // Producción: if (!roleName) → NotFoundError
      const { req, res, next } = createMockReqRes({ params: {} });
      await searchUsuariosByRoleController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería pasar roleName al servicio y retornar 200', async () => {
      service.searchUsuariosByRole.mockResolvedValue([{ id: 1, rol_nombre: 'admin' }] as any);
      const { req, res, next } = createMockReqRes({ params: { roleName: 'admin' } });
      await searchUsuariosByRoleController(req, res, next);
      expect(service.searchUsuariosByRole).toHaveBeenCalledWith('admin');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── changePasswordController ────────────

  describe('changePasswordController', () => {
    it('debería llamar a next con UnauthorizedError si falta userId en token', async () => {
      const { req, res, next } = createMockReqRes({ user: {}, body: { newPassword: '12345678' } });
      await changePasswordController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    /**
     * HALLAZGO: producción NO valida newPassword en el controller.
     * Si newPassword es undefined, se pasa directamente a changePasswordService
     * que lanzará error genérico ("requeridos") → next con statusCode 500.
     */
    it('debería pasar newPassword=undefined al servicio si no viene en body (no valida en controller)', async () => {
      service.changePasswordService.mockRejectedValue(new Error('ID de usuario y nueva contraseña son requeridos'));
      const { req, res, next } = createMockReqRes({ user: { userId: 1 }, body: {} });
      await changePasswordController(req, res, next);
      // El servicio falla → controller llama a next con error 500 (no hay validación 400 en controller)
      expect(service.changePasswordService).toHaveBeenCalledWith(1, undefined);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });

    it('debería retornar 200 al cambiar contraseña exitosamente', async () => {
      service.changePasswordService.mockResolvedValue(true);
      const { req, res, next } = createMockReqRes({ user: { userId: 1 }, body: { newPassword: 'secure123' } });
      await changePasswordController(req, res, next);
      expect(service.changePasswordService).toHaveBeenCalledWith(1, 'secure123');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── bajaUsuarioController ────────────

  describe('bajaUsuarioController', () => {
    it('debería llamar a next con UnauthorizedError si falta autenticación (userContextId o userId)', async () => {
      // Producción: requireUserContextId(req) / if (!gerenteUserId) → UnauthorizedError
      const { req, res, next } = createMockReqRes({ user: {}, params: { usuarioId: '5' } });
      await bajaUsuarioController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería llamar a next con NotFoundError si falta usuarioId param', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, userId: 1 },
        params: {},
      });
      await bajaUsuarioController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería llamar a next con NotFoundError si usuarioId no es número (isNaN)', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, userId: 1 },
        params: { usuarioId: 'abc' },
      });
      await bajaUsuarioController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });

    it('debería llamar a next con BadRequestError si intenta darse de baja a sí mismo (compara userId con parseInt(param))', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, userId: 5 },
        params: { usuarioId: '5' },
      });
      await bajaUsuarioController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 400,
        message: 'Acción no válida.',
      }));
      // Verificar que el servicio NO fue llamado
      expect(service.bajaUsuarioService).not.toHaveBeenCalled();
    });

    it('debería retornar 200 y pasar (usuarioId, gerenteUserContextId) al servicio', async () => {
      service.bajaUsuarioService.mockResolvedValue({
        message: 'Usuario dado de baja',
        detalles: { tokenRevocados: true, personalDesactivado: true, entidadesEliminadas: 1, usuarioDesactivado: true },
      });
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10, userId: 1 },
        params: { usuarioId: '5' },
      });
      await bajaUsuarioController(req, res, next);
      // Producción: bajaUsuarioService(usuarioId, gerenteUserContextId)
      expect(service.bajaUsuarioService).toHaveBeenCalledWith(5, 10);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
