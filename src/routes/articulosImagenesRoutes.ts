import { Router } from "express";
import { linkImageToArticulo, unlinkImageFromArticulo, getArticulosByImageId, getImagesByArticuloId, updateImageOrder } from "../controllers/web/articulosImagenesController";

const articulosImagenesRouter = Router();

// POST routes
articulosImagenesRouter.post('/link', linkImageToArticulo);

// GET routes
articulosImagenesRouter.get('/articulo/:articulo_id', getImagesByArticuloId);

// DELETE routes
articulosImagenesRouter.delete('/unlink/:articulo_id/:image_id/:orden', unlinkImageFromArticulo);

// PUT routes
articulosImagenesRouter.put('/update-order/:articulo_id/:image_id', updateImageOrder);

export default articulosImagenesRouter;