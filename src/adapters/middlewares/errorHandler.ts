import { NextFunction, Request, Response } from 'express';
import { AppError, translateDbError } from '../errors/AppError';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  const appError = err instanceof AppError ? err : translateDbError(err);

  if (appError) {
    res.status(appError.statusCode).json({
      error: appError.message,
      message: appError.message,
      code: appError.code,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    });
    return;
  }

  const error = err instanceof Error ? err : new Error('Error interno del servidor.');
  console.error('[error]', {
    message: error.message,
    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
  });

  res.status(500).json({
    error: 'Error interno del servidor.',
    message: 'Error interno del servidor.',
    code: 'INTERNAL_SERVER_ERROR',
  });
}
