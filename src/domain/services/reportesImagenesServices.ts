import {
    linkImageToReporte,
    unlinkImageFromReporte,
    getImagesByReporteId,
    getNextOrden,
    updateImageOrderForReporte,
    swapImageOrders,
} from "../../adapters/db/reportesImagenesRepo";
import { createImage } from "../../adapters/db/web/imagesRepo";
import { uploadImageToCloudflare } from "../../adapters/images/uploadImages";
import { ConflictError } from "../../adapters/errors/AppError";

export interface UploadReporteImageParams {
    file: Buffer;
    filename: string;
    description: string;
    reporteId: number;
    orden: number;
}

export const uploadImageWithReporteLink = async (params: UploadReporteImageParams) => {
    const { file, filename, description, reporteId, orden } = params;

    // 1. Subir imagen a Cloudflare Images
    const cloudflareResponse = await uploadImageToCloudflare({
        file,
        filename,
        requireSignedURLs: false,
    });

    const { id: cfImageId, variants } = cloudflareResponse.result;
    const imageUrl = variants[0];

    // 2. Crear registro en la tabla images con section = 'reportes'
    const imageRecord = await createImage({
        url: imageUrl || "",
        section: "reportes",
        description,
        cf_image_id: cfImageId,
    });

    // 3. Vincular imagen al reporte
    const reporteImagenRecord = await linkImageToReporte({
        reporte_id: reporteId,
        image_id: imageRecord.id,
        orden,
    });

    return {
        image: imageRecord,
        reporteLink: reporteImagenRecord,
        cloudflareData: {
            id: cfImageId,
            variants,
            url: imageUrl,
        },
    };
};

export const addImageToReporte = async (reporte_id: number, image_id: number, orden: number) => {
    return await linkImageToReporte({ reporte_id, image_id, orden });
};

export const removeImageFromReporte = async (reporte_id: number, image_id: number, orden: number) => {
    return await unlinkImageFromReporte(reporte_id, image_id, orden);
};

export const fetchImagesByReporteId = async (reporte_id: number) => {
    return await getImagesByReporteId(reporte_id);
};

export const changeImageOrderForReporte = async (reporte_id: number, image_id: number, newOrder: number) => {
    try {
        return await updateImageOrderForReporte(reporte_id, image_id, newOrder);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && (error as any).code === '23505') {
            const images = await getImagesByReporteId(reporte_id);
            const conflictingImage = images.find((img: any) => img.orden === newOrder);
            if (conflictingImage) {
                await swapImageOrders(reporte_id, image_id, conflictingImage.image_id);
                const updatedImages = await getImagesByReporteId(reporte_id);
                return updatedImages.find((img: any) => img.image_id === image_id);
            } else {
                throw new ConflictError('No se pudo resolver el conflicto de orden');
            }
        } else {
            throw error;
        }
    }
};
