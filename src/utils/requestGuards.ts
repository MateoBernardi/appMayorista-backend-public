import { Request } from 'express';
import { BadRequestError, UnauthorizedError } from '../adapters/errors/AppError';

export function requireUserContextId(req: Request): number {
  const userContextId = req.user?.userContextId;
  if (!userContextId) {
    throw new UnauthorizedError('No autorizado.');
  }
  return userContextId;
}

export function requireUserRole(req: Request): string {
  const role = req.user?.role;
  if (!role) {
    throw new UnauthorizedError('No autorizado.');
  }
  return role;
}

export function requireIdParam(req: Request, nombre: string): number {
  const valor = Number(req.params[nombre]);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new BadRequestError(`El identificador ${nombre} no es válido.`);
  }
  return valor;
}
