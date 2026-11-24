import { Router } from 'express';
import { getLocalidades } from '../controllers/localidadesControllers';

const localidadesRouter = Router();

localidadesRouter.get('/', getLocalidades);

export default localidadesRouter;
