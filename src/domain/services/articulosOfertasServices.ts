import { OfertaArticuloDTO, OfertaConArticuloDTO } from '../dto/OfertaDTO';
import {
  actualizarOferta,
  crearOferta,
  desactivarOferta,
  listarOfertasConArticulo,
} from '../../adapters/db/articulosOfertasRepo';
import { getArticulosBySearch } from '../../adapters/db/articulosRepo';
import { BadRequestError, NotFoundError } from '../../adapters/errors/AppError';

type CamposOferta = Pick<OfertaArticuloDTO, 'precio_costo' | 'precio_venta' | 'precio_venta_volumen' | 'stock_actual' | 'rentabilidad_minima'>;

const validarCamposOferta = (oferta: CamposOferta) => {
  for (const campo of ['precio_costo', 'precio_venta', 'precio_venta_volumen', 'stock_actual'] as const) {
    const valor = oferta[campo];
    if (typeof valor !== 'number' || valor < 0) {
      throw new BadRequestError(`${campo} debe ser un número mayor o igual a 0`);
    }
  }
  if (oferta.rentabilidad_minima !== undefined && (oferta.rentabilidad_minima < 0 || oferta.rentabilidad_minima > 1)) {
    throw new BadRequestError('rentabilidad_minima debe estar entre 0 y 1');
  }
};

const validarOferta = async (oferta: OfertaArticuloDTO) => {
  if (!oferta.codigo_articulo || typeof oferta.codigo_articulo !== 'number') {
    throw new BadRequestError('codigo_articulo es requerido');
  }
  validarCamposOferta(oferta);

  // Ofertas se crean desde la app Mayorista (rubro 'M') y desde InsumosWeb (rubros 'I' y 'A').
  const resultados = await Promise.all(
    (['M', 'I', 'A'] as const).map(rubro =>
      getArticulosBySearch(String(oferta.codigo_articulo), rubro, 'codigo_articulo')
    )
  );
  const articulo = resultados
    .flatMap(r => r.articulos)
    .find(a => a.codigo_articulo === oferta.codigo_articulo);
  if (!articulo) {
    throw new NotFoundError(`Artículo con código ${oferta.codigo_articulo} no encontrado`);
  }
};

export const crearOfertaService = async (oferta: OfertaArticuloDTO): Promise<OfertaArticuloDTO> => {
  await validarOferta(oferta);
  try {
    return await crearOferta(oferta);
  } catch (err: any) {
    if (err?.code === '23505') {
      throw new BadRequestError('Ya existe una oferta activa para ese artículo');
    }
    throw err;
  }
};

export const actualizarOfertaService = async (oferta_id: number, datos: CamposOferta): Promise<OfertaArticuloDTO> => {
  validarCamposOferta(datos);
  const oferta = await actualizarOferta(oferta_id, datos);
  if (!oferta) {
    throw new NotFoundError('Oferta no encontrada o ya inactiva');
  }
  return oferta;
};

export const listarOfertasService = async (soloActivas: boolean, rubro?: string): Promise<OfertaConArticuloDTO[]> => {
  return listarOfertasConArticulo(soloActivas, rubro);
};

export const desactivarOfertaService = async (oferta_id: number): Promise<OfertaArticuloDTO> => {
  const oferta = await desactivarOferta(oferta_id);
  if (!oferta) {
    throw new NotFoundError('Oferta no encontrada o ya inactiva');
  }
  return oferta;
};
