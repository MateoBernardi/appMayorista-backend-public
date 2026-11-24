import { Request, Response, NextFunction } from 'express';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from '../../domain/services/idempotencyService';

const IDEMPOTENCY_HEADER = 'x-idempotency-key';
const MUTATION_METHODS = ['POST', 'PUT'];

// Scope each idempotency key to the authenticated caller so one user's key cannot
// replay another user's cached response or block it with a 409. Every route that
// carries this middleware runs after `auth`, so `req.user.userId` is populated; the
// 'anonymous' fallback only applies if the middleware is ever mounted without auth,
// in which case keys collapse to a single shared bucket (documented limitation).
const resolveOwnerKey = (req: Request): string =>
  String((req as any).user?.userId ?? 'anonymous');

export const idempotency = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!MUTATION_METHODS.includes(req.method)) {
    next();
    return;
  }

  const idempotencyKey = req.header(IDEMPOTENCY_HEADER);
  if (!idempotencyKey) {
    next();
    return;
  }

  const ownerKey = resolveOwnerKey(req);

  let outcome;
  try {
    outcome = await beginIdempotentRequest(ownerKey, idempotencyKey);
  } catch (error) {
    next(error);
    return;
  }

  if (outcome.type === 'replay') {
    res.status(outcome.response.code).json(outcome.response.body);
    return;
  }

  if (outcome.type === 'conflict') {
    res.status(409).json({
      message: 'Ya existe una solicitud en curso con esta clave de idempotencia.',
    });
    return;
  }

  captureResponse(res, ownerKey, idempotencyKey);
  next();
};

const captureResponse = (
  res: Response,
  ownerKey: string,
  idempotencyKey: string
): void => {
  const originalJson = res.json.bind(res);
  let capturedBody: unknown = null;

  res.json = (body?: any): Response => {
    capturedBody = body;
    return originalJson(body);
  };

  let settled = false;
  const finalize = (success: boolean): void => {
    if (settled) return;
    settled = true;
    if (success) {
      completeIdempotentRequest(ownerKey, idempotencyKey, {
        code: res.statusCode,
        body: capturedBody,
      }).catch(() => {});
    } else {
      failIdempotentRequest(ownerKey, idempotencyKey).catch(() => {});
    }
  };

  res.on('finish', () => finalize(res.statusCode >= 200 && res.statusCode < 300));
  res.on('close', () => finalize(false));
};
