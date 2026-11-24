import { AppError, translateDbError } from './AppError';

export { translateDbError };

export function withDbErrorTranslation<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw translateDbError(error) ?? error;
    }
  }) as T;
}
