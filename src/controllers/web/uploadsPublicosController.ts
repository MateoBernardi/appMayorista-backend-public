import { NextFunction, Request, Response } from 'express';
import { asAppError } from '../../adapters/errors/AppError';
import { confirmarCvPublico, prepararSubidaCv } from '../../domain/services/uploadsPublicosServices';

const FALLBACK = 'No pudimos recibir tu CV en este momento. Intentá de nuevo más tarde.';

/**
 * POST /public/cvs/upload-url (sin auth). Body JSON { nombre, contentType, size, website }.
 * Devuelve una URL firmada para subir el CV directo a R2 (PUT) y un token para confirmar.
 * Cualquier otro campo del body (id_carpeta, roles, etc.) se ignora.
 */
export const createCvUploadUrlController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Honeypot: el campo "website" está oculto en el formulario; si viene con
    // contenido es un bot. Respondemos como si hubiera salido bien y no firmamos nada.
    const honeypot = req.body?.website;
    if (typeof honeypot === 'string' ? honeypot.trim() !== '' : honeypot != null) {
      res.status(201).json({ ok: true });
      return;
    }

    const { nombre, contentType, size } = req.body ?? {};
    const subida = await prepararSubidaCv({ nombre, contentType, size });
    res.status(201).json(subida);
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};

/**
 * POST /public/cvs (sin auth). Body JSON { token }: confirma un CV ya subido a R2.
 * No devuelve ids ni rutas.
 */
export const createCvPublicoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await confirmarCvPublico(req.body?.token);
    res.status(201).json({ ok: true });
  } catch (e) {
    next(asAppError(e, FALLBACK));
  }
};
