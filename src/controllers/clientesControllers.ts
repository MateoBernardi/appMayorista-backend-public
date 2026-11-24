import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import os from 'os';
import fsPromises from 'fs/promises';
import { fetchClientes, getClientesVisitadosHoy, fetchZonasDisponibles, searchClientesService } from '../domain/services/clientesServices';
import { NewCliente, updateClienteFields, removeCliente, importClientesService } from '../domain/services/clientesServices';
import { procesarArchivoClientes } from '../adapters/inputs_outputs/procesarClientesCSV';
import { asAppError } from '../adapters/errors/AppError';
import { BadRequestError, ConflictError, NotFoundError } from '../adapters/errors/AppError';

const upload = multer({ dest: os.tmpdir() });

export const getClientes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zona = req.params.zona as string;
    if (!zona || zona.trim().length === 0) {
      throw new BadRequestError("Zona inválida");
    }
    const clientes = await fetchClientes(zona);
    res.json(clientes);
  } catch (error) {
    next(asAppError(error, "No se pudo obtener la lista de clientes"));
  }
};

export const searchClientesController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { query } = req.query as { query?: string };
    if (!query || query.trim().length === 0) {
      throw new BadRequestError("Parámetro de búsqueda 'query' inválido");
    }
    const clientes = await searchClientesService(query);
    res.json(clientes);
  } catch (error) {
    next(asAppError(error, "No se pudieron buscar clientes"));
  }
};

export const createCliente = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clienteData = req.body;
    if (!clienteData || Object.keys(clienteData).length === 0) {
      throw new BadRequestError("Datos del cliente requeridos");
    }
    const newClienteId = await NewCliente(clienteData);
    res.status(201).json({ id_cliente: newClienteId, message: "Cliente creado exitosamente" });
  } catch (error: any) {
    if (error.code === '23505') {
      next(new ConflictError('Ya existe un cliente con ese CUIT'));
    } else {
      next(asAppError(error, "No se pudo crear cliente"));
    }
  }
};

export const updateCliente = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const clienteData = req.body;
    if (!id || !clienteData || Object.keys(clienteData).length === 0) {
      throw new BadRequestError("Cliente desconocido");
    }
    const updatedCliente = await updateClienteFields(Number(id), clienteData);
    res.json(updatedCliente);
  } catch (error) {
    next(asAppError(error, "No se pudo actualizar cliente"));
  }
};

export const deleteCliente = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new BadRequestError("Cliente desconocido");
    }
    const deletedCliente = await removeCliente(Number(id));
    if (!deletedCliente) {
      throw new NotFoundError("Cliente no encontrado");
    }
    res.json(deletedCliente);
  } catch (error) {
    next(asAppError(error, "No se pudo eliminar cliente"));
  }
};

export const clientesVisitadosHoyController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zona = req.params.zona as string;
    if (!zona || zona.trim().length === 0) {
      throw new BadRequestError("Zona inválida");
    }
    const clientes = await getClientesVisitadosHoy(zona);
    res.json(clientes);
  } catch (error) {
    next(asAppError(error, "No se pudo obtener la lista de clientes visitados hoy"));
  }
};

export const getZonasDisponiblesController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zonas = await fetchZonasDisponibles();
    res.json(zonas);
  } catch (error) {
    next(asAppError(error, "No se pudieron obtener las zonas disponibles"));
  }
};

export const importClientesController = [
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.file) {
      next(new BadRequestError('No se recibió ningún archivo.'));
      return;
    }

    const filePath = req.file.path;

    try {
      const clientes = await procesarArchivoClientes(filePath);
      const totalInsertados = await importClientesService(clientes);
      res.status(201).json({
        success: true,
        message: 'Archivo procesado e insertado correctamente',
        totalInsertados
      });
    } catch (error: any) {
      if (error.code === '23505') {
        next(new ConflictError('Ya existe un cliente con ese CUIT o email'));
      } else {
        next(asAppError(error, 'No se pudo procesar el archivo'));
      }
    } finally {
      try {
        await fsPromises.unlink(filePath);
      } catch (cleanupError) {
        console.warn('Error al eliminar el archivo subido:', filePath, cleanupError);
      }
    }
  }
];
