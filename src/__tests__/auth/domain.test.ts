process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

// Primero importar mocks para configurar jest.mock()
import { 
  mocks, 
  testUsers, 
  testContexts, 
  testDbTokens,
  setupDefaultMocks, 
} from './domainMocks';

// Luego importar authServices con sus dependencias ya mockeadas
const { loginUser, rotateAccessToken, logoutUser } = jest.requireActual('../../domain/services/authServices') as any;

describe('Auth Services - Domain Logic Tests', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // LOGIN TESTS
  // ============================================
  describe('loginUser()', () => {
    describe('Validación de credenciales', () => {
      it('debería retornar null si las credenciales son inválidas', async () => {
        mocks.validateUserCredentials.mockResolvedValue(null);
        await expect(loginUser('user@test.com', 'password', 'web')).resolves.toBeNull();
      });
    });

    describe('CAMINO 1: Sin entidad → AT readonly', () => {
      beforeEach(() => {
        mocks.validateUserCredentials.mockResolvedValue(testUsers.user1);
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([]);
        mocks.generateAccessToken.mockReturnValue('readonly-token');
      });

      it('debería devolver AT readonly sin guardar en BD', async () => {
        const result = await loginUser('user1', 'pass', 'web');
        expect(result.requiresAssociation).toBe(true);
        expect(result.accessToken).toBe('readonly-token');
        expect(mocks.saveRefreshToken).not.toHaveBeenCalled();
      });

      it('NO debería devolver refreshToken', async () => {
        const result = await loginUser('user1', 'pass', 'web');
        expect(result.refreshToken).toBeUndefined();
      });

      it('NO debería devolver csrfToken', async () => {
        const result = await loginUser('user1', 'pass', 'web');
        expect(result.csrfToken).toBeUndefined();
      });
    });

    describe('CAMINO 2: Con entidad → AT + RT', () => {
      beforeEach(() => {
        mocks.validateUserCredentials.mockResolvedValue(testUsers.user1);
      });

      it('debería generar AT con primer usuarioEntidad', async () => {
        const contexts = [testContexts.admin_web, testContexts.cliente_web];
        mocks.getUsuarioEntidadCompleto.mockResolvedValue(contexts);
        mocks.getAllUsuarioPerfiles.mockResolvedValue(contexts);

        await loginUser('user1', 'pass', 'web');

        expect(mocks.generateAccessToken).toHaveBeenCalledWith(
          1,
          'admin',
          expect.objectContaining({
            userContextId: 101,
            entorno: 'web'
          })
        );
      });

      it('debería guardar RT hasheado en BD', async () => {
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([testContexts.admin_web]);
        mocks.getAllUsuarioPerfiles.mockResolvedValue([testContexts.admin_web, testContexts.cliente_web]);

        await loginUser('user1', 'pass', 'web');

        expect(mocks.saveRefreshToken).toHaveBeenCalledWith(
          101,
          'mock-hashed-token',
          expect.any(Date)
        );
      });

      it('debería devolver AT + RT (sin csrfToken)', async () => {
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([testContexts.admin_web]);
        mocks.getAllUsuarioPerfiles.mockResolvedValue([testContexts.admin_web, testContexts.cliente_web]);

        const result = await loginUser('user1', 'pass', 'web');

        expect(result.requiresAssociation).toBe(false);
        expect(result.accessToken).toBe('mock-access-token');
        expect(result.refreshToken).toBe('mock-refresh-token');
        expect(result.csrfToken).toBeUndefined();
      });

      it('debería obtener todos los perfiles del usuario', async () => {
        const allProfiles = [testContexts.admin_web, testContexts.cliente_web];
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([testContexts.admin_web]);
        mocks.getAllUsuarioPerfiles.mockResolvedValue(allProfiles);

        const result = await loginUser('user1', 'pass', 'web');

        expect(mocks.getAllUsuarioPerfiles).toHaveBeenCalledWith(101);
        expect(result.availableProfiles).toHaveLength(2);
      });

      it('debería lanzar error si el contexto activo viene indefinido', async () => {
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([undefined]);
        await expect(loginUser('user1', 'pass', 'web')).rejects.toThrow('No se encontró sesión activa para el usuario');
      });
    });
  });

  // ============================================
  // ROTATE ACCESS TOKEN TESTS
  // ============================================
  describe('rotateAccessToken()', () => {
    const dbToken = {
      id: 1,
      id_usuario: 1,
      id_usuario_entidad: 101,
      rol_nombre: 'admin',
      id_entidad_tipo: 10,
      id_entidad: 100,
      origen: 'web'
    };

    describe('Cambio de entorno sin perfil', () => {
      it('debería lanzar error "No autorizado."', async () => {
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([]);

        await expect(rotateAccessToken(dbToken, 'mayorista'))
          .rejects.toThrow('No autorizado.');
      });
    });

    describe('Cambio de entorno con perfil', () => {
      beforeEach(() => {
        mocks.getUsuarioEntidadCompleto.mockResolvedValue([testContexts.deposito_mayorista]);
        mocks.revokeRefreshToken.mockResolvedValue(undefined);
        mocks.getRefreshTokensByUserContextId.mockResolvedValue([]);
      });

      it('debería generar nuevos AT + RT (sin csrfToken)', async () => {
        const result = await rotateAccessToken(dbToken, 'mayorista');
        expect(result.accessToken).toBe('mock-access-token');
        expect(result.refreshToken).toBe('mock-refresh-token');
        expect(result.environmentChanged).toBe(true);
        expect(result.csrfToken).toBeUndefined();
      });

      it('debería devolver perfil del nuevo entorno', async () => {
        const result = await rotateAccessToken(dbToken, 'mayorista');
        expect(result.profile?.entorno).toBe('mayorista');
        expect(result.profile?.rol).toBe('deposito');
      });

      it('debería revocar token anterior', async () => {
        await rotateAccessToken(dbToken, 'mayorista');
        expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(dbToken.id);
      });

      it('debería revocar tokens activos del nuevo contexto', async () => {
        mocks.getRefreshTokensByUserContextId.mockResolvedValue([{ id: 77 }]);
        await rotateAccessToken(dbToken, 'mayorista');
        expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(77);
      });
    });

    describe('Renovación en mismo entorno', () => {
      it('debería generar nuevos AT + RT (sin csrfToken)', async () => {
        const result = await rotateAccessToken(dbToken, 'web');
        expect(result.accessToken).toBe('mock-access-token');
        expect(result.refreshToken).toBe('mock-refresh-token');
        expect(result.environmentChanged).toBe(false);
        expect(result.csrfToken).toBeUndefined();
      });

      it('NO debería devolver profile en renovación simple', async () => {
        const result = await rotateAccessToken(dbToken, 'web');
        expect(result.profile).toBeUndefined();
      });

      it('debería guardar nuevo RT hasheado en BD', async () => {
        await rotateAccessToken(dbToken, 'web');
        expect(mocks.saveRefreshToken).toHaveBeenCalledWith(
          101,
          'mock-hashed-token',
          expect.any(Date)
        );
      });

      it('debería revocar token anterior al renovar en mismo entorno', async () => {
        await rotateAccessToken(dbToken, 'web');
        expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(dbToken.id);
      });
    });
  });

  // ============================================
  // LOGOUT TESTS
  // ============================================
  describe('logoutUser()', () => {
    it('debería retornar true cuando no encuentra token (idempotente)', async () => {
      mocks.findRefreshTokenByHash.mockResolvedValue(null);
      await expect(logoutUser('token')).resolves.toBe(true);
      expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('debería retornar true cuando token ya está revocado (idempotente)', async () => {
      mocks.findRefreshTokenByHash.mockResolvedValue({ id: 10, revoked: true });
      await expect(logoutUser('token')).resolves.toBe(true);
      expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('debería revocar el token cuando está activo', async () => {
      mocks.findRefreshTokenByHash.mockResolvedValue({ id: 55, revoked: false });
      const result = await logoutUser('token');
      expect(result).toBe(true);
      expect(mocks.hashRefreshToken).toHaveBeenCalledWith('token');
      expect(mocks.revokeRefreshToken).toHaveBeenCalledWith(55);
    });
  });
});
