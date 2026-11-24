import { NextFunction, Request, Response } from 'express';

/**
 * Helper compartido para crear mock de Request/Response de Express.
 * Reutilizado por todos los tests de controllers.
 */
interface MockRequestOptions {
  body?: any;
  headers?: any;
  cookies?: any;
  params?: any;
  query?: any;
  user?: any;
  file?: any;
  files?: any;
}

export const createMockReqRes = (options: MockRequestOptions = {}) => {
  const req = {
    body: options.body || {},
    headers: options.headers || {},
    cookies: options.cookies || {},
    params: options.params || {},
    query: options.query || {},
    user: options.user || undefined,
    file: options.file || undefined,
    files: options.files || undefined,
    method: 'GET',
    path: '/test',
  } as unknown as Request & { user?: any };

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
    cookie: jest.Mock;
    clearCookie: jest.Mock;
    send: jest.Mock;
  };

  const next = jest.fn() as jest.Mock & NextFunction;

  return { req, res, next };
};

/**
 * Payloads de inyección para tests de seguridad.
 * REFERENCIA: OWASP A03:2021 - Injection
 */
export const INJECTION_PAYLOADS = {
  sql: ["'; DROP TABLE users; --", "1' OR '1'='1", "UNION SELECT * FROM passwords--"],
  xss: ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>'],
  pathTraversal: ['../../../etc/passwd', '..\\..\\windows\\system32'],
  commandInjection: ['; rm -rf /', '| cat /etc/passwd', '`whoami`'],
};
