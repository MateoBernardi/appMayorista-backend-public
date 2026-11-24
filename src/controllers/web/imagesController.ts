import { fetchImagesBySection, fetchImageSections, fetchImagesWithRelationsBySection, removeImageById, prepararSubidaMedia, confirmarSubidaMedia, fetchDrafts, saveDraft, discardAllDrafts, discardDraft, publishAllDrafts, fetchPreviewImagesBySection, fetchGallery } from "../../domain/services/web/imagesServices";
import { Request, Response, NextFunction } from "express";
import { asAppError, BadRequestError } from "../../adapters/errors/AppError";

export const getImagesBySection = async (req: Request, res: Response, next: NextFunction) => {
  const section = req.query.section;
  if (typeof section !== "string") {
    return next(new BadRequestError("Sección requerida"));
  }
  try {
    const images = await fetchImagesBySection(section);
    res.status(200).json(images);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un error inesperado. Por favor intentá nuevamente más tarde.'));
  }
};

export const getImageSections = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sections = await fetchImageSections();
    res.status(200).json(sections);
  } catch (error) {
    next(asAppError(error, 'Ocurrió un error inesperado. Por favor intentá nuevamente más tarde.'));
  }
};

export const getImagesWithRelations = async (req: Request, res: Response, next: NextFunction) => {
  const section = req.query.section;
  if (typeof section !== "string") {
    return next(new BadRequestError("Sección requerida"));
  }
  try {
    const images = await fetchImagesWithRelationsBySection(section);
    res.status(200).json(images);
  } catch (error) {
    next(asAppError(error, 'No se pudo obtener las imágenes con relaciones'));
  }
};

export const deleteImageById = async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id;
  if (!Number(id)) {
    return next(new BadRequestError("Imagen desconocida."));
  }
  try {
    await removeImageById(Number(id));
    res.status(200).json({ message: "Imagen eliminada correctamente." });
  } catch (error) {
    next(asAppError(error, 'No se pudo eliminar la imagen'));
  }
};

/**
 * POST /imagenes/upload-url — body JSON { nombre, contentType, size }.
 * Devuelve dónde subir el archivo directo a Cloudflare ({ mediaType, method, uploadUrl, token }).
 */
export const createMediaUploadUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, contentType, size } = req.body ?? {};
    const subida = await prepararSubidaMedia({ nombre, contentType, size });
    res.status(201).json(subida);
  } catch (error) {
    next(asAppError(error, 'No se pudo preparar la subida'));
  }
};

/**
 * POST /imagenes — body JSON { token, section, description, articleId?, orden?, width?, height? }.
 * Registra una imagen/video ya subido a Cloudflare con el token de /imagenes/upload-url.
 */
export const uploadImage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, section, description, articleId, orden, width, height } = req.body ?? {};

    if (typeof section !== 'string' || !section.trim()) {
      throw new BadRequestError("Sección requerida.");
    }

    if (typeof description !== 'string' || !description.trim()) {
      throw new BadRequestError("Descripción requerida.");
    }

    const result = await confirmarSubidaMedia({
      token,
      section: section.trim(),
      description: description.trim(),
      articleId: articleId ? String(articleId).trim() : undefined,
      orden: orden ? parseInt(String(orden)) : undefined,
      width,
      height,
    });

    res.status(201).json({
      message: "Imagen subida correctamente",
      data: {
        image: result.image,
        articleLink: result.articleLink,
        cloudflare: {
          id: result.cloudflareData.id,
          url: result.cloudflareData.url
        }
      }
    });

  } catch (error) {
    next(asAppError(error, 'No se pudo subir la imagen'));
  }
};

// ───────────── Borradores / preview / galería ─────────────

const GENERIC_ERROR = 'Ocurrió un error inesperado. Por favor intentá nuevamente más tarde.';

export const getDrafts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await fetchDrafts());
  } catch (error) {
    next(asAppError(error, GENERIC_ERROR));
  }
};

export const putDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { section, description, image_id } = req.body ?? {};
    if (typeof section !== 'string' || !section.trim()) {
      throw new BadRequestError('Sección requerida.');
    }
    if (typeof description !== 'string' || !description.trim()) {
      throw new BadRequestError('Descripción requerida.');
    }
    let imageId: number | null = null;
    if (image_id !== null && image_id !== undefined) {
      imageId = Number(image_id);
      if (!Number.isInteger(imageId) || imageId <= 0) {
        throw new BadRequestError('Imagen inválida.');
      }
    }
    const draft = await saveDraft({
      section: section.trim(),
      description: description.trim(),
      image_id: imageId,
      updated_by: req.user?.userId ?? null,
    });
    res.status(200).json(draft);
  } catch (error) {
    next(asAppError(error, 'No se pudo guardar el borrador'));
  }
};

export const deleteDrafts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await discardAllDrafts());
  } catch (error) {
    next(asAppError(error, 'No se pudieron descartar los borradores'));
  }
};

export const deleteDraftByIdController = async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return next(new BadRequestError('Borrador desconocido.'));
  }
  try {
    await discardDraft(id);
    res.status(200).json({ message: 'Borrador descartado correctamente.' });
  } catch (error) {
    next(asAppError(error, 'No se pudo descartar el borrador'));
  }
};

export const publishDraftsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await publishAllDrafts());
  } catch (error) {
    next(asAppError(error, 'No se pudieron publicar los cambios'));
  }
};

export const getPreviewImages = async (req: Request, res: Response, next: NextFunction) => {
  const section = req.query.section;
  if (typeof section !== 'string' || !section) {
    return next(new BadRequestError('Sección requerida'));
  }
  try {
    res.status(200).json(await fetchPreviewImagesBySection(section));
  } catch (error) {
    next(asAppError(error, GENERIC_ERROR));
  }
};

export const getGallery = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await fetchGallery());
  } catch (error) {
    next(asAppError(error, 'No se pudo obtener la galería'));
  }
};
