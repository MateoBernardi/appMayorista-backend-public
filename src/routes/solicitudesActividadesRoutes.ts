import { Router } from 'express';
import solicitudesRouter from './solicitudesRoutes';
import actividadesRouter from './actividadesRoutes';

const SolicitudesActividadesRouter = Router();

SolicitudesActividadesRouter.use(solicitudesRouter);
SolicitudesActividadesRouter.use(actividadesRouter);

export default SolicitudesActividadesRouter;
