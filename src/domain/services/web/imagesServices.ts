import { getBySection, getSections, getImagesWithRelationsBySection, deleteById, createImage, getImageById, listDrafts, upsertDraft, deleteAllDrafts, deleteDraftById, publishDrafts, getSetDraftImagesBySection, getDraftsBySection, getGalleryRows, getImageSlotUsage } from "../../../adapters/db/web/imagesRepo";
import { BadRequestError, ConflictError, NotFoundError } from "../../../adapters/errors/AppError";
import { linkImageToArticulo } from "../../../adapters/db/web/articulosImagenesRepo";
import { createCloudflareDirectUpload, getCloudflareImage, buildImageVariantUrl, BASE_VARIANT } from "../../../adapters/images/uploadImages";
import { buildVideoKey, buildVideoUrl, deleteVideo, generateVideoUploadUrl, headVideo } from "../../../adapters/images/uploadVideo";
import { signUploadToken, verifyUploadToken } from "../../validations/uploadTokens";

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm']);
// Cloudflare Images acepta hasta 10 MB por imagen.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const VIGENCIA_URL_SUBIDA_SEG = 10 * 60;

export const fetchImagesBySection = async (section: string) => {
  const images = await getBySection(section);
  return images;
}

export const fetchImageSections = async () => {
  const sections = await getSections();
  return sections;
}

export const fetchImagesWithRelationsBySection = async (section: string) => {
  const images = await getImagesWithRelationsBySection(section);
  return images;
}

export const removeImageById = async (id: number) => {
  const slots = await getImageSlotUsage(id);
  if (slots.length > 0) {
    throw new ConflictError('La imagen está en uso y no se puede eliminar.', { slots });
  }
  await deleteById(id);
}

// ───────────── Borradores ─────────────

export const fetchDrafts = async () => listDrafts();

export const saveDraft = async (params: {
  section: string;
  description: string;
  image_id: number | null;
  updated_by: number | null;
}) => {
  if (params.image_id !== null) {
    const image = await getImageById(params.image_id);
    if (!image) throw new NotFoundError('La imagen seleccionada no existe.');
  }
  return upsertDraft(params);
};

export const discardAllDrafts = async () => {
  const deleted = await deleteAllDrafts();
  return { deleted };
};

export const discardDraft = async (id: number) => {
  const deleted = await deleteDraftById(id);
  if (!deleted) throw new NotFoundError('Borrador no encontrado.');
};

export const publishAllDrafts = async () => publishDrafts();

/** Mismo shape que /public/images con los borradores aplicados. */
export const fetchPreviewImagesBySection = async (section: string) => {
  const [published, drafts, setImages] = await Promise.all([
    getBySection(section),
    getDraftsBySection(section),
    getSetDraftImagesBySection(section),
  ]);
  const wholeSection = drafts.some((d) => d.description === '*');
  const draftedDescriptions = new Set(drafts.map((d) => d.description));
  const kept = wholeSection ? [] : published.filter((r: any) => !draftedDescriptions.has(r.description));
  const overlay = setImages.map((r: any) => {
    const { slot_section, slot_description, ...image } = r;
    const description = slot_description === '*' ? (image.description?.trim() ? image.description : 'principal') : slot_description;
    return { ...image, section: slot_section, description, articulo_id: null, orden: null };
  });
  return [...overlay, ...kept];
};

export const fetchGallery = async () => {
  const rows = await getGalleryRows();
  return rows.map((r: any) => ({
    id: r.id,
    url: r.url,
    section: r.section,
    description: r.description,
    cf_image_id: r.cf_image_id,
    media_type: r.media_type,
    width: r.width ?? null,
    height: r.height ?? null,
    created_at: r.created_at,
    in_use: [...(r.published_slots ?? []), ...(r.draft_slots ?? [])],
  }));
};

export interface SolicitudSubidaMedia {
  nombre: unknown;
  contentType: unknown;
  size: unknown;
}

/**
 * Paso 1 de la subida de media del sitio: valida lo que declara el cliente y pide a
 * Cloudflare dónde subir. El archivo no pasa por este servidor.
 * - Imagen → URL de un solo uso de Cloudflare Images (el cliente hace POST multipart, campo "file").
 * - Video → URL firmada al bucket R2 público (el cliente hace PUT con ese Content-Type).
 */
export const prepararSubidaMedia = async (solicitud: SolicitudSubidaMedia) => {
  const { nombre, contentType, size } = solicitud;
  const mime = typeof contentType === 'string' ? contentType : '';
  const isVideo = VIDEO_MIME_TYPES.has(mime);

  if (!isVideo && !IMAGE_MIME_TYPES.has(mime)) {
    throw new BadRequestError("Tipo de archivo inválido. Solo se permiten imágenes (jpg, png, webp, gif, svg) o video (mp4, webm).");
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    throw new BadRequestError("No se subió ningún archivo. Por favor, proporcione un archivo.");
  }
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > max) {
    throw new BadRequestError(`El archivo no puede superar los ${max / (1024 * 1024)} MB.`);
  }

  if (isVideo) {
    const key = buildVideoKey(typeof nombre === 'string' && nombre ? nombre : 'video');
    const uploadUrl = await generateVideoUploadUrl(key, mime, size, VIGENCIA_URL_SUBIDA_SEG);
    return {
      mediaType: 'video' as const,
      method: 'PUT' as const,
      uploadUrl,
      token: signUploadToken({ tipo: 'video', key, contentType: mime }),
    };
  }

  const { id, uploadURL } = await createCloudflareDirectUpload({
    expiresInSeconds: VIGENCIA_URL_SUBIDA_SEG,
    metadata: { origen: 'insumosweb' },
  });
  return {
    mediaType: 'image' as const,
    method: 'POST' as const,
    uploadUrl: uploadURL,
    token: signUploadToken({ tipo: 'imagen', cfImageId: id }),
  };
};

export interface ConfirmarSubidaMediaParams {
  token: unknown;
  section: string;
  description: string;
  articleId?: string | undefined;
  orden?: number | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
}

const dimensionValida = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000 ? v : null;

/**
 * Paso 2: el archivo ya está en Cloudflare. Verifica que exista y lo registra en la
 * tabla images (y lo vincula al artículo si corresponde).
 * width/height los mide el navegador; solo se usan para avisar de baja resolución.
 */
export const confirmarSubidaMedia = async (params: ConfirmarSubidaMediaParams) => {
  const { token, section, description, articleId, orden } = params;
  const tipo = verifyUploadToken(token, ['imagen', 'video'] as const);

  let imageUrl: string;
  let cfImageId: string | null;
  let width: number | null = null;
  let height: number | null = null;

  if (tipo.tipo === 'video') {
    const video = await headVideo(tipo.key);
    if (!video) {
      throw new BadRequestError("No recibimos el archivo. Volvé a intentarlo.");
    }
    if (video.size <= 0 || video.size > MAX_VIDEO_BYTES) {
      await deleteVideo(tipo.key);
      throw new BadRequestError(`El archivo no puede superar los ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.`);
    }
    imageUrl = buildVideoUrl(tipo.key);
    cfImageId = null;
  } else {
    const imagen = await getCloudflareImage(tipo.cfImageId);
    if (!imagen || imagen.draft) {
      throw new BadRequestError("No recibimos el archivo. Volvé a intentarlo.");
    }
    cfImageId = imagen.id;
    // No usar result.variants[0]: el orden no está garantizado y suele ser una variante chica.
    imageUrl = buildImageVariantUrl(cfImageId, BASE_VARIANT);
    width = dimensionValida(params.width);
    height = dimensionValida(params.height);
  }

  // 2. Crear registro en la tabla images
  const imageRecord = await createImage({
    url: imageUrl,
    section,
    description,
    cf_image_id: cfImageId,
    media_type: tipo.tipo === 'video' ? 'video' : 'image',
    width,
    height
  });

  // 3. Crear relación con el artículo si se proporciona articleId
  let articuloImagenRecord = null;
  if (articleId) {
    // Si no se proporciona orden, calcularlo automáticamente
    let finalOrden = orden;
    if (!finalOrden) {
      // Obtener el próximo orden disponible para este artículo
      const { pool } = await import("../../../adapters/db/pgClient");
      const maxOrdenResult = await pool.query(
        `SELECT COALESCE(MAX(orden), 0) + 1 as next_orden 
         FROM articulo_imagen 
         WHERE articulo_id = $1 AND deleted_at IS NULL`,
        [articleId]
      );
      finalOrden = maxOrdenResult.rows[0].next_orden;
    }

    articuloImagenRecord = await linkImageToArticulo({
      articulo_id: parseInt(articleId),
      image_id: imageRecord.id,
      orden: finalOrden || 1
    });
  }

  return {
    image: imageRecord,
    articleLink: articuloImagenRecord,
    cloudflareData: {
      id: cfImageId,
      url: imageUrl
    }
  };
}

export const fetchImageById = async (id: number) => {
  return await getImageById(id);
}