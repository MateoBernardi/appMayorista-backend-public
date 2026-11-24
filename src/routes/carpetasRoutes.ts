import { Router } from 'express';
import { createCarpetaController, deleteCarpetaController, getCarpetaPermisosController, getVisibleCarpetasController, patchCarpetaPermisosController, updateCarpetaController } from '../controllers/carpetasControllers';
import {auth} from '../adapters/auth/authPermisos';
import { idempotency } from '../adapters/middlewares/idempotency';
import { allRoles } from '../types/roles';

const carpetasRouter = Router();

carpetasRouter.get('/', getVisibleCarpetasController);
carpetasRouter.post('/', auth(allRoles), idempotency, createCarpetaController);
carpetasRouter.put('/:id', auth(allRoles), updateCarpetaController);
carpetasRouter.get('/:id/permisos', auth(allRoles), getCarpetaPermisosController);
carpetasRouter.patch('/:id/permisos', auth(allRoles), patchCarpetaPermisosController);
carpetasRouter.delete('/:id', auth(allRoles), deleteCarpetaController);

export default carpetasRouter;
