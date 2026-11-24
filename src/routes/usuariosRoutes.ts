import { Router } from 'express';
import { 
    createUserController,
    updatePasswordController, 
    getUserByIdController, 
    getUsersController, 
    updateUserController, 
    updateUserRoleController,
    searchUsuariosController,
    searchUsuariosByRoleController,
    changePasswordController,
    bajaUsuarioController
} from '../controllers/usuariosControllers';
import { auth } from '../adapters/auth/authPermisos';
import { managementRoles, allRoles, adminRoles } from '../types/roles';
import { generatePasswordTokenController, validateTokenController } from '../controllers/asociacionControllers';
import {
    passwordRecoveryRequestLimiter,
    passwordRecoveryRequestEmailLimiter,
    passwordRecoveryValidateLimiter,
    passwordRecoveryValidateEmailLimiter,
} from '../adapters/middlewares/rateLimiter';

const usuariosRouter = Router();

// POST routes
usuariosRouter.post('/', createUserController); // Crear nuevo usuario (registro público)

// GET routes
usuariosRouter.get('/', auth(managementRoles), getUsersController);
usuariosRouter.get('/search', auth(allRoles), searchUsuariosController);
usuariosRouter.get('/role/:roleName', auth(allRoles), searchUsuariosByRoleController);
usuariosRouter.get('/:id', auth(allRoles), getUserByIdController);

// PUT routes
usuariosRouter.put('/', auth(allRoles), updateUserController);
usuariosRouter.put('/password', auth(allRoles), updatePasswordController);
usuariosRouter.put('/:id/role', auth(['gerencia']), updateUserRoleController);
usuariosRouter.put('/forgot-password', passwordRecoveryRequestLimiter, passwordRecoveryRequestEmailLimiter, generatePasswordTokenController); // Ruta para recuperación de contraseña (sin auth)
usuariosRouter.put('/forgot-password/token', passwordRecoveryValidateLimiter, passwordRecoveryValidateEmailLimiter, validateTokenController); // Ruta para validar token de recuperación (sin auth)
usuariosRouter.put('/change-password', auth(['change_pass']), changePasswordController); // Ruta para cambio de contraseña (con auth)

// DELETE routes
usuariosRouter.delete('/:usuarioId/baja', auth(['gerencia']), bajaUsuarioController); // Dar de baja un usuario (solo gerencia)

export default usuariosRouter;