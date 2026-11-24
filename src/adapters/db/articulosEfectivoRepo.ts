// Punto único que decide si el stock "vigente" de un artículo viene de una
// oferta activa o del articulo base. Nunca mezcla campos entre ambas fuentes.
import { getStockArticulo, updateArticuloStock } from './articulosRepo';
import { getOfertaActivaByCodigo, decrementarStockOferta } from './articulosOfertasRepo';

export const getStockEfectivo = async (
  codigo_articulo: string,
  client?: any
): Promise<{ stock_actual: number; oferta_id?: number } | undefined> => {
  const oferta = await getOfertaActivaByCodigo(Number(codigo_articulo), client);
  if (oferta) {
    return { stock_actual: oferta.stock_actual, oferta_id: oferta.oferta_id! };
  }
  return getStockArticulo(codigo_articulo);
};

export const decrementarStockEfectivo = async (codigo_articulo: string, cantidad: number, client?: any): Promise<void> => {
  const oferta = await getOfertaActivaByCodigo(Number(codigo_articulo), client);
  if (oferta) {
    await decrementarStockOferta(oferta.oferta_id!, cantidad, client);
    return;
  }
  await updateArticuloStock(codigo_articulo, cantidad, client);
};
