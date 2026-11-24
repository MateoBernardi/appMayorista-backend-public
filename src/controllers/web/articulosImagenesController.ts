import { addImageToArticulo, removeImageFromArticulo, fetchArticulosByImageId, fetchImagesByArticuloId, changeImageOrderForArticulo } from "../../domain/services/web/articulosImagenesServices";
import { Request, Response, NextFunction } from "express";
import { asAppError, NotFoundError } from "../../adapters/errors/AppError";

export const linkImageToArticulo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { articulo_id, image_id, orden } = req.body;
        if (!articulo_id || !image_id) {
            throw new NotFoundError("Artículo o imagen desconocidos");
        }
        const result = await addImageToArticulo(articulo_id, image_id, orden);
        res.status(201).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo hacer la asociación de imagen"));
    }
}

export const unlinkImageFromArticulo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { articulo_id, image_id, orden } = req.params;
        if (!articulo_id || !image_id) {
            throw new NotFoundError("Artículo o imagen desconocidos");
        }
        const result = await removeImageFromArticulo(Number(articulo_id), Number(image_id), Number(orden));
        if (!result) {
            throw new NotFoundError("Enlace no encontrado o ya eliminado");
        }
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo eliminar la asociación de imagen"));
    }
}

export const getArticulosByImageId = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { image_id } = req.params;
        if (!image_id) {
            throw new NotFoundError("Imagen desconocida");
        }
        const result = await fetchArticulosByImageId(Number(image_id));
        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo obtener los artículos por imagen"));
    }
}

export const getImagesByArticuloId = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { articulo_id } = req.params;
        if (!articulo_id) {
            throw new NotFoundError("Artículo desconocido");
        }
        const result = await fetchImagesByArticuloId(Number(articulo_id));
        res.status(200).json(result);
    }
    catch (error) {
        next(asAppError(error, "No se pudo obtener las imágenes por artículo"));
    }
}

export const updateImageOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {

        const { articulo_id, image_id } = req.params;
        const { newOrder } = req.body;

        if (!articulo_id || !image_id || newOrder === undefined) {
            throw new NotFoundError("Artículo, imagen y nuevo orden son requeridos");
        }

        const result = await changeImageOrderForArticulo(Number(articulo_id), Number(image_id), Number(newOrder));

        if (!result) {
            throw new NotFoundError("Enlace no encontrado o ya eliminado");
        }

        res.status(200).json(result);
    } catch (error) {
        next(asAppError(error, "No se pudo actualizar el orden de la imagen"));
    }
}