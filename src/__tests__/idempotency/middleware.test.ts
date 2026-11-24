jest.mock('../../domain/services/idempotencyService');

import { EventEmitter } from 'events';
import { Request, Response, NextFunction } from 'express';
import * as idempotencyService from '../../domain/services/idempotencyService';
import { idempotency } from '../../adapters/middlewares/idempotency';

const mockService = jest.mocked(idempotencyService);

const OWNER = '7';
const KEY = '11111111-1111-1111-1111-111111111111';

const makeReq = (method: string, headers: Record<string, string> = {}): Request =>
  ({
    method,
    header: (name: string) => headers[name.toLowerCase()],
    user: { userId: 7 },
  }) as unknown as Request;

interface FakeResponse extends Response {
  body: unknown;
  emitFinish: (statusCode: number) => void;
  emitClose: () => void;
}

const makeRes = (): FakeResponse => {
  const emitter = new EventEmitter();
  const res: any = emitter;
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.emitFinish = (statusCode: number) => {
    res.statusCode = statusCode;
    emitter.emit('finish');
  };
  res.emitClose = () => emitter.emit('close');
  return res as FakeResponse;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('idempotency middleware', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    mockService.completeIdempotentRequest.mockResolvedValue(undefined);
    mockService.failIdempotentRequest.mockResolvedValue(undefined);
  });

  it('passes through non-mutation methods untouched', async () => {
    const res = makeRes();
    await idempotency(makeReq('GET', { 'x-idempotency-key': KEY }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockService.beginIdempotentRequest).not.toHaveBeenCalled();
  });

  it('passes through mutations without the header (opt-in)', async () => {
    const res = makeRes();
    await idempotency(makeReq('POST'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockService.beginIdempotentRequest).not.toHaveBeenCalled();
  });

  describe('Test 1 - Happy path', () => {
    it('runs the controller and caches a 2xx response on finish', async () => {
      mockService.beginIdempotentRequest.mockResolvedValue({ type: 'acquired' });
      const res = makeRes();

      await idempotency(makeReq('POST', { 'x-idempotency-key': KEY }), res, next);
      expect(next).toHaveBeenCalledTimes(1);

      res.status(201).json({ id: 42 });
      res.emitFinish(201);
      await flush();

      expect(mockService.completeIdempotentRequest).toHaveBeenCalledWith(OWNER, KEY, {
        code: 201,
        body: { id: 42 },
      });
      expect(mockService.failIdempotentRequest).not.toHaveBeenCalled();
    });
  });

  describe('Test 2 - Replay path', () => {
    it('short-circuits with the cached code and body, never calling next', async () => {
      mockService.beginIdempotentRequest.mockResolvedValue({
        type: 'replay',
        response: { code: 201, body: { id: 42, ok: true } },
      });
      const res = makeRes();

      await idempotency(makeReq('POST', { 'x-idempotency-key': KEY }), res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 42, ok: true });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Test 3 - Concurrency', () => {
    it('rejects an in-flight duplicate with 409', async () => {
      mockService.beginIdempotentRequest.mockResolvedValue({ type: 'conflict' });
      const res = makeRes();

      await idempotency(makeReq('POST', { 'x-idempotency-key': KEY }), res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Test 4 - Failure recovery', () => {
    it('deletes the lock when the controller fails with a 5xx', async () => {
      mockService.beginIdempotentRequest.mockResolvedValue({ type: 'acquired' });
      const res = makeRes();

      await idempotency(makeReq('POST', { 'x-idempotency-key': KEY }), res, next);
      res.emitFinish(500);
      await flush();

      expect(mockService.failIdempotentRequest).toHaveBeenCalledWith(OWNER, KEY);
      expect(mockService.completeIdempotentRequest).not.toHaveBeenCalled();
    });

    it('deletes the lock when the connection closes before finishing', async () => {
      mockService.beginIdempotentRequest.mockResolvedValue({ type: 'acquired' });
      const res = makeRes();

      await idempotency(makeReq('POST', { 'x-idempotency-key': KEY }), res, next);
      res.emitClose();
      await flush();

      expect(mockService.failIdempotentRequest).toHaveBeenCalledWith(OWNER, KEY);
    });

    it('forwards service errors to the error handler', async () => {
      const boom = new Error('db down');
      mockService.beginIdempotentRequest.mockRejectedValue(boom);
      const res = makeRes();

      await idempotency(makeReq('POST', { 'x-idempotency-key': KEY }), res, next);

      expect(next).toHaveBeenCalledWith(boom);
    });
  });
});
