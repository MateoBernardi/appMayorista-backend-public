import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Bucket R2 público dedicado a media de secciones del sitio (distinto del bucket
// privado de `archivos` — nunca deben compartir bucket, ya que este se sirve público).
const r2Public = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
  // Sin esto el SDK agrega a las URLs firmadas un checksum CRC32 del body vacío
  // (x-amz-checksum-crc32) y R2 rechaza el PUT real del navegador.
  requestChecksumCalculation: "WHEN_REQUIRED",
});

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const getPublicBucketConfig = () => {
  const bucket = process.env.R2_PUBLIC_BUCKET!;
  const baseUrl = process.env.R2_PUBLIC_BASE_URL!;

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY || !bucket || !baseUrl) {
    console.error('Error: Configuración de R2 público incompleta. Verifica las variables de entorno.' + 'faltan: ' + [
      !bucket ? 'R2_PUBLIC_BUCKET' : null,
      !baseUrl ? 'R2_PUBLIC_BASE_URL' : null,
    ].filter((v): v is string => !!v).join(', '));
    throw new Error('Configuración de R2 público incompleta.');
  }

  return { bucket, baseUrl };
};

export const buildVideoKey = (filename: string): string => `site-media/${Date.now()}-${sanitizeFilename(filename)}`;

export const buildVideoUrl = (key: string): string => `${getPublicBucketConfig().baseUrl}/${key}`;

/** URL firmada para que el navegador suba el video directo al bucket público (PUT). */
export async function generateVideoUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn: number
): Promise<string> {
  const { bucket } = getPublicBucketConfig();
  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    // content-type se firma explícitamente (por defecto no): el PUT tiene que usar el tipo firmado.
    return await getSignedUrl(r2Public, command, { expiresIn, signableHeaders: new Set(['content-type']) });
  } catch (error) {
    console.error('Error al generar URL de subida de video:', error instanceof Error ? error.message : error);
    throw new Error(`Error al generar URL de subida de video: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/** Tamaño del video subido. Devuelve null si no existe. */
export async function headVideo(key: string): Promise<{ size: number } | null> {
  const { bucket } = getPublicBucketConfig();
  try {
    const res = await r2Public.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null;
    throw new Error(`Error al consultar video en R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function deleteVideo(key: string): Promise<void> {
  const { bucket } = getPublicBucketConfig();
  try {
    await r2Public.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw new Error(`Error al borrar video de R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
