import { v7 as uuidv7 } from 'uuid';
import {
  agregarEntrada,
  deleteAdjunto,
  editarEntrada as editarEntradaRepo,
  getAdjuntosDeEntrada,
  getAdjuntosPorInforme,
  getAdjuntoVisible,
  getConversacion,
  getPersonasResumen,
  getVistosDeEntrada,
  informeVisiblePara,
  marcarEntradasVistas,
  getUsuariosExistentes,
  insertAdjunto,
  insertRelato,
  listInformesVisibles,
  verificarEscrituraEntrada,
} from '../../adapters/db/informesRepo';
import { generateSignedUrl, uploadFiles } from '../../adapters/archivos/archivosApi';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../adapters/errors/AppError';
import {
  AdjuntoDTO,
  EntradaDTO,
  EntradaVistoDTO,
  InformeDetalleDTO,
  InformeListadoDTO,
  PersonaResumenDTO,
  ResultadoEscritura,
  TipoAdjunto,
} from '../dto/InformeDTO';
import { extraerMenciones, sanitizeInformeHtml, textoPlano } from '../../utils/sanitizeHtml';

const MAX_INT4 = 2147483647;
const MAX_HTML = 10000;
const MAX_TEXTO = 1000;
const MAX_PREVIEW = 200;
export const MAX_ADJUNTO_BYTES = 50 * 1024 * 1024;
export const URL_ADJUNTO_SEGUNDOS = 900;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_DOCUMENTO =
  /^(application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[\w.+-]+)|text\/(plain|csv))$/;

function validarCuerpo(cuerpo: unknown): string {
  if (cuerpo === undefined || cuerpo === null) throw new BadRequestError('El texto es obligatorio.');
  if (typeof cuerpo !== 'string') throw new BadRequestError('El texto no es válido.');
  if (cuerpo.length > MAX_HTML) {
    throw new BadRequestError(`El contenido no puede superar los ${MAX_HTML} caracteres.`);
  }
  const html = sanitizeInformeHtml(cuerpo.trim());
  const texto = textoPlano(html);
  // Una entrada puede ser solo un adjunto en línea (marcador sin texto).
  if (!texto && !html.includes('data-adjunto=')) throw new BadRequestError('El texto es obligatorio.');
  if (texto.length > MAX_TEXTO) {
    throw new BadRequestError(`El texto no puede superar los ${MAX_TEXTO} caracteres.`);
  }
  return html;
}

/** Extrae las menciones y verifica que todas existan (un array no admite FK). */
async function resolverMenciones(html: string, autorId: number): Promise<number[]> {
  const ids = extraerMenciones(html, autorId);
  if (ids.some((id) => id > MAX_INT4 || id < 1)) {
    throw new UnprocessableEntityError('Hay menciones a usuarios que no existen.');
  }
  const existentes = await getUsuariosExistentes(ids);
  if (existentes.length !== ids.length) {
    throw new UnprocessableEntityError('Hay menciones a usuarios que no existen.');
  }
  return ids;
}

export function validarInformeId(id: string): string {
  if (!UUID.test(id)) throw new BadRequestError('El identificador del informe no es válido.');
  return id;
}

export async function crearInforme(
  autorId: number,
  cuerpoRaw: unknown,
): Promise<{ informe_id: string; entrada: EntradaDTO }> {
  const cuerpo = validarCuerpo(cuerpoRaw);
  const menciones = await resolverMenciones(cuerpo, autorId);
  const informeId = uuidv7();
  const entrada = await insertRelato(informeId, autorId, cuerpo, menciones);
  return { informe_id: informeId, entrada: { ...entrada, adjuntos: [] } };
}

export async function agregarEntradaInforme(
  informeIdRaw: string,
  autorId: number,
  cuerpoRaw: unknown,
  /** Gerencia puede escribir en cualquier informe aunque no participe. */
  esGerencia = false,
): Promise<EntradaDTO> {
  const informeId = validarInformeId(informeIdRaw);
  const cuerpo = validarCuerpo(cuerpoRaw);
  const menciones = await resolverMenciones(cuerpo, autorId);
  const r = await agregarEntrada(informeId, autorId, cuerpo, menciones, esGerencia);
  if (r.status === 'no_existe') throw new NotFoundError('Informe no encontrado.');
  return { ...r.entrada, adjuntos: [] };
}

function resolverEscritura<T>(r: ResultadoEscritura<T>): asserts r is Extract<ResultadoEscritura<T>, { status: 'ok' }> {
  switch (r.status) {
    case 'ok':
      return;
    case 'no_existe':
      throw new NotFoundError('Informe no encontrado.');
    case 'no_autor':
      throw new ForbiddenError('Solo quien escribió la entrada puede modificarla.');
  }
}

export async function editarEntrada(
  informeIdRaw: string,
  entradaId: number,
  personaId: number,
  cuerpoRaw: unknown,
): Promise<EntradaDTO> {
  const informeId = validarInformeId(informeIdRaw);
  const cuerpo = validarCuerpo(cuerpoRaw);
  const menciones = await resolverMenciones(cuerpo, personaId);
  const r = await editarEntradaRepo(informeId, entradaId, personaId, cuerpo, menciones);
  resolverEscritura(r);
  return { ...r.entrada, adjuntos: await getAdjuntosDeEntrada(entradaId) };
}

export interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function tipoAdjunto(mime: string): TipoAdjunto {
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  if (MIME_DOCUMENTO.test(mime)) return 'documento';
  throw new BadRequestError('El tipo de archivo no está permitido.');
}

function nombreSeguro(nombre: string): string {
  const limpio = nombre.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return limpio.slice(-100) || 'archivo';
}

export async function agregarAdjunto(
  informeIdRaw: string,
  entradaId: number,
  personaId: number,
  archivo: ArchivoSubido | undefined,
  nombreRaw?: unknown,
  ordenRaw?: unknown,
): Promise<AdjuntoDTO> {
  const informeId = validarInformeId(informeIdRaw);
  if (!archivo) throw new BadRequestError('El archivo es obligatorio.');
  if (archivo.size > MAX_ADJUNTO_BYTES) {
    throw new BadRequestError('El archivo no puede superar los 50 MB.');
  }
  const tipo = tipoAdjunto(archivo.mimetype);
  let orden: number | undefined;
  if (ordenRaw !== undefined && ordenRaw !== '') {
    orden = Number(ordenRaw);
    if (!Number.isInteger(orden) || orden < 0 || orden > MAX_INT4) {
      throw new BadRequestError('El orden del adjunto no es válido.');
    }
  }

  resolverEscritura(await verificarEscrituraEntrada(informeId, entradaId, personaId));
  if (orden !== undefined && (await getAdjuntosDeEntrada(entradaId)).some((a) => a.orden === orden)) {
    throw new ConflictError('Ya existe un adjunto con ese orden en la entrada.');
  }

  const original =
    typeof nombreRaw === 'string' && nombreRaw.trim() ? nombreRaw.trim() : archivo.originalname;
  const nombre = original.slice(0, 255);
  const key = `informes/${informeId}/${entradaId}/${Date.now()}-${nombreSeguro(original)}`;
  await uploadFiles(key, archivo.buffer, archivo.mimetype);

  const r = await insertAdjunto(informeId, entradaId, personaId, {
    tipo,
    r2_key: key,
    nombre,
    mime: archivo.mimetype,
    tamano: archivo.size,
    orden,
  });
  resolverEscritura(r);
  return r.adjunto;
}

export async function quitarAdjunto(
  informeIdRaw: string,
  entradaId: number,
  adjuntoId: number,
  personaId: number,
): Promise<void> {
  const informeId = validarInformeId(informeIdRaw);
  const r = await deleteAdjunto(informeId, entradaId, personaId, adjuntoId);
  if (r.status === 'no_existe') throw new NotFoundError('Adjunto no encontrado.');
  resolverEscritura(r);
}

export async function urlAdjunto(
  informeIdRaw: string,
  adjuntoId: number,
  personaId: number,
  empleadoId?: number,
): Promise<{ url: string; expira_en: number }> {
  const informeId = validarInformeId(informeIdRaw);
  const adjunto = await getAdjuntoVisible(informeId, adjuntoId, personaId, empleadoId);
  if (!adjunto) throw new NotFoundError('Adjunto no encontrado.');
  const url = await generateSignedUrl(
    adjunto.r2_key,
    URL_ADJUNTO_SEGUNDOS,
    adjunto.nombre,
    adjunto.mime,
  );
  return { url, expira_en: URL_ADJUNTO_SEGUNDOS };
}

export async function obtenerInforme(
  informeIdRaw: string,
  personaId: number,
  empleadoId?: number,
): Promise<InformeDetalleDTO> {
  const informeId = validarInformeId(informeIdRaw);
  // 404 (no 403) para no revelar que el informe existe.
  const filas = await getConversacion(informeId, personaId, empleadoId);
  if (filas.length === 0) throw new NotFoundError('Informe no encontrado.');

  const adjuntos = await getAdjuntosPorInforme(informeId);
  const entradas: EntradaDTO[] = filas.map((e) => ({
    ...e,
    adjuntos: adjuntos.filter((a) => a.entrada_id === e.id),
  }));
  const ids = [...new Set(entradas.flatMap((e) => [e.autor_id, ...e.menciones]))];
  const personas: Record<number, PersonaResumenDTO> = {};
  for (const p of await getPersonasResumen(ids)) personas[p.id] = p;

  return {
    informe_id: informeId,
    creador: entradas.find((e) => e.tipo === 'relato')?.autor_id ?? entradas[0]!.autor_id,
    entradas,
    personas,
  };
}

/** Marca como vistas las entradas del informe para la persona. 404 si no ve el informe. */
export async function marcarInformeVisto(informeIdRaw: string, personaId: number): Promise<{ marcadas: number }> {
  const informeId = validarInformeId(informeIdRaw);
  if (!(await informeVisiblePara(informeId, personaId))) throw new NotFoundError('Informe no encontrado.');
  return { marcadas: await marcarEntradasVistas(informeId, personaId) };
}

export async function listarVistosEntrada(
  informeIdRaw: string,
  entradaId: number,
  personaId: number,
): Promise<EntradaVistoDTO[]> {
  const informeId = validarInformeId(informeIdRaw);
  if (!(await informeVisiblePara(informeId, personaId))) throw new NotFoundError('Informe no encontrado.');
  return getVistosDeEntrada(informeId, entradaId);
}

function cortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

export async function listarInformes(
  personaId: number,
  antes: unknown,
  empleadoId?: number,
): Promise<InformeListadoDTO> {
  let cursor: string | null = null;
  if (antes !== undefined && antes !== '') {
    if (typeof antes !== 'string' || Number.isNaN(Date.parse(antes))) {
      throw new BadRequestError('El cursor "antes" no es válido.');
    }
    cursor = antes;
  }
  const { informes, nextCursor } = await listInformesVisibles(personaId, cursor, empleadoId);
  return {
    informes: informes.map(({ cuerpo_inicial, ...i }) => {
      return { ...i, preview: cortar(textoPlano(cuerpo_inicial).split('\n').join(' '), MAX_PREVIEW) };
    }),
    nextCursor,
  };
}
