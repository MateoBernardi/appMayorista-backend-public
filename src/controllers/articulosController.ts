import { Request, Response, NextFunction } from 'express';
import { fetchArticulos, fetchArticulosBySearch, fetchArticulosPublicBySearch, generarTXTStockService, generarCSVArticulosService } from '../domain/services/articulosServices';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';

export const getArticulos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 30;
  const rubro = req.query.rubro as string;
  const filter = req.query.filter as string;
  const soloOfertas = req.query.soloOfertas === 'true';
  try {
    const articulos = await fetchArticulos(rubro, page, limit, filter, soloOfertas);
    res.json(articulos);
  } catch (err) {
    console.error("[getArticulos] error:", err);
    next(asAppError(err, "No se pudieron obtener los artículos"));
  }
};

export const getArticulosBySearch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = req.params.search as string;
    const campo = req.query.campo as string;
    const rubro = req.query.rubro as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    if (!search) {
      throw new BadRequestError("Parámetro de búsqueda no proporcionado");
    }
    const articulos = await fetchArticulosBySearch(search, rubro, campo, page, limit);
    res.json(articulos);
  } catch (err) {
    next(asAppError(err, "No se pudieron obtener los artículos"));
  }
};

// Búsqueda pública de artículos con imágenes
export const getArticulosPublicBySearch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = req.params.search as string;
    const rubro = req.query.rubro as string;
    const seccionImagen = (req.query.seccionImagen as string) || 'default';
    if (!search) {
      throw new BadRequestError("Parámetro de búsqueda no proporcionado");
    }
    const articulos = await fetchArticulosPublicBySearch(search, rubro, seccionImagen);
    res.json(articulos);
  } catch (err) {
    next(asAppError(err, "No se pudieron obtener los artículos públicos"));
  }
};

export const generarTXTStock = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {fileName, contenido} = await generarTXTStockService();

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    res.send(contenido);
    console.log(`Archivo virtual ${fileName} enviado correctamente`);
  } catch (err) {
    console.error("[generarTXTStock] error:", err);
    next(asAppError(err, "No se pudo generar el archivo de stock"));
  }
};

export const descargarArticulosCSV = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fileName, contenido } = await generarCSVArticulosService();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    res.send(contenido);
  } catch (err) {
    console.error("[descargarArticulosCSV] error:", err);
    next(asAppError(err, "No se pudo generar el archivo CSV de artículos"));
  }
};
