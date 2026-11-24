import { Router } from 'express';
import { auth } from '../adapters/auth/authPermisos';
import { allRoles, adminRoles } from '../types/roles';
import {
  registerDeviceController,
} from '../controllers/devicesController';

const devicesRouter = Router();

// Registrar dispositivo - todos los usuarios autenticados
devicesRouter.post('/', auth(allRoles), registerDeviceController);

export default devicesRouter;
