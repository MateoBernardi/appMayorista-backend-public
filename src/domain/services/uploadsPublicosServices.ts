import { randomUUID } from 'crypto';
import { copyFile, deleteFile, generateUploadUrl, headFile, readFileRange } from '../../adapters/archivos/archivosApi';
import { createArchivo, existsArchivoByRutaR2 } from '../../adapters/db/archivosRepo';
import { getCarpetaByNombreRaiz } from '../../adapters/db/carpetasRepo';
import { BadRequestError, InternalServerError } from '../../adapters/errors/AppError';
import { ArchivoUso } from '../dto/ArchivoDTO';
import { signUploadToken, verifyUploadToken } from '../validations/uploadTokens';
import { getCarpetaPermisos } from './carpetasServices';

/**
 * Subidas públicas desde la web (sin usuario logueado).
 * Por ahora el único destino configurado es CV → carpeta raíz "CVs Página Web"
 * (creada por la migración 068). La carpeta se resuelve siempre del lado del
 * servidor: nunca se acepta id_carpeta, roles ni nombres desde el request.
 *
 * El archivo no pasa por este servidor: el navegador lo sube directo a R2 con una
 * URL firmada (a un prefijo de pendientes) y después confirma. Recién al confirmar
 * se valida el contenido real (tamaño y magic bytes, leyendo solo rangos), se mueve
 * a la ruta definitiva y se registra en la DB. Los pendientes que nunca se confirman
 * los borra una lifecycle rule de R2 sobre PREFIJO_R2_CVS_PENDIENTES.
 */
export const CARPETA_CVS_WEB = 'CVs Página Web';
export const MAX_CV_BYTES = 5 * 1024 * 1024;

const PREFIJO_R2_CVS = 'cvs-web';
const PREFIJO_R2_CVS_PENDIENTES = 'cvs-web-pendientes';
const VIGENCIA_URL_SUBIDA_SEG = 5 * 60;
// El directorio central de un ZIP (con los nombres de las entradas) está al final del archivo.
const BYTES_FINALES_ZIP = 64 * 1024;

type TipoCv = 'pdf' | 'doc' | 'docx';

const MIME_POR_TIPO: Record<TipoCv, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// application/octet-stream se tolera porque algunos navegadores/SO lo mandan para
// .doc/.docx cuando no tienen Office registrado. No es un riesgo: el tipo real se
// decide por magic bytes y el contentType que se guarda es el detectado.
const MIMES_PERMITIDOS = new Set<string>([...Object.values(MIME_POR_TIPO), 'application/octet-stream']);

const FIRMA_PDF = Buffer.from('%PDF-', 'ascii');
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const FIRMA_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const MENSAJE_FORMATO = 'El archivo debe ser un PDF, DOC o DOCX.';

export interface SolicitudSubidaCv {
  nombre: unknown;
  contentType: unknown;
  size: unknown;
}

export interface SubidaCvFirmada {
  uploadUrl: string;
  token: string;
}

const esZip = (inicio: Buffer): boolean => inicio.subarray(0, FIRMA_ZIP.length).equals(FIRMA_ZIP);

/**
 * Detecta el tipo real del archivo por sus magic bytes (sin dependencias).
 * `inicio` son los primeros bytes; `final`, los últimos (solo hacen falta para DOCX).
 */
export const detectarTipoCv = (inicio: Buffer, final: Buffer = inicio): TipoCv | null => {
  if (inicio.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF)) return 'pdf';
  if (inicio.subarray(0, FIRMA_OLE2.length).equals(FIRMA_OLE2)) return 'doc';
  // Un DOCX es un ZIP; además exigimos que tenga entradas "word/" (los nombres de
  // las entradas van sin comprimir, también en el directorio central del final)
  // para no aceptar cualquier .zip/.xlsx/.jar.
  if (esZip(inicio) && final.includes('word/')) return 'docx';
  return null;
};

const extensionDe = (nombre: string): string => {
  const punto = nombre.lastIndexOf('.');
  return punto === -1 ? '' : nombre.slice(punto + 1).toLowerCase();
};

// Partes de fecha en horario argentino, independiente del TZ del proceso.
const partesFechaAR = (fecha: Date) => {
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(formatter.formatToParts(fecha).map(({ type, value }) => [type, value]));
  // Algunas versiones de ICU devuelven "24" para la medianoche con hour12: false.
  const hour = p.hour === '24' ? '00' : p.hour;
  return { ...p, hour } as Record<'day' | 'month' | 'year' | 'hour' | 'minute' | 'second', string>;
};

/**
 * Paso 1: valida lo que declara el cliente (extensión, mimetype y tamaño) y firma
 * un PUT directo a R2. La key la arma el servidor; el nombre original se descarta.
 * El mimetype firmado es el declarado: el PUT tiene que mandar exactamente ese
 * Content-Type y ese tamaño.
 */
export const prepararSubidaCv = async (solicitud: SolicitudSubidaCv): Promise<SubidaCvFirmada> => {
  const { nombre, contentType, size } = solicitud;

  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    throw new BadRequestError('Tenés que adjuntar tu CV.');
  }
  if (size > MAX_CV_BYTES) {
    throw new BadRequestError('El archivo no puede superar los 5 MB.');
  }

  const extension = extensionDe(typeof nombre === 'string' ? nombre : '');
  if (!(extension in MIME_POR_TIPO)) {
    throw new BadRequestError(MENSAJE_FORMATO);
  }
  const mime = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (!MIMES_PERMITIDOS.has(mime)) {
    throw new BadRequestError(MENSAJE_FORMATO);
  }

  const key = `${PREFIJO_R2_CVS_PENDIENTES}/${randomUUID()}.${extension}`;
  const uploadUrl = await generateUploadUrl(key, VIGENCIA_URL_SUBIDA_SEG, mime, size);
  const token = signUploadToken({ tipo: 'cv', key, ext: extension });

  return { uploadUrl, token };
};

/**
 * Paso 2: el CV ya está en R2 (pendiente). Valida tamaño real y magic bytes contra
 * la extensión declarada, lo mueve a la ruta definitiva y lo registra en la DB.
 * Si el contenido no es válido, borra el pendiente. Idempotente: confirmar dos
 * veces el mismo token no duplica el registro.
 */
export const confirmarCvPublico = async (token: unknown): Promise<void> => {
  const { key: keyPendiente, ext } = verifyUploadToken(token, 'cv');
  if (!(ext in MIME_POR_TIPO) || !keyPendiente.startsWith(`${PREFIJO_R2_CVS_PENDIENTES}/`)) {
    throw new BadRequestError('La subida expiró o no es válida. Volvé a intentarlo.');
  }
  const extension = ext as TipoCv;
  const uuid = keyPendiente.slice(PREFIJO_R2_CVS_PENDIENTES.length + 1, -(extension.length + 1));
  const rutaR2 = `${PREFIJO_R2_CVS}/${uuid}.${extension}`;

  if (await existsArchivoByRutaR2(rutaR2)) return;

  const objeto = await headFile(keyPendiente);
  if (!objeto) {
    throw new BadRequestError('No recibimos tu CV. Volvé a intentarlo.');
  }
  if (objeto.size <= 0 || objeto.size > MAX_CV_BYTES) {
    await deleteFile(keyPendiente);
    throw new BadRequestError(objeto.size <= 0 ? 'Tenés que adjuntar tu CV.' : 'El archivo no puede superar los 5 MB.');
  }

  const inicio = await readFileRange(keyPendiente, `bytes=0-${FIRMA_OLE2.length - 1}`);
  const final = esZip(inicio) ? await readFileRange(keyPendiente, `bytes=-${BYTES_FINALES_ZIP}`) : inicio;
  const tipo = detectarTipoCv(inicio, final);
  if (!tipo || tipo !== extension) {
    await deleteFile(keyPendiente);
    throw new BadRequestError('El contenido del archivo no coincide con su formato. Enviá un PDF, DOC o DOCX válido.');
  }

  const carpeta = await getCarpetaByNombreRaiz(CARPETA_CVS_WEB);
  if (!carpeta) {
    console.error(`[uploadsPublicos] No existe la carpeta raíz "${CARPETA_CVS_WEB}" (¿falta correr la migración 068?).`);
    throw new InternalServerError('No pudimos recibir tu CV en este momento. Intentá de nuevo más tarde.');
  }
  const permisos = await getCarpetaPermisos(carpeta.id);

  const f = partesFechaAR(new Date());
  const contentType = MIME_POR_TIPO[tipo];
  const nombre = `CV_${f.year}${f.month}${f.day}-${f.hour}${f.minute}${f.second}_${uuid.slice(0, 8)}.${tipo}`;

  await copyFile(keyPendiente, rutaR2, contentType);

  await createArchivo({
    nombre,
    ruta_r2: rutaR2,
    id_carpeta: carpeta.id,
    tipo: contentType,
    tamaño: objeto.size,
    titulo: `CV recibido ${f.day}/${f.month}/${f.year} ${f.hour}:${f.minute}`,
    created_by: carpeta.id_usuario,
    allowed_roles: permisos.allowed_roles,
    usuarios_compartidos: (permisos.user_context_ids ?? []).map(Number),
    uso: ArchivoUso.EMPRESA,
  });

  try {
    await deleteFile(keyPendiente);
  } catch (error) {
    // No es crítico: la lifecycle rule de R2 limpia los pendientes.
    console.error(`[uploadsPublicos] No se pudo borrar el pendiente ${keyPendiente}`, error);
  }
};
