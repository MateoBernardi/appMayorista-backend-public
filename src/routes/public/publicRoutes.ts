import { Router } from "express";
import { getImagesBySection, getImageSections, getImagesWithRelations } from "../../controllers/web/imagesController";
import { createSuscripcion } from "../../controllers/web/suscripcionesController";
import { getArticulosPublicController } from "../../controllers/web/articulosPublicController";
import { getArticulosPublicBySearch } from '../../controllers/articulosController';
import { getArticulosByImageId, getImagesByArticuloId } from "../../controllers/web/articulosImagenesController";
import { listNovedadesWebPublicasController } from "../../controllers/web/novedadesWebController";
import { createUserController } from "../../controllers/usuariosControllers";
import { cvConfirmLimiter, cvUploadLimiter, publicLimiter } from "../../adapters/middlewares/rateLimiter";
import { createCvPublicoController, createCvUploadUrlController } from "../../controllers/web/uploadsPublicosController";

const publicRouter = Router();
publicRouter.use(publicLimiter);

// GET routes
publicRouter.get('/images', getImagesBySection);
publicRouter.get('/sections', getImageSections);
publicRouter.get('/images-with-relations', getImagesWithRelations);
publicRouter.get('/articulos-publicos', getArticulosPublicController);
publicRouter.get('/novedades-web', listNovedadesWebPublicasController);
publicRouter.get('/articulos/:image_id', getArticulosByImageId);
publicRouter.get('/images/:articulo_id', getImagesByArticuloId);
// Búsqueda pública de artículos con imágenes y paginación
publicRouter.get('/articulos-publicos/search/:search', getArticulosPublicBySearch);

// POST routes 
publicRouter.post('/suscripciones', createSuscripcion);
publicRouter.post('/usuarios', createUserController);
// Subida pública de CVs: el archivo va directo a R2 con URL firmada; acá solo se firma y se confirma
publicRouter.post('/cvs/upload-url', cvUploadLimiter, createCvUploadUrlController);
publicRouter.post('/cvs', cvConfirmLimiter, createCvPublicoController);

export default publicRouter;