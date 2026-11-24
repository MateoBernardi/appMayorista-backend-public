import { auth, authRefresh } from '../../../src/adapters/auth/authPermisos';
import { validateAccessToken, hashRefreshToken } from '../../../src/domain/validations/authValidations';
import { findRefreshTokenByHash, revokeAllUserRefreshTokens } from '../../../src/adapters/db/authRepo';

jest.mock('../../../src/domain/validations/authValidations');
jest.mock('../../../src/adapters/db/authRepo');

const mockValidateAccessToken = validateAccessToken as jest.MockedFunction<typeof validateAccessToken>;
const mockHashRefreshToken = hashRefreshToken as jest.MockedFunction<typeof hashRefreshToken>;
const mockFindRefreshTokenByHash = findRefreshTokenByHash as jest.MockedFunction<typeof findRefreshTokenByHash>;
const mockRevokeAllUserRefreshTokens = revokeAllUserRefreshTokens as jest.MockedFunction<typeof revokeAllUserRefreshTokens>;

function buildReq(overrides: Record<string, any> = {}): any {
  return { headers: {}, body: {}, ...overrides };
}

function buildRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth security behavior', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
    mockValidateAccessToken.mockReturnValue({ role: 'analyst', userContextId: 10 } as any);
    mockHashRefreshToken.mockReturnValue('hashed');
    mockFindRefreshTokenByHash.mockResolvedValue({
      id: 1,
      rol_nombre: 'analyst',
      user_context_id: 10,
      id_entidad: 7,
      id_entidad_tipo: 2,
      origen: 'web',
      id_usuario_entidad: 10,
      revoked: false,
    } as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('no expone detalles internos en error de access token invalido', async () => {
    mockValidateAccessToken.mockImplementation(() => {
      throw new Error('jwt secret mismatch at /src/config.ts:42');
    });
    const req = buildReq({ headers: { authorization: 'Bearer bad.token' } });
    const res = buildRes();

    await auth('analyst')(req, res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('/src/');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rechaza Bearer vacio', async () => {
    const req = buildReq({ headers: { authorization: 'Bearer ' } });
    const res = buildRes();

    await auth('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('usa x-entorno sin mutarlo al validar token', async () => {
    const maliciousEnv = "'; DROP TABLE sessions; --";
    const req = buildReq({
      headers: { authorization: 'Bearer token', 'x-entorno': maliciousEnv },
    });
    const res = buildRes();

    await auth('analyst')(req, res, next);

    expect(mockValidateAccessToken).toHaveBeenCalledWith('token', maliciousEnv);
  });

  it('ignora payload manipulado y usa rol de DB en refresh', async () => {
    const req = buildReq({ body: { refreshToken: 'raw' } });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(req.user.role).toBe('analyst');
    expect(next).toHaveBeenCalled();
  });

  it('bloquea replay cuando token no existe en DB', async () => {
    mockFindRefreshTokenByHash.mockResolvedValue(null as any);
    const req = buildReq({ body: { refreshToken: 'old-token' } });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('revoca todos los tokens si detecta refresh token revocado', async () => {
    mockFindRefreshTokenByHash.mockResolvedValue({
      id: 1,
      rol_nombre: 'analyst',
      user_context_id: 10,
      id_entidad: 7,
      id_entidad_tipo: 2,
      origen: 'web',
      id_usuario_entidad: 10,
      revoked: true,
    } as any);
    const req = buildReq({ body: { refreshToken: 'stolen-token' } });
    const res = buildRes();
    jest.spyOn(console, 'warn').mockImplementation();

    await authRefresh('analyst')(req, res, next);

    expect(mockRevokeAllUserRefreshTokens).toHaveBeenCalledWith(10);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();

    (console.warn as jest.Mock).mockRestore();
  });
});
