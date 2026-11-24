// tests/utils/test-utils.ts
import { Request, Response } from 'express';

// Fábrica de Request y Response (Mock Factory)
interface MockRequestOptions {
  body?: any;
  headers?: any;
  params?: any;
  query?: any;
}

export const createMockReqRes = (options: MockRequestOptions = {}) => {
  const req = {
    body: options.body || {},
    headers: options.headers || {},
    params: options.params || {},
    query: options.query || {},
  } as unknown as Request;

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };

  const next = jest.fn();

  return { req, res, next };
};

// Data Fixtures (Datos falsos reutilizables)
export const fixtures = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  userProfile: {
    user_context_id: 10,
    rol_nombre: 'admin',
    entorno: 'web',
    entidad_tipo_nombre: 'empresa'
  },
  successLoginResult: {
    requiresAssociation: false,
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    availableProfiles: [{ user_context_id: 1, rol_nombre: 'admin' }]
  }
};
