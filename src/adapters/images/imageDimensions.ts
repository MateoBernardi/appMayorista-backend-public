import { imageSize } from "image-size";

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Lee las dimensiones originales (px) de un buffer de imagen.
 * Considera la orientación EXIF (5-8 rotan 90°). Devuelve null si no se puede determinar.
 */
export const readImageDimensions = (buffer: Uint8Array): ImageDimensions | null => {
  try {
    const { width, height, orientation } = imageSize(buffer);
    if (!width || !height) return null;
    const rotated = orientation !== undefined && orientation >= 5 && orientation <= 8;
    return rotated ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
};
