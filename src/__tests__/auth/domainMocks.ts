import * as authValidations from '../../domain/validations/authValidations';
import * as authRepo from '../../adapters/db/authRepo';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as usuariosServices from '../../domain/services/usuariosServices';
import argon2 from 'argon2';

// Mocks - Mockear las DEPENDENCIAS, no authServices
jest.mock('../../domain/services/usuariosServices');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../adapters/db/authRepo');
jest.mock('../../domain/validations/authValidations');
jest.mock('argon2');

export const mocks = {
  validateUserCredentials: usuariosServices.validateUserCredentials as jest.MockedFunction<any>,
  getUsuarioEntidadCompleto: usuariosRepo.getUsuarioEntidadCompleto as jest.MockedFunction<any>,
  getAllUsuarioPerfiles: usuariosRepo.getAllUsuarioPerfiles as jest.MockedFunction<any>,
  findRefreshTokenByHash: authRepo.findRefreshTokenByHash as jest.MockedFunction<any>,
  findRefreshToken: authRepo.findRefreshToken as jest.MockedFunction<any>,
  saveRefreshToken: authRepo.saveRefreshToken as jest.MockedFunction<any>,
  revokeRefreshToken: authRepo.revokeRefreshToken as jest.MockedFunction<any>,
  getRefreshTokensByUserContextId: authRepo.getRefreshTokensByUserContextId as jest.MockedFunction<any>,
  generateAccessToken: authValidations.generateAccessToken as jest.MockedFunction<any>,
  generateRefreshToken: authValidations.generateRefreshToken as jest.MockedFunction<any>,
  hashRefreshToken: authValidations.hashRefreshToken as jest.MockedFunction<any>,
  getRefreshExpiresAt: authValidations.getRefreshExpiresAt as jest.MockedFunction<any>,
  argon2Verify: argon2.verify as jest.MockedFunction<any>,
};

export const testUsers = {
  user1: { id: 1, username: 'juan', email: 'juan@test.com' },
  user2: { id: 2, username: 'maria', email: 'maria@test.com' },
  user42: { id: 42, username: 'testuser', email: 'test@test.com' },
};

export const testContexts = {
  admin_web: {
    user_context_id: 101,
    id_usuario: 1,
    rol_nombre: 'admin',
    id_entidad_tipo: 10,
    id_entidad: 100,
    entorno: 'web',
    entidad_tipo_nombre: 'empleado'
  },
  cliente_web: {
    user_context_id: 102,
    id_usuario: 1,
    rol_nombre: 'cliente',
    id_entidad_tipo: 10,
    id_entidad: 101,
    entorno: 'web',
    entidad_tipo_nombre: 'cliente'
  },
  deposito_mayorista: {
    user_context_id: 201,
    id_usuario: 1,
    rol_nombre: 'deposito',
    id_entidad_tipo: 11,
    id_entidad: 200,
    entorno: 'mayorista',
    entidad_tipo_nombre: 'deposito'
  },
  gerencia_interno: {
    user_context_id: 301,
    id_usuario: 1,
    rol_nombre: 'gerencia',
    id_entidad_tipo: 12,
    id_entidad: 300,
    entorno: 'interno',
    entidad_tipo_nombre: 'empleado'
  },
};

export const testDbTokens = {
  web_token: {
    id: 1,
    id_usuario: 1,
    id_usuario_entidad: 101,
    rol_nombre: 'admin',
    id_entidad_tipo: 10,
    id_entidad: 100,
    origen: 'web',
    token: 'hashed-web-token'
  },
  mayorista_token: {
    id: 2,
    id_usuario: 1,
    id_usuario_entidad: 201,
    rol_nombre: 'deposito',
    id_entidad_tipo: 11,
    id_entidad: 200,
    origen: 'mayorista',
    token: 'hashed-mayorista-token'
  },
  interno_token: {
    id: 3,
    id_usuario: 1,
    id_usuario_entidad: 301,
    rol_nombre: 'gerencia',
    id_entidad_tipo: 12,
    id_entidad: 300,
    origen: 'interno',
    token: 'hashed-interno-token'
  },
};

export const setupMocks = () => {
  jest.resetAllMocks();
  mocks.getRefreshExpiresAt.mockReturnValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
};

export const setupDefaultMocks = () => {
  setupMocks();
  
  // Defaults
  mocks.validateUserCredentials.mockResolvedValue(testUsers.user1);
  mocks.generateAccessToken.mockReturnValue('mock-access-token');
  mocks.hashRefreshToken.mockReturnValue('mock-hashed-token');
  mocks.generateRefreshToken.mockResolvedValue({ 
    token: 'mock-refresh-token', 
    hashedToken: 'mock-hashed-token' 
  });
  mocks.argon2Verify.mockResolvedValue(true);
  mocks.getRefreshExpiresAt.mockReturnValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  mocks.getRefreshTokensByUserContextId.mockResolvedValue([]);
};
