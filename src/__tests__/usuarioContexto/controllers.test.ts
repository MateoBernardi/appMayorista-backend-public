/**
 * Tests de controllers: usuarioContextoController
 * Capa: Controller
 * Plataforma: Transversal
 */

jest.mock('../../adapters/db/usuariosRepo');

import { createMockReqRes } from '../helpers/testHelpers';
import { usuarioContextoController } from '../../controllers/usuarioContextoController';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';

const mockUsuariosRepo = jest.mocked(usuariosRepo);

describe('UsuarioContexto Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * CASO: Sin token de acceso
   * REFERENCIA: OWASP API02:2023
   */
  it('debería llamar a next con UnauthorizedError si falta accessToken', async () => {
    const { req, res, next } = createMockReqRes({ headers: {}, body: {} });
    await usuarioContextoController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('debería llamar a next con UnauthorizedError si falta userContextId en req.user', async () => {
    const { req, res, next } = createMockReqRes({ user: {} });
    await usuarioContextoController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('debería llamar a next con NotFoundError si el usuario no existe en DB', async () => {
    const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
    mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue(null as any);
    await usuarioContextoController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  /**
   * CASO: Respuesta exitosa solo devuelve campos requeridos
   * RIESGO: Excesiva exposición de datos (password, ids internos)
   * REFERENCIA: OWASP API03:2023
   */
  it('debería retornar solo campos permitidos en respuesta exitosa', async () => {
    mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue({
      user_context_id: 10,
      username: 'jdoe',
      email: 'jdoe@test.com',
      nombre: 'John',
      apellido: 'Doe',
      rol_nombre: 'empleado',
      entidad_tipo_nombre: 'personal',
      password: 'hashed_secret',
      id_entidad: 5,
      secret_internal: 'x',
    } as any);
    const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
    await usuarioContextoController(req, res, next);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('user_context_id');
    expect(body).toHaveProperty('username');
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('nombre');
    expect(body).toHaveProperty('apellido');
    expect(body).toHaveProperty('rol_nombre');
    expect(body).toHaveProperty('entidad_tipo_nombre');
    // No debe exponer datos sensibles
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('id_entidad');
    expect(body).not.toHaveProperty('secret_internal');
  });

  it('debería consultar con Number(userContextId)', async () => {
    mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue({
      user_context_id: 10, username: 'u', email: 'e', nombre: 'n', apellido: 'a',
      rol_nombre: 'admin', entidad_tipo_nombre: 'personal',
    } as any);
    const { req, res, next } = createMockReqRes({ user: { userContextId: '10' as any } });
    await usuarioContextoController(req, res, next);
    expect(mockUsuariosRepo.getUsuarioEntidadByContextId).toHaveBeenCalledWith(10);
  });

  it('debería enviar headers anti-cache en respuesta exitosa', async () => {
    mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue({
      user_context_id: 10,
      username: 'jdoe',
      email: 'jdoe@test.com',
      nombre: 'John',
      apellido: 'Doe',
      rol_nombre: 'empleado',
      entidad_tipo_nombre: 'personal',
    } as any);

    const { req, res, next } = createMockReqRes({ user: { userContextId: 10 } });
    await usuarioContextoController(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, private'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization, Cookie, x-app-entorno, x-entorno');
  });
});
