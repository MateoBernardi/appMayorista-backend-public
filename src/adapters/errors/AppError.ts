export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Solicitud inválida.', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado.', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tenés permisos para realizar esta acción.', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado.', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicto con el estado actual del recurso.', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class PreconditionFailedError extends AppError {
  constructor(message = 'No se cumple una condición previa de la solicitud.', details?: unknown) {
    super(message, 412, 'PRECONDITION_FAILED', details);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = 'No se puede procesar la solicitud.', details?: unknown) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', details);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Error interno del servidor.', details?: unknown) {
    super(message, 500, 'INTERNAL_SERVER_ERROR', details);
  }
}

interface PgErrorLike {
  code?: string;
  detail?: string;
}

function isPgErrorLike(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export function translateDbError(error: unknown): AppError | null {
  if (!isPgErrorLike(error)) {
    return null;
  }

  switch (error.code) {
    case '23502':
      console.error('[DB constraint error] not_null_violation', error);
      return new BadRequestError('Faltan datos obligatorios para completar la operación.');

    case '23503': {
      console.error('[DB constraint error] foreign_key_violation', error);
      if (error.detail && /is still referenced from table/.test(error.detail)) {
        return new ConflictError('No se puede completar la operación porque existen datos relacionados.');
      }
      if (error.detail && /is not present in table/.test(error.detail)) {
        return new BadRequestError('Uno de los datos ingresados hace referencia a un registro que no existe.');
      }
      return new BadRequestError('La referencia indicada no es válida.');
    }

    case '23505':
      console.error('[DB constraint error] unique_violation', error);
      return new ConflictError('Ya existe un registro con esos datos.');

    default:
      return null;
  }
}

export function asAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const translated = translateDbError(error);
  if (translated) return translated;
  // The generic 500 hides the cause from the client, so it has to be logged here.
  console.error('[unhandled error]', fallbackMessage, error);
  return new InternalServerError(fallbackMessage);
}
