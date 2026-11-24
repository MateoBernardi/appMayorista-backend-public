import FormData from "form-data";
import fetch from "node-fetch";

// Configuración Cloudflare Images
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;
const CF_IMAGES_ACCOUNT_HASH = process.env.CF_IMAGES_ACCOUNT_HASH!;

// Variantes con nombre configuradas en el dashboard de Cloudflare Images.
// El frontend (InsumosWeb src/utils/cfImage.ts) reemplaza el último segmento de la URL
// guardada por la variante que necesita, así toda imagen se muestra con el mismo tamaño
// y calidad sin importar cómo se subió.
// 'public' existe por defecto en toda cuenta: es la que se guarda en images.url.
export const BASE_VARIANT = 'public';
export const THUMB_VARIANT = 'thumb';
export const CARD_VARIANT = 'card';
// Variante fija usada por el visor de detalle de producto.
export const VISOR_VARIANT = 'visor';
export const HERO_VARIANT = 'hero';

export interface CloudflareImageResponse {
  success: boolean;
  errors?: any[];
  result: {
    id: string;
    filename: string;
    uploaded: string;
    requireSignedURLs: boolean;
    variants: string[];
  };
}

export interface UploadImageToCloudflareParams {
  file: Buffer;
  filename: string;
  requireSignedURLs?: boolean;
}

/**
 * Sube una imagen a Cloudflare Images
 * @param params - Parámetros para la subida de imagen
 * @returns Respuesta de Cloudflare Images con id, variants, etc.
 */
export async function uploadImageToCloudflare(
  params: UploadImageToCloudflareParams
): Promise<CloudflareImageResponse> {
  const { file, filename, requireSignedURLs = false } = params;

  try {
    // Crear FormData para enviar a Cloudflare
    const form = new FormData();
    form.append("file", file, filename);
    form.append("requireSignedURLs", requireSignedURLs.toString());

    // Realizar petición a Cloudflare Images API
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1`,
      {
        method: "POST",
        headers: { 
          Authorization: `Bearer ${CF_API_TOKEN}`,
          ...form.getHeaders()
        },
        body: form as any,
      }
    );

    const data = await response.json() as CloudflareImageResponse;

    if (!data.success) {
      throw new Error(`Error subiendo a Cloudflare Images: ${JSON.stringify(data.errors)}`);
    }

    return data;

  } catch (error) {
    throw error;
  }
}

export interface CloudflareDirectUploadResponse {
  success: boolean;
  errors?: any[];
  result: {
    id: string;
    uploadURL: string;
  };
}

/**
 * Pide a Cloudflare Images una URL de subida de un solo uso (direct creator upload).
 * El navegador sube la imagen directo a esa URL (POST multipart, campo "file");
 * la imagen queda en estado `draft` hasta que se sube.
 * @param expiresInSeconds - Vigencia de la URL (Cloudflare exige entre 2 min y 6 h)
 */
export async function createCloudflareDirectUpload(params: {
  expiresInSeconds: number;
  metadata?: Record<string, string>;
  requireSignedURLs?: boolean;
}): Promise<{ id: string; uploadURL: string }> {
  const { expiresInSeconds, metadata, requireSignedURLs = false } = params;

  const form = new FormData();
  form.append("requireSignedURLs", requireSignedURLs.toString());
  form.append("expiry", new Date(Date.now() + expiresInSeconds * 1000).toISOString());
  if (metadata) {
    form.append("metadata", JSON.stringify(metadata));
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v2/direct_upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        ...form.getHeaders()
      },
      body: form as any,
    }
  );

  const data = await response.json() as CloudflareDirectUploadResponse;

  if (!data.success) {
    throw new Error(`Error pidiendo URL de subida a Cloudflare Images: ${JSON.stringify(data.errors)}`);
  }

  return { id: data.result.id, uploadURL: data.result.uploadURL };
}

/**
 * Detalle de una imagen de Cloudflare Images. Devuelve null si no existe.
 * `draft: true` significa que se pidió la URL de subida pero la imagen todavía no se subió.
 */
export async function getCloudflareImage(imageId: string): Promise<{ id: string; draft: boolean } | null> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1/${encodeURIComponent(imageId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` }
    }
  );

  if (response.status === 404) return null;

  const data = await response.json() as { success: boolean; errors?: any[]; result?: { id: string; draft?: boolean } };

  if (!data.success || !data.result) {
    throw new Error(`Error obteniendo imagen de Cloudflare: ${JSON.stringify(data.errors)}`);
  }

  return { id: data.result.id, draft: data.result.draft === true };
}

/**
 * Obtiene las variants de una imagen de Cloudflare
 * @param imageId - ID de la imagen en Cloudflare
 * @returns Array de URLs de las variants
 */
export async function getImageVariants(imageId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1/${imageId}`,
      {
        method: "GET",
        headers: { 
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json() as CloudflareImageResponse;

    if (!data.success) {
      throw new Error(`Error obteniendo variants de imagen: ${JSON.stringify(data.errors)}`);
    }

    return data.result.variants;

  } catch (error) {
    throw error;
  }
}

/**
 * Construye la URL de una variante de Cloudflare Images para una imagen dada.
 * No requiere llamar a la API: las variantes se resuelven en el edge de Cloudflare.
 * @param cfImageId - ID de la imagen en Cloudflare
 * @param variant - Nombre de la variante configurada en el dashboard de Cloudflare Images
 */
export function buildImageVariantUrl(cfImageId: string, variant: string): string {
  return `https://imagedelivery.net/${CF_IMAGES_ACCOUNT_HASH}/${cfImageId}/${variant}`;
}

/**
 * Elimina una imagen de Cloudflare Images
 * @param imageId - ID de la imagen en Cloudflare
 */
export async function deleteImageFromCloudflare(imageId: string): Promise<void> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1/${imageId}`,
      {
        method: "DELETE",
        headers: { 
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json() as { success: boolean; errors?: any[] };

    if (!data.success) {
      throw new Error(`Error eliminando imagen: ${JSON.stringify(data.errors)}`);
    }


  } catch (error) {
    throw error;
  }
}