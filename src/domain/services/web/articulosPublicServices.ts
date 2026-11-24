import { getArticulosPublic } from "../../../adapters/db/articulosRepo";

export const fetchArticulosPublic = async (rubro: string, seccionImagen: string, page: number = 1, limit: number = 30) => {
  const articulosPaginados = await getArticulosPublic(rubro, seccionImagen, page, limit);
  return articulosPaginados;
}