import express from 'express';
import { recepcionController } from "../controllers/recepcionController";
import { auth } from '../adapters/auth/authPermisos';

const sincronizarRouter = express.Router();

sincronizarRouter.post('/recepcion-excel', recepcionController);

export default sincronizarRouter;
