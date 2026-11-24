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

describe('auth() middleware', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
    mockValidateAccessToken.mockReturnValue({ role: 'analyst', userContextId: 10 } as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('retorna 401 sin header authorization', async () => {
    const req = buildReq();
    const res = buildRes();

    await auth('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 con authorization sin Bearer', async () => {
    const req = buildReq({ headers: { authorization: 'token' } });
    const res = buildRes();

    await auth('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('pasa x-entorno a validateAccessToken y llama next', async () => {
    const req = buildReq({ headers: { authorization: 'Bearer valid.token', 'x-entorno': 'web' } });
    const res = buildRes();

    await auth('analyst')(req, res, next);

    expect(mockValidateAccessToken).toHaveBeenCalledWith('valid.token', 'web');
    expect(req.user).toEqual(expect.objectContaining({ role: 'analyst' }));
    expect(next).toHaveBeenCalled();
  });

  it('retorna 412 si validateAccessToken lanza ContextMismatch', async () => {
    mockValidateAccessToken.mockImplementation(() => {
      throw new Error('ContextMismatch');
    });
    const req = buildReq({ headers: { authorization: 'Bearer valid.token', 'x-entorno': 'mayorista' } });
    const res = buildRes();

    await auth('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(412);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 403 cuando rol no permitido', async () => {
    const req = buildReq({ headers: { authorization: 'Bearer valid.token' } });
    const res = buildRes();

    await auth('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authRefresh() middleware', () => {
  let next: jest.Mock;
  const dbToken = {
    id: 1,
    rol_nombre: 'analyst',
    user_context_id: 99,
    id_entidad: 7,
    id_entidad_tipo: 2,
    origen: 'web',
    id_usuario_entidad: 99,
    revoked: false,
  };

  beforeEach(() => {
    next = jest.fn();
    mockHashRefreshToken.mockReturnValue('hashed-token');
    mockFindRefreshTokenByHash.mockResolvedValue(dbToken as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('retorna 401 cuando falta refreshToken en body', async () => {
    const req = buildReq({ body: {} });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 cuando hash no existe en DB', async () => {
    mockFindRefreshTokenByHash.mockResolvedValue(null as any);
    const req = buildReq({ body: { refreshToken: 'raw-token' } });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(mockHashRefreshToken).toHaveBeenCalledWith('raw-token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('detecta reuso de token revocado y revoca familia', async () => {
    mockFindRefreshTokenByHash.mockResolvedValue({ ...dbToken, revoked: true } as any);
    const req = buildReq({ body: { refreshToken: 'raw-token' } });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(mockRevokeAllUserRefreshTokens).toHaveBeenCalledWith(99);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('construye req.user y req.dbToken desde DB', async () => {
    const req = buildReq({ body: { refreshToken: 'raw-token' } });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(req.user).toEqual({
      role: 'analyst',
      userContextId: 99,
      entidadId: 7,
      entidadTipoId: 2,
      entorno: 'web',
    });
    expect(req.dbToken).toEqual(dbToken);
    expect(next).toHaveBeenCalled();
  });

  it('retorna 403 cuando rol de DB no coincide', async () => {
    const req = buildReq({ body: { refreshToken: 'raw-token' } });
    const res = buildRes();

    await authRefresh('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 si falla consulta de DB', async () => {
    mockFindRefreshTokenByHash.mockRejectedValue(new Error('db fail'));
    const req = buildReq({ body: { refreshToken: 'raw-token' } });
    const res = buildRes();

    await authRefresh('analyst')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
