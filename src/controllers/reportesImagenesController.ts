import {
    addImageToReporte,
    removeImageFromReporte,
    fetchImagesByReporteId,
    changeImageOrderForReporte,
    uploadImageWithReporteLink,
} from "../domain/services/reportesImagenesServices";
import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { asAppError, BadRequestError, NotFoundError } from "../adapters/errors/AppError";

// Multer en memoria para recibir el archivo
const upload = multer({ storage: multer.memoryStorage() });
export const uploadMiddleware = upload.single("file");

export const uploadReporteImage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.file) {
            throw new BadRequestError("No se subió ningún archivo.");
        }

        const { description, reporteId, orden } = req.body;

        if (!reporteId) {
            throw new BadRequestError("reporteId es requerido.");
        }

        if (!description) {
            throw new BadRequestError("description es requerida.");
        }

        if (!orden) {
            throw new BadRequestError("orden es requerido.");
        }

        if (!req.file.mimetype.startsWith("image/")) {
            throw new BadRequestError("Tipo de archivo inválido. Solo se permiten imágenes.");
        }

        const result = await uploadImageWithReporteLink({
            file: req.file.buffer,
            filename: req.file.originalname,
            description: description.trim(),
            reporteId: Number(reporteId),
            orden: Number(orden),
        });

        res.status(201).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo subir la imagen del reporte"));
    }
};

export const linkImageToReporte = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { reporte_id, image_id, orden } = req.body;
        if (!reporte_id || !image_id || orden === undefined) {
            throw new BadRequestError("reporte_id, image_id y orden son requeridos");
        }
        const result = await addImageToReporte(Number(reporte_id), Number(image_id), Number(orden));
        res.status(201).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo hacer la asociación de imagen al reporte"));
    }
};

export const unlinkImageFromReporte = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { reporte_id, image_id, orden } = req.params;
        if (!reporte_id || !image_id) {
            throw new BadRequestError("Reporte o imagen desconocidos");
        }
        const result = await removeImageFromReporte(Number(reporte_id), Number(image_id), Number(orden));
        if (!result) {
            throw new NotFoundError("Enlace no encontrado o ya eliminado");
        }
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo eliminar la asociación de imagen del reporte"));
    }
};

export const getImagesByReporteId = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { reporte_id } = req.params;
        if (!reporte_id) {
            throw new BadRequestError("Reporte desconocido");
        }
        const result = await fetchImagesByReporteId(Number(reporte_id));
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo obtener las imágenes del reporte"));
    }
};

export const updateImageOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { reporte_id, image_id } = req.params;
        const { newOrder } = req.body;

        if (!reporte_id || !image_id || newOrder === undefined) {
            throw new BadRequestError("Reporte, imagen y nuevo orden son requeridos");
        }

        const result = await changeImageOrderForReporte(Number(reporte_id), Number(image_id), Number(newOrder));

        if (!result) {
            throw new NotFoundError("Enlace no encontrado o ya eliminado");
        }

        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo actualizar el orden de la imagen"));
    }
};
