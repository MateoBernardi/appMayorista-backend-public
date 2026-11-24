import { Response } from 'express';
import { AppError } from './AppError';

export function handleError(res: Response, error: unknown, status: number, defaultMessage?: string) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
  } else {
    const message = defaultMessage || 'Ocurrió un error inesperado.';
    res.status(status).json({ error: message });
  }
}
