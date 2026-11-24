import * as archivosServices from "../domain/services/archivosServices";
import { NextFunction, Request, Response } from "express";
import { ArchivoDTO, ArchivoUso, CrearArchivoDTO, UpdateArchivoDTO } from "../domain/dto/ArchivoDTO";
import { asAppError, BadRequestError } from "../adapters/errors/AppError";
import multer from "multer";
import { generateUploadUrl } from "../adapters/archivos/archivosApi";
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { getCarpetaNombreById } from '../domain/services/carpetasServices';
import { requireIdParam, requireUserContextId, requireUserRole } from '../utils/requestGuards';

// Middleware más flexible que acepta campos comunes
export const uploadArchivoMiddleware = (req: Request, res: Response, next: any) => {
  // Crear un middleware temporal que acepta múltiples nombres de campo posibles
  const uploadAny = multer({ storage: multer.memoryStorage() }).any();

  uploadAny(req, res, (err) => {
    if (err) {
      return next(err);
    }

    const filesInfo = req.files && Array.isArray(req.files)
      ? req.files.map((f: any) => ({ fieldname: f.fieldname, originalname: f.originalname }))
      : 'Ninguno';

    // Buscar el archivo en cualquiera de los campos comunes
    const file = req.files && Array.isArray(req.files)
      ? req.files.find((f: any) => f.fieldname === 'archivo' || f.fieldname === 'file' || f.fieldname === 'archivo_file')
      : null;

    if (file) {
      // Asignar el archivo encontrado a req.file para compatibilidad
      req.file = file;
      return next();
    }

    // Si no se encontró ningún archivo en campos conocidos, devolver error descriptivo
    const receivedFields = req.files && Array.isArray(req.files)
      ? req.files.map((f: any) => f.fieldname)
      : [];
    return res.status(400).json({
      message: 'Archivo no encontrado. Asegúrese de enviar el archivo en uno de estos campos:',
      receivedFields,
    });
  });
};

const parseNumberArray = (value: any): number[] => {
  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(v => Number(v)).filter(v => !isNaN(v));
      }
      return [];
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.map(v => Number(v)).filter(v => !isNaN(v));
  }

  return [];
};

const parseStringArray = (value: any): string[] => {
  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
      return [String(value).trim()].filter(Boolean);
    } catch {
      return [String(value).trim()].filter(Boolean);
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return [];
};

const getCarpetaNombreFromBody = (body: any): string | undefined => {
  if (!body || typeof body !== 'object') return undefined;

  const carpetaNombreCandidates = [
    body.nombre_carpeta,
    body.carpeta_nombre,
    body.carpetaName,
    body.nombreCarpeta,
    body.carpeta?.nombre,
  ];

  const carpetaNombre = carpetaNombreCandidates.find(
    (value) => typeof value === 'string' && value.trim().length > 0
  );

  return typeof carpetaNombre === 'string' ? carpetaNombre.trim() : undefined;
};


export const getArchivosController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userRole = requireUserRole(req);
    const userContextId = requireUserContextId(req);

    const archivos: ArchivoDTO[] = await archivosServices.fetchArchivos(userRole, userContextId);

    if (!archivos) {
      res.status(404).json({ message: 'No se encontraron archivos.' });
      return;
    }

    res.status(200).json(archivos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getArchivosUnseenByUserController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);

    const unseenCount = await archivosServices.fetchArchivosUnseenByUserService(userContextId, userRole);

    res.status(200).json({ unseenCount: unseenCount });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getArchivosPersonalesController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);

    const archivos: ArchivoDTO[] = await archivosServices.fetchArchivosPersonales(userContextId);

    if (!archivos) {
      res.status(404).json({ message: 'No se encontraron archivos.' });
      return;
    }

    res.status(200).json(archivos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const searchArchivosByPersonaController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const searchTerm = req.query.search as string;

    if (!searchTerm || searchTerm.trim().length < 2) {
      res.status(400).json({ message: 'Término de búsqueda requerido (mínimo 2 caracteres).' });
      return;
    }

    const userRole = requireUserRole(req);
    const userContextId = requireUserContextId(req);

    const archivos = await archivosServices.searchArchivosByPersonaService(searchTerm.trim(), userRole, userContextId);

    if (!archivos) {
      res.status(404).json({ message: 'No se encontraron archivos para el término de búsqueda.' });
      return;
    }

    res.status(200).json(archivos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const createArchivoController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const created_by = requireUserContextId(req);
    const userRole = requireUserRole(req);

    if (!req.file) {
      res.status(404).json({ message: 'Archivo no encontrado.' });
      return;
    }

    const {
      nombre,
      titulo,
      usuarios_asociados,
      usuarios_compartidos,
      allowed_roles,
      uso
    } = req.body;

    const id_carpeta = req.body.id_carpeta ? Number(req.body.id_carpeta) : null;

    const asociados = parseNumberArray(usuarios_asociados);
    const compartidos = parseNumberArray(usuarios_compartidos);

    // Validar uso si viene, default EMPRESA
    const archivoUso: ArchivoUso = uso && Object.values(ArchivoUso).includes(uso)
      ? uso
      : ArchivoUso.EMPRESA;

    let roles: string[] = [];
    if (allowed_roles) {
      try {
        roles = Array.isArray(allowed_roles)
          ? allowed_roles
          : JSON.parse(allowed_roles);
      } catch {
        roles = [allowed_roles];
      }
    }

    const { buffer, mimetype, size, originalname } = req.file;
    const ruta = `${Date.now()}-${originalname}`;

    const archivoData: CrearArchivoDTO = {
      nombre: nombre || originalname,
      ruta_r2: ruta,
      id_carpeta,
      tipo: mimetype,
      tamaño: size,
      titulo: titulo,
      created_by,
      allowed_roles: roles,
      uso: archivoUso,
      usuarios_asociados: asociados,
      usuarios_compartidos: compartidos
    };

    const result = await archivosServices.addArchivo(archivoData, userRole, buffer);
    if (result.warnings) {
      res.status(207).json(result);
      return;
    }

    res.status(201).json({ archivo: result.archivo });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};


export const createArchivoMetadataController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const created_by = requireUserContextId(req);
    const userRole = requireUserRole(req);

    const id_carpeta = req.body.id_carpeta ? Number(req.body.id_carpeta) : null;
    const {
      nombre,
      ruta_r2,
      tamaño,
      titulo,
      tipo,
      allowed_roles,
      usuarios_asociados,
      usuarios_compartidos,
      uso
    } = req.body;

    // Validar uso si viene, default EMPRESA
    const archivoUso: ArchivoUso = uso && Object.values(ArchivoUso).includes(uso)
      ? uso
      : ArchivoUso.EMPRESA;

    const result = await archivosServices.addArchivo({
      nombre,
      ruta_r2,
      id_carpeta,
      tamaño,
      titulo,
      tipo,
      created_by,
      allowed_roles,
      uso: archivoUso,
      usuarios_asociados,
      usuarios_compartidos
    }, userRole);

    if (result.warnings) {
      res.status(207).json(result);
    } else {
      res.status(201).json(result.archivo);
    }

    // Usamos los permisos realmente persistidos (result.resolvedPermisos), no los
    // del request: si el archivo se creó dentro de una carpeta, sus allowed_roles/
    // usuarios_compartidos se sobrescriben con los de esa carpeta dentro de
    // addArchivo, y el request original (que puede no llevar estos campos, como
    // hace la app móvil) ya no refleja a quién hay que notificar.
    const usuariosNotificables = await archivosServices.resolveArchivoRecipientsToNotify(
      result.resolvedPermisos.allowed_roles,
      result.resolvedPermisos.usuarios_compartidos,
      result.warnings?.invalid_user_ids ?? [],
      result.archivo.id,
      false
    );
    const carpetaNombre = getCarpetaNombreFromBody(req.body);
    const notificationBody = carpetaNombre
      ? `"${result.archivo.nombre}" ha sido compartido contigo en la carpeta "${carpetaNombre}."`
      : `"${result.archivo.nombre}" ha sido compartido contigo.`;

    if (usuariosNotificables.length > 0) {
      sendNotificationToMultipleUsers(usuariosNotificables, {
        title: 'Un nuevo archivo ha sido compartido contigo',
        body: notificationBody,
        link: 'https://interno.italoarg.com.ar/documentos',
        data: {
          type: 'nuevo_archivo',
          archivo_id: result.archivo.id,
          ...(carpetaNombre ? { carpeta_nombre: carpetaNombre } : {}),
          domain: 'documentos',
          event: 'created',
          updated_at: new Date().toISOString(),
          entity_id: String(result.archivo.id)
        }
      }).catch(err => console.error('Error enviando notificación de archivo compartido:', err));
    }
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};


export const getArchivoUrlController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string ?? "0", 10);
    const expiresIn = req.query.expiresIn ? parseInt(req.query.expiresIn as string, 10) : 3600;

    if (!id || isNaN(id)) {
      res.status(400).json({ message: 'Archivo desconocido' });
      return;
    }

    const userContextId = requireUserContextId(req);

    const result = await archivosServices.getArchivoUrl(id, expiresIn);

    await archivosServices.markFileAsReadService(userContextId, id);

    res.status(200).json({
      archivo: result.archivo,
      url: result.url,
    });

  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const updateArchivoController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);
    const id = requireIdParam(req, 'id');

    const body = req.body || {};
    const nombre = body.nombre;
    const titulo = body.titulo;
    const usuarios_asociados = body.usuarios_asociados;
    const usuarios_compartidos = body.usuarios_compartidos;
    const allowed_roles = body.allowed_roles;
    if (!req.body) {
      res.status(400).json({ message: 'Faltan datos requeridos. Revisá los campos obligatorios del archivo.' });
      return;
    }

    const archivoData: UpdateArchivoDTO = {
      nombre: nombre,
      titulo: titulo,
      usuarios_asociados: parseNumberArray(usuarios_asociados),
      usuarios_compartidos: parseNumberArray(usuarios_compartidos),
      allowed_roles: parseStringArray(allowed_roles),
    };

    const actualizaPermisos = allowed_roles !== undefined || usuarios_compartidos !== undefined;
    const usuariosNotificables = actualizaPermisos
      ? await archivosServices.resolveArchivoRecipientsToNotify(
        archivoData.allowed_roles ?? [],
        archivoData.usuarios_compartidos ?? [],
        [],
        id,
        true
      )
      : [];

    const result = await archivosServices.modifyArchivo(userContextId, id, archivoData, userRole);

    if (result.warnings) {
      res.status(200).json(result);
    } else {
      res.status(200).json(result.archivo);
    }

    if (usuariosNotificables.length > 0) {
      sendNotificationToMultipleUsers(usuariosNotificables, {
        title: 'Un archivo ha sido compartido contigo',
        body: `"${result.archivo.nombre}" ha sido compartido contigo.`,
        link: 'https://interno.italoarg.com.ar/documentos',
        data: {
          type: 'archivo_actualizado',
          archivo_id: id,
          domain: 'documentos',
          event: 'updated',
          updated_at: new Date().toISOString(),
          entity_id: String(id)
        }
      }).catch(err => console.error('Error enviando notificación de archivo actualizado:', err));
    }
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};


export const deleteArchivoController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string || "0", 10);
    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);

    if (!id || id <= 0 || id === 0) {
      res.status(404).json({ message: 'Archivo no encontrado.' });
      return;
    }

    const result = await archivosServices.removeArchivo(id, userContextId);

    if (!result) {
      res.status(404).json({ message: 'Archivo no encontrado.' });
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const searchArchivoByNombreController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const nombre = req.query.nombre as string;

    if (!nombre || nombre.trim().length < 1) {
      res.status(400).json({ message: 'El parámetro "nombre" es requerido (mínimo 2 caracteres)' });
      return;
    }

    const userRole = requireUserRole(req);
    const userContextId = requireUserContextId(req);

    const archivos = await archivosServices.searchArchivoByNombre(nombre.trim(), userRole, userContextId);
    if (!archivos) {
      res.status(404).json({ message: 'Archivo no encontrado.' });
      return;
    }

    res.status(200).json(archivos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getArchivosByIdAsociadoController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idUsuarioAsociado = parseInt(req.params.idUsuario as string ?? "0", 10);

    if (isNaN(idUsuarioAsociado)) {
      res.status(400).json({ message: 'Usuario no encontrado.' });
      return;
    }

    const userRole = requireUserRole(req);
    const userContextId = requireUserContextId(req);

    const archivos = await archivosServices.fetchArchivosByIdAsociado(idUsuarioAsociado, userRole, userContextId);
    res.status(200).json(archivos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export async function getUploadUrlController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserContextId(req);

    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ message: 'Se requiere una lista de archivos (array).' });
      return;
    }

    const timestamp = Date.now();

    const promesasDeUrls = files.map(async (file, index) => {
      const { fileName, contentType } = file;

      if (!fileName || !contentType) {
        throw new BadRequestError(`Faltan campos (fileName o contentType) para el archivo en la posición ${index}.`);
      }

      if (!fileName || !contentType) {
        res.status(400).json({ message: 'Faltan campos que son requeridos.' });
        return;
      }

      const ruta_r2 = `uploads/${userId}/${timestamp}-${index}-${fileName}`;

      const uploadUrl = await generateUploadUrl(ruta_r2, 300, contentType);

      return {
        uploadUrl,
        ruta_r2,
        fileName,
      };
    });

    // 3. Esperamos a que todas las URLs se generen
    const resultados = await Promise.all(promesasDeUrls);

    // 4. Devolvemos el array con todas las URLs y rutas
    res.status(200).json({
      urls: resultados,
    });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
}

export const moveArchivoController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idCarpetaRaw = req.body?.id_carpeta;

    let idCarpetaDestino: number | null;
    if (idCarpetaRaw === undefined) {
      res.status(400).json({ message: 'id_carpeta es obligatorio.' });
      return;
    }

    if (idCarpetaRaw === null) {
      idCarpetaDestino = null;
    } else {
      const parsedIdCarpeta = Number(idCarpetaRaw);
      if (!Number.isInteger(parsedIdCarpeta) || parsedIdCarpeta <= 0) {
        res.status(400).json({ message: 'id_carpeta inválido.' });
        return;
      }
      idCarpetaDestino = parsedIdCarpeta;
    }

    const userContextId = requireUserContextId(req);
    const userRole = requireUserRole(req);
    const id = requireIdParam(req, 'id');

    const result = await archivosServices.moveArchivo(id, idCarpetaDestino, userContextId, userRole);
    if (result.warnings) {
      res.status(207).json(result);
      return;
    }

    res.status(200).json(result.archivo);

    // Enviar notificación en segundo plano (fire-and-forget)
    Promise.resolve()
      .then(async () => {
        const destinatarios = await archivosServices.resolveArchivoNotificationRecipients(id, userContextId);
        if (destinatarios.length === 0) {
          return;
        }

        const carpetaNombre = await getCarpetaNombreById(idCarpetaDestino);
        return sendNotificationToMultipleUsers(destinatarios, {
          title: 'Archivo Movido',
          body: `El archivo "${result.archivo.nombre}" fue movido a ${carpetaNombre}`,
          link: 'https://interno.italoarg.com.ar/documentos',
          data: {
            type: 'archivo_movido',
            archivo_id: id,
            carpeta_nombre: carpetaNombre,
            domain: 'documentos',
            event: 'updated',
            updated_at: new Date().toISOString(),
            entity_id: String(id)
          }
        });
      })
      .catch((err) => console.error('Error enviando notificación de archivo movido:', err));
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getArchivoPermisosController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const id = requireIdParam(req, 'id');

    const permisos = await archivosServices.getArchivoPermisos(id, userContextId);
    res.status(200).json(permisos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const patchArchivoPermisosController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);
    const id = requireIdParam(req, 'id');

    const allowed_roles = req.body?.allowed_roles !== undefined
      ? parseStringArray(req.body.allowed_roles)
      : undefined;
    const ids = req.body?.ids !== undefined
      ? parseNumberArray(req.body.ids)
      : undefined;

    if (allowed_roles === undefined && ids === undefined) {
      res.status(400).json({ message: 'Debés enviar allowed_roles o ids para remover permisos.' });
      return;
    }

    if ((allowed_roles?.length ?? 0) === 0 && (ids?.length ?? 0) === 0) {
      res.status(400).json({ message: 'Debés enviar al menos un rol o usuario para remover permisos.' });
      return;
    }

    const payload: { allowed_roles?: string[]; ids?: number[] } = {};
    if (allowed_roles !== undefined) {
      payload.allowed_roles = allowed_roles;
    }
    if (ids !== undefined) {
      payload.ids = ids;
    }

    const permisos = await archivosServices.patchPermisosArchivo(id, payload, userContextId);
    res.status(200).json(permisos);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getArchivoViewersController = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userContextId = requireUserContextId(req);

    const archivoId = Number(req.body?.archivo_id);
    if (!Number.isInteger(archivoId) || archivoId <= 0) {
      res.status(400).json({ message: 'archivo_id inválido.' });
      return;
    }

    const viewers = await archivosServices.getArchivoViewersService(archivoId, userContextId);
    res.status(200).json(viewers);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

