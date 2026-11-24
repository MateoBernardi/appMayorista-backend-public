import { S3Client, PutObjectCommand, GetObjectCommand, GetObjectCommandInput, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Configuración R2
const r2 = new S3Client({
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

// Configuración Cloudflare
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

export async function uploadFiles(key: string, fileBuffer: Buffer, contentType: string) {
  const bucket = process.env.R2_FILES_BUCKET!;

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY || !bucket) {
    console.error('Error: Configuración de R2 incompleta. Verifica las variables de entorno.');
    throw new Error('Configuración de R2 incompleta.');
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  try {
    const response = await r2.send(command);
    return response;
  } catch (error) {
    console.error('Error al subir archivo a R2:', error instanceof Error ? error.message : error);
    throw new Error(`Error al subir archivo a R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function downloadFile(key: string) {
  const bucket = process.env.R2_FILES_BUCKET!;

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY || !bucket) {
    console.error('Error: Configuración de R2 incompleta. Verifica las variables de entorno.');
    throw new Error('Configuración de R2 incompleta.');
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  try {
    const response = await r2.send(command);
    return response;
  } catch (error) {
    console.error('Error al descargar archivo desde R2:', error instanceof Error ? error.message : error);
    throw new Error(`Error al descargar archivo desde R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generateSignedUrl(
  key: string, 
  expiresIn: number = 30, 
  originalName?: string, 
  contentType?: string
): Promise<string> {
  const bucket = process.env.R2_FILES_BUCKET!;

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY || !bucket) {
    console.error('Error: Configuración de R2 incompleta. Verifica las variables de entorno.');
    throw new Error('Configuración de R2 incompleta.');
  }

  // Asegurar que expiresIn sea un número
  const expiresInNumber = typeof expiresIn === 'string' ? parseInt(expiresIn, 10) : expiresIn;
  
  if (isNaN(expiresInNumber) || expiresInNumber <= 0) {
    console.error('Error: Tiempo de expiración inválido. Debe ser un número mayor que 0.');
    throw new Error('Tiempo de expiración debe ser un número válido mayor que 0');
  }

  const commandInput: any = {
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: 'inline', // Dice: "Muéstralo aquí mismo, no lo guardes"
  };

  if (originalName) {
    // "inline" intenta mostrarlo en el navegador. Si no puede (como Excel), lo descarga.
    // Se codifica el nombre para evitar errores con caracteres especiales.
    commandInput.ResponseContentDisposition = `inline; filename="${encodeURIComponent(originalName)}"`;
  }

  if (contentType) {
    commandInput.ResponseContentType = contentType;
  }

  const command = new GetObjectCommand(commandInput);

  try {
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: expiresInNumber });
    return signedUrl;
  } catch (error) {
    console.error('Error al generar URL firmada:', error instanceof Error ? error.message : error);
    throw new Error(`Error al generar URL firmada: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generatePublicUrl(key: string): Promise<string> {
  const bucket = process.env.R2_FILES_BUCKET!;

  if (!bucket) {
    throw new Error('Configuración de R2 incompleta.');
  }

  // URL pública de R2 (si el bucket está configurado como público)
  return `https://italoargentina/${bucket}/${key}`;
}

export async function generateUploadUrl(
  key: string, 
  expiresIn: number, 
  contentType: string,
  contentLength?: number
): Promise<string> {
  const bucket = process.env.R2_FILES_BUCKET!;

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY || !bucket) {
    throw new Error('Configuración de R2 incompleta.');
  }

  const commandInput: any = {
    Bucket: bucket,
    Key: key,
  };

  if (contentType) {
    commandInput.ContentType = contentType;
  }

  // Modo estricto (si se pasa contentLength): se firman el tamaño y el Content-Type
  // declarados, así el PUT tiene que mandar exactamente esos valores.
  // content-type no se firma por defecto, por eso va en signableHeaders.
  if (contentLength !== undefined) {
    commandInput.ContentLength = contentLength;
  }

  const command = new PutObjectCommand(commandInput);

  try {
    const signedUrl = await getSignedUrl(r2, command, {
      expiresIn,
      ...(contentLength !== undefined ? { signableHeaders: new Set(['content-type']) } : {}),
    });
    return signedUrl;
  } catch (error) {
    console.error('Error al generar URL de subida firmada:', error instanceof Error ? error.message : error);
    throw new Error(`Error al generar URL de subida firmada: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

const getFilesBucket = (): string => {
  const bucket = process.env.R2_FILES_BUCKET!;
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY || !bucket) {
    throw new Error('Configuración de R2 incompleta.');
  }
  return bucket;
};

const esNoEncontrado = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

/** Tamaño de un objeto. Devuelve null si no existe. */
export async function headFile(key: string): Promise<{ size: number } | null> {
  try {
    const res = await r2.send(new HeadObjectCommand({ Bucket: getFilesBucket(), Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (error) {
    if (esNoEncontrado(error)) return null;
    throw new Error(`Error al consultar archivo en R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/** Lee un rango de bytes de un objeto (formato HTTP Range, ej. "bytes=0-7" o "bytes=-65536"). */
export async function readFileRange(key: string, range: string): Promise<Buffer> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: getFilesBucket(), Key: key, Range: range }));
    const bytes = await res.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  } catch (error) {
    throw new Error(`Error al leer archivo de R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Copia un objeto dentro del bucket (server-side, no pasa por este servidor).
 * Si se pasa contentType, reemplaza el Content-Type guardado en el objeto copiado.
 */
export async function copyFile(fromKey: string, toKey: string, contentType?: string): Promise<void> {
  const bucket = getFilesBucket();
  try {
    await r2.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${fromKey}`,
      Key: toKey,
      ...(contentType ? { ContentType: contentType, MetadataDirective: 'REPLACE' as const } : {}),
    }));
  } catch (error) {
    throw new Error(`Error al copiar archivo en R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: getFilesBucket(), Key: key }));
  } catch (error) {
    throw new Error(`Error al borrar archivo de R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
