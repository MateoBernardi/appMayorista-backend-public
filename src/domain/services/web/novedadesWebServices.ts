import {
  createNovedadWeb,
  deleteNovedadWeb,
  getNovedadesWeb,
  getNovedadesWebPublicadas,
  getNovedadWebById,
  sweepNovedadesWebProgramadas,
  updateNovedadWeb,
} from '../../../adapters/db/web/novedadesWebRepo';
import { NovedadWebCreateInput, NovedadWebDTO, NovedadWebUpdateInput } from '../../dto/NovedadWebDTO';
import { BadRequestError, NotFoundError } from '../../../adapters/errors/AppError';

const ESTADOS_VALIDOS = ['Borrador', 'Programada', 'Publicada'] as const;

const validarCamposNovedadWeb = (data: { titulo?: string | undefined; preview?: string | undefined; cuerpo?: string | undefined; estado?: string | undefined }, esCreacion: boolean) => {
  if (esCreacion || data.titulo !== undefined) {
    if (!data.titulo || typeof data.titulo !== 'string' || data.titulo.trim().length === 0) {
      throw new BadRequestError('El título es requerido.');
    }
    if (data.titulo.length > 140) {
      throw new BadRequestError('El título no puede tener más de 140 caracteres.');
    }
  }

  if (esCreacion || data.preview !== undefined) {
    if (!data.preview || typeof data.preview !== 'string' || data.preview.trim().length === 0) {
      throw new BadRequestError('El resumen (preview) es requerido.');
    }
    if (data.preview.length > 280) {
      throw new BadRequestError('El resumen no puede tener más de 280 caracteres.');
    }
  }

  if (esCreacion || data.cuerpo !== undefined) {
    if (!data.cuerpo || typeof data.cuerpo !== 'string' || data.cuerpo.trim().length === 0) {
      throw new BadRequestError('El cuerpo de la nota es requerido.');
    }
  }

  if (data.estado !== undefined && !ESTADOS_VALIDOS.includes(data.estado as typeof ESTADOS_VALIDOS[number])) {
    throw new BadRequestError("El estado debe ser 'Borrador', 'Programada' o 'Publicada'.");
  }
};

export const fetchNovedadesWeb = async (): Promise<NovedadWebDTO[]> => {
  return getNovedadesWeb();
};

export const fetchNovedadesWebPublicadas = async (): Promise<NovedadWebDTO[]> => {
  return getNovedadesWebPublicadas();
};

export const fetchNovedadWebOrThrow = async (id: number): Promise<NovedadWebDTO> => {
  const novedad = await getNovedadWebById(id);
  if (!novedad) {
    throw new NotFoundError('Novedad no encontrada.');
  }
  return novedad;
};

export const addNovedadWeb = async (input: NovedadWebCreateInput): Promise<NovedadWebDTO> => {
  validarCamposNovedadWeb(input, true);
  return createNovedadWeb(input);
};

export const modifyNovedadWeb = async (id: number, input: NovedadWebUpdateInput): Promise<NovedadWebDTO> => {
  validarCamposNovedadWeb(input, false);
  await fetchNovedadWebOrThrow(id);

  const actualizada = await updateNovedadWeb(id, input);
  if (!actualizada) {
    throw new NotFoundError('Novedad no encontrada.');
  }
  return actualizada;
};

export const removeNovedadWeb = async (id: number): Promise<{ id: number }> => {
  const eliminada = await deleteNovedadWeb(id);
  if (!eliminada) {
    throw new NotFoundError('Novedad no encontrada.');
  }
  return { id };
};

export const sweepNovedadesWebPublicacionProgramada = async (): Promise<number[]> => {
  return sweepNovedadesWebProgramadas();
};
