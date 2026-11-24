import { Router } from "express";
import {
    linkImageToReporte,
    unlinkImageFromReporte,
    getImagesByReporteId,
    updateImageOrder,
    uploadReporteImage,
    uploadMiddleware,
} from "../controllers/reportesImagenesController";
import { auth } from "../adapters/auth/authPermisos";
import { idempotency } from "../adapters/middlewares/idempotency";
import { supervisorRoles } from "../types/roles";

const reportesImagenesRouter = Router();

// POST - Subir imagen y vincularla al reporte (upload + link en un paso)
reportesImagenesRouter.post('/upload', auth(supervisorRoles), idempotency, uploadMiddleware, uploadReporteImage);

// POST - Vincular imagen existente a reporte
reportesImagenesRouter.post('/link', auth(supervisorRoles), linkImageToReporte);

// DELETE - Desvincular imagen de reporte
reportesImagenesRouter.delete('/unlink/:reporte_id/:image_id/:orden', auth(supervisorRoles), unlinkImageFromReporte);

// GET - Obtener imágenes de un reporte
reportesImagenesRouter.get('/:reporte_id', getImagesByReporteId);

// PUT - Actualizar orden de imagen en reporte
reportesImagenesRouter.put('/update-order/:reporte_id/:image_id', auth(supervisorRoles), updateImageOrder);

export default reportesImagenesRouter;
