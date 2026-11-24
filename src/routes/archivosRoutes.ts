import { Router } from 'express';
import { getArchivosController, getArchivosPersonalesController, createArchivoController, updateArchivoController, deleteArchivoController, getArchivoUrlController, searchArchivosByPersonaController, searchArchivoByNombreController, getArchivosByIdAsociadoController, createArchivoMetadataController, getUploadUrlController, moveArchivoController, getArchivoPermisosController, patchArchivoPermisosController, getArchivoViewersController, getArchivosUnseenByUserController } from '../controllers/archivosControllers';
import { uploadArchivoMiddleware } from '../controllers/archivosControllers';
import { auth } from '../adapters/auth/authPermisos';
import { allRoles } from '../types/roles';
import { idempotency } from '../adapters/middlewares/idempotency';


const archivosRouter = Router();

// Obtener archivos (filtrados por rol del usuario autenticado)
archivosRouter.get('/', getArchivosController); // Ajusta roles según necesites
archivosRouter.get('/personales', getArchivosPersonalesController); // Archivos personales del usuario
archivosRouter.get('/unseen', auth(allRoles), getArchivosUnseenByUserController); // Obtener cantidad de archivos no vistos por el usuario

// Buscar archivos por persona
archivosRouter.get('/search', searchArchivosByPersonaController);
archivosRouter.get('/searchByNombre', searchArchivoByNombreController);
archivosRouter.get('/usuario/:idUsuario', getArchivosByIdAsociadoController);

// Crear/subir archivo
archivosRouter.post('/', auth(allRoles), idempotency, uploadArchivoMiddleware, createArchivoController);
archivosRouter.post('/metadata', auth(allRoles), idempotency, createArchivoMetadataController) //Para mobile
archivosRouter.post('/upload', auth(allRoles), getUploadUrlController); // Generar URL de subida directa a R2
archivosRouter.post('/viewers', auth(allRoles), getArchivoViewersController);

// Actualizar archivo
archivosRouter.put('/:id', auth(allRoles), updateArchivoController);
archivosRouter.post('/:id/mover', auth(allRoles), moveArchivoController);

// Obtener URL del archivo
archivosRouter.get('/:id/url', getArchivoUrlController);
archivosRouter.get('/:id/permisos', auth(allRoles), getArchivoPermisosController);
archivosRouter.patch('/:id/permisos', auth(allRoles), patchArchivoPermisosController);

// Eliminar archivo
archivosRouter.delete('/:id', auth(allRoles), deleteArchivoController);

export default archivosRouter;
