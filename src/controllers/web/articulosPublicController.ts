import { fetchArticulosPublic } from "../../domain/services/web/articulosPublicServices";
import { asAppError, BadRequestError } from "../../adapters/errors/AppError";

export const getArticulosPublicController = async (req: any, res: any, next: any) => {
  try {
    const { rubro, seccionImagen, page = 1, limit = 30 } = req.query;
    if (!rubro || !seccionImagen) {
      throw new BadRequestError('Faltan parámetros obligatorios');
    }
    const articulos = await fetchArticulosPublic(rubro, seccionImagen, parseInt(page), parseInt(limit));
    res.json(articulos);
  } catch (error) {
    next(asAppError(error, 'No se pudo obtener los artículos públicos'));
  }
};