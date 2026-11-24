import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { RequestHandler } from 'express';

// Cada test recarga el módulo para arrancar con contadores en cero.
const cargarLimiters = () => {
  let mod: typeof import('../../adapters/middlewares/rateLimiter');
  jest.isolateModules(() => {
    mod = require('../../adapters/middlewares/rateLimiter');
  });
  return mod!;
};

const levantar = async (limiters: RequestHandler[]) => {
  const app = express();
  app.use(express.json());
  app.put('/recuperar', ...limiters, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const pedir = (email?: string) =>
    fetch(`http://127.0.0.1:${port}/recuperar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(email === undefined ? {} : { email }),
    }).then((r) => r.status);
  return { server, pedir };
};

describe('rate limit de recuperación de contraseña', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
  });

  it('forgot-password: el 4.º pedido desde la misma IP devuelve 429', async () => {
    const { passwordRecoveryRequestLimiter } = cargarLimiters();
    const app = await levantar([passwordRecoveryRequestLimiter]);
    server = app.server;

    const estados = [];
    for (const email of ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']) estados.push(await app.pedir(email));

    expect(estados).toEqual([200, 200, 200, 429]);
  });

  it('por email: un mismo email se corta al 4.º pedido aunque cambie la IP; otro email tiene su propio contador', async () => {
    const { passwordRecoveryRequestEmailLimiter } = cargarLimiters();
    const app = await levantar([passwordRecoveryRequestEmailLimiter]);
    server = app.server;

    const victima = [];
    for (let i = 0; i < 4; i++) victima.push(await app.pedir(' Victima@X.com '));
    expect(victima).toEqual([200, 200, 200, 429]);

    // Normaliza mayúsculas/espacios: es la misma cuenta.
    expect(await app.pedir('victima@x.com')).toBe(429);
    expect(await app.pedir('otro@x.com')).toBe(200);
  });

  it('forgot-password/token: permite 10 validaciones y corta la 11.ª', async () => {
    const { passwordRecoveryValidateLimiter, passwordRecoveryValidateEmailLimiter } = cargarLimiters();
    const app = await levantar([passwordRecoveryValidateLimiter, passwordRecoveryValidateEmailLimiter]);
    server = app.server;

    const estados = [];
    for (let i = 0; i < 11; i++) estados.push(await app.pedir('victima@x.com'));

    expect(estados.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(estados[10]).toBe(429);
  });
});
