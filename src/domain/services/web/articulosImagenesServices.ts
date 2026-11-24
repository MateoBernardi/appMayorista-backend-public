import { linkImageToArticulo, unlinkImageFromArticulo, getArticulosByImageId, getImagesByArticuloId, updateImageOrderForArticulo, swapImageOrders } from "../../../adapters/db/web/articulosImagenesRepo";
import { buildImageVariantUrl, VISOR_VARIANT } from "../../../adapters/images/uploadImages";

export const addImageToArticulo = async (articulo_id: number, image_id: number, orden?: number) => {
    const dto: any = { articulo_id, image_id };
    if (orden !== undefined) {
        dto.orden = orden;
    }
    return await linkImageToArticulo(dto);
}

export const removeImageFromArticulo = async (articulo_id: number, image_id: number, orden: number) => {
    return await unlinkImageFromArticulo(articulo_id, image_id, orden);
}

export const fetchArticulosByImageId = async (image_id: number) => {
    return await getArticulosByImageId(image_id);
}

export const fetchImagesByArticuloId = async (articulo_id: number) => {
    const rows = await getImagesByArticuloId(articulo_id);
    return rows.map((row: any) => ({
        ...row,
        // Resolución fija para el visor de detalle de producto, independiente
        // de con qué resolución se haya subido la imagen originalmente.
        // Los videos (y filas sin cf_image_id) no pasan por Cloudflare Images,
        // así que se sirven con su url original.
        visorUrl: row.cf_image_id ? buildImageVariantUrl(row.cf_image_id, VISOR_VARIANT) : row.url,
    }));
}

export const changeImageOrderForArticulo = async (articulo_id: number, image_id: number, newOrder: number) => {
    try {
        // Intentar actualizar el orden directamente
        return await updateImageOrderForArticulo(articulo_id, image_id, newOrder);
    } catch (error) {
        // Si falla por violación de restricción única (orden duplicado)
        if (typeof error === "object" && error !== null && "code" in error && (error as any).code === '23505') {
            // Obtener las imágenes del artículo para encontrar la que tiene el orden conflictivo
            const images = await getImagesByArticuloId(articulo_id);
            const conflictingImage = images.find(img => img.orden === newOrder);
            if (conflictingImage) {
                // Intercambiar órdenes
                await swapImageOrders(articulo_id, image_id, conflictingImage.image_id);
                // Retornar la imagen actualizada
                const updatedImages = await getImagesByArticuloId(articulo_id);
                return updatedImages.find(img => img.image_id === image_id);
            } else {
                throw new Error('No se pudo resolver el conflicto de orden');
            }
        } else {
            throw error;
        }
    }
}

