// tests/controllers/authControllers.test.ts

// ==========================================
// MOCKING DE MÓDULOS
// ==========================================
jest.mock('../../domain/services/authServices');
jest.mock('../../domain/services/devicesService');

// AHORA sí importamos después de los mocks
import {
  loginController,
  refreshTokenController,
  logoutController
} from '../../controllers/authControllers';
import {
  createMockReqRes,
  fixtures
} from './controllersMocks';

// Obtener referencias a los módulos mockeados
import * as authServices from '../../domain/services/authServices';

const authServicesMock = jest.mocked(authServices);

describe('Auth Controllers', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================
  // TEST: LOGIN CONTROLLER
  // ==========================================
  describe('loginController', () => {
    const validationErrorCases = [
      {
        description: 'no se envió username ni email',
        body: {},
        headers: {},
        expectedStatus: 400,
        expectedErrorMatch: /ingrese nombre de usuario o email/i
      },
      {
        description: 'no se envió email',
        body: { username: '' },
        headers: { 'x-app-entorno': 'web' },
        expectedStatus: 400,
        expectedErrorMatch: /ingrese nombre de usuario o email/i
      },
      {
        description: 'no se enviaron headers con entorno',
        body: { username: 'test' },
        headers: {},
        expectedStatus: 400,
        expectedErrorMatch: /Entorno no válido/i
      },
      {
        description: 'se envió entorno inválido',
        body: { username: 'test' },
        headers: { 'x-app-entorno': 'invalido' },
        expectedStatus: 400,
        expectedErrorMatch: /Entorno no válido/i
      }
    ];

    it.each(validationErrorCases)(
      'debería llamar a next con statusCode $expectedStatus cuando $description',
      async ({ body, headers, expectedStatus, expectedErrorMatch }) => {
        const { req, res, next } = createMockReqRes({ body, headers });

        await loginController(req, res, next);

        expect(next).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: expectedStatus,
            message: expect.stringMatching(expectedErrorMatch)
          })
        );
      }
    );

    it('debería devolver AT + RT en el body en login exitoso (unificado)', async () => {
      const { req, res, next } = createMockReqRes({
        body: { username: 'user', password: '123' },
        headers: { 'x-app-entorno': 'web' }
      });
      authServicesMock.loginUser.mockResolvedValue(fixtures.successLoginResult);

      await loginController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: fixtures.accessToken,
        refreshToken: fixtures.refreshToken,
        requiresAssociation: false
      }));
      // No debería haber csrfToken ni cookies
      const responseBody = (res.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.csrfToken).toBeUndefined();
    });

    it('debería devolver solo accessToken si requiere asociación (Readonly)', async () => {
      const { req, res, next } = createMockReqRes({
        body: { email: 'new@test.com', password: '123' },
        headers: { 'x-app-entorno': 'web' }
      });

      authServicesMock.loginUser.mockResolvedValue({
        requiresAssociation: true,
        accessToken: 'readonly-token',
      });

      await loginController(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        requiresAssociation: true,
        accessToken: 'readonly-token'
      }));
    });

    it('debería llamar a next con error 500 si el servicio falla', async () => {
      const { req, res, next } = createMockReqRes({
        body: { username: 'fail', password: '123' },
        headers: { 'x-app-entorno': 'web' }
      });
      const error = new Error('Credenciales inválidas');
      authServicesMock.loginUser.mockRejectedValue(error);

      await loginController(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: expect.stringMatching(/problema inesperado/i)
        })
      );
    });
  });

  // ==========================================
  // TEST: REFRESH TOKEN CONTROLLER
  // ==========================================
  describe('refreshTokenController', () => {
    it('debería delegar en rotateAccessToken usando req.dbToken y entorno header', async () => {
      const { req, res, next } = createMockReqRes({
        headers: { 'x-app-entorno': 'web' },
        body: {}
      });
      (req as any).dbToken = { id: 1, id_usuario: 10 };

      authServicesMock.rotateAccessToken.mockResolvedValue({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        environmentChanged: false
      });

      await refreshTokenController(req, res, next);

      expect(authServicesMock.rotateAccessToken).toHaveBeenCalledWith((req as any).dbToken, 'web');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('debería rotar token y devolver AT + RT en body', async () => {
      const { req, res, next } = createMockReqRes({
        headers: { 'x-app-entorno': 'web' },
        body: { refreshToken: 'valid-rt' }
      });
      (req as any).dbToken = { id: 2, id_usuario: 10 };

      authServicesMock.rotateAccessToken.mockResolvedValue({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        environmentChanged: false
      });

      await refreshTokenController(req, res, next);

      expect(authServicesMock.rotateAccessToken).toHaveBeenCalledWith((req as any).dbToken, 'web');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: 'new-at',
        refreshToken: 'new-rt'
      }));
      // No debería haber csrfToken
      const responseBody = (res.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.csrfToken).toBeUndefined();
    });

    it('debería llamar a next con error 500 si el servicio falla', async () => {
      const { req, res, next } = createMockReqRes({
        headers: { 'x-app-entorno': 'mayorista' },
        body: { refreshToken: 'valid-rt' }
      });
      (req as any).dbToken = { id: 3, id_usuario: 20 };

      const error = new Error("No autorizado.");
      authServicesMock.rotateAccessToken.mockRejectedValue(error);

      await refreshTokenController(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: expect.any(String)
        })
      );
    });
  });

  // ==========================================
  // TEST: LOGOUT CONTROLLER
  // ==========================================
  describe('logoutController', () => {
    it('debería leer refreshToken del body y cerrar sesión', async () => {
      const { req, res, next } = createMockReqRes({
        body: { refreshToken: 'rt-to-kill' }
      });

      await logoutController(req, res, next);

      expect(authServicesMock.logoutUser).toHaveBeenCalledWith('rt-to-kill');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('debería llamar a next con UnauthorizedError si no hay refreshToken en body', async () => {
      const { req, res, next } = createMockReqRes({
        body: {}
      });

      await logoutController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
  });
});
