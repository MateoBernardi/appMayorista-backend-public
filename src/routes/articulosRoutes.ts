import { Router } from 'express';
import { getArticulos, getArticulosBySearch, generarTXTStock, descargarArticulosCSV } from '../controllers/articulosController';


const articulosRouter = Router();

// GET routes
articulosRouter.get('/', getArticulos);
articulosRouter.get('/search/:search', getArticulosBySearch);
articulosRouter.get('/stock', generarTXTStock);
articulosRouter.get('/export/csv', descargarArticulosCSV);

export default articulosRouter;
