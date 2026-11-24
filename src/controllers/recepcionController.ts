import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import os from 'os';
import { procesarArticulosUploadService } from '../domain/services/articulosServices';
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import fsPromises from 'fs/promises';

const upload = multer({ dest: os.tmpdir() });

export const recepcionController = [
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.file) {
      next(new BadRequestError('No se recibió ningún archivo.'));
      return;
    }

    const url = req.path;
    const filePath = req.file.path;

    try {
      if (url === '/recepcion-excel') {
        const totalInsertados = await procesarArticulosUploadService(filePath);
        res.status(200).json({
          success: true,
          message: 'Archivo procesado e insertado correctamente',
          totalInsertados
        });
      } else {
        throw new NotFoundError('Ruta no soportada.');
      }
    } catch (error) {
      next(asAppError(error, 'No se pudo procesar el archivo'));
    } finally {
      try {
        await fsPromises.unlink(filePath);
      } catch (cleanupError) {
        console.warn('Error al eliminar el archivo subido:', filePath, cleanupError);
      }
    }
  }
];
