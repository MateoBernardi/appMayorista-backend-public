import { NextFunction, Request, Response } from 'express';
import {
    createNewUser,
    updatePassword,
    getUserById,
    getUsers,
    updateUserData,
    updateUserRoleService,
    searchUsuariosByNombreApellido,
    searchUsuariosByRole,
    changePasswordService,
    bajaUsuarioService
} from '../domain/services/usuariosServices';
import { CreateUsuarioDTO } from '../domain/dto/UsuarioDTO';
import { asAppError, BadRequestError, NotFoundError, UnauthorizedError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';

/**
 * Crear un nuevo usuario
 * POST /usuarios
 */
export const createUserController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { username, email, password, nombre, apellido } = req.body;

        if (!username || !email || !password || !nombre || !apellido) {
            throw new BadRequestError('Por favor, rellená todos los campos requeridos.');
        }

        const userData: CreateUsuarioDTO = {
            username,
            email,
            password,
            nombre,
            apellido,
        };

        const newUser = await createNewUser(userData);

        res.status(201).json({
            success: true,
            message: 'Usuario creado exitosamente.',
            data: newUser
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Actualizar contraseña de usuario
 * PUT /usuarios/:id/password
 */
export const updatePasswordController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.user?.userId;
        const { oldPassword, newPassword } = req.body;

        if (!id) {
            throw new UnauthorizedError('No autorizado.');
        }

        if (!oldPassword || !newPassword) {
            throw new BadRequestError('Por favor, proporcioná la contraseña antigua y la nueva contraseña.');
        }

        const success = await updatePassword(id, oldPassword, newPassword);

        res.status(200).json({
            success: true,
            message: 'Contraseña actualizada exitosamente.'
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Obtener usuario por ID
 * GET /usuarios/:id
 */
export const getUserByIdController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;

        if (!id) {
            throw new NotFoundError('Usuario no encontrado.');
        }

        const user = await getUserById(parseInt(id));

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Obtener todos los usuarios
 * GET /usuarios
 */
export const getUsersController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const users = await getUsers();

        res.status(200).json({
            success: true,
            data: users
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Actualizar datos de usuario (username, email)
 * PUT /usuarios/:id
 */
export const updateUserController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.user?.userId;
        const { username, email} = req.body;

        if (!id) {
            throw new UnauthorizedError('No autorizado.');
        }

        const updatedUser = await updateUserData(id, { username, email });

        res.status(200).json({
            success: true,
            message: 'Usuario actualizado exitosamente.',
            data: updatedUser
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Actualizar rol de usuario
 * PUT /usuarios/:id/role
 */
export const updateUserRoleController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const { roleId } = req.body;

        if (!id || !roleId) {
            throw new NotFoundError('Usuario no encontrado');
        }

        const success = await updateUserRoleService(parseInt(id), roleId);

        res.status(200).json({
            success: true,
            message: 'Rol de usuario actualizado exitosamente.'
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Buscar usuarios por nombre y/o apellido
 * GET /usuarios/search?q=termino
 */
export const searchUsuariosController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { q } = req.query;

        if (!q || typeof q !== 'string') {
            throw new BadRequestError('El parámetro de búsqueda es requerido');
        }

        const users = await searchUsuariosByNombreApellido(q);

        res.status(200).json({
            success: true,
            data: users
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Buscar usuarios por rol
 * GET /usuarios/role/:roleName
 */
export const searchUsuariosByRoleController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const roleName = req.params.roleName as string;

        if (!roleName) {
            throw new NotFoundError('Rol no encontrado.');
        }

        const usuarios = await searchUsuariosByRole(roleName);

        res.status(200).json({
            success: true,
            data: usuarios
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const changePasswordController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.user?.userId;
        const { newPassword } = req.body;

        if (!id) {
            throw new UnauthorizedError('No autorizado.');
        }

        await changePasswordService(id, newPassword);

        res.status(200).json({
            success: true,
            message: 'Contraseña cambiada exitosamente.'
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * Dar de baja un usuario (solo gerencia)
 * DELETE /usuarios/:usuarioId/baja
 * El gerente viene en el accessToken
 */
export const bajaUsuarioController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const gerenteUserContextId = requireUserContextId(req);
        const gerenteUserId = req.user?.userId;
        const usuarioIdParam = req.params.usuarioId as string;

        if (!gerenteUserId) {
            throw new UnauthorizedError('No autorizado.');
        }

        if (!usuarioIdParam) {
            throw new NotFoundError('Usuario no encontrado.');
        }

        const usuarioId = parseInt(usuarioIdParam);

        if (isNaN(usuarioId)) {
            throw new NotFoundError('Usuario no encontrado.');
        }

        // No permitir darse de baja a sí mismo
        if (usuarioId === gerenteUserId) {
            throw new BadRequestError('Acción no válida.');
        }

        const resultado = await bajaUsuarioService(usuarioId, gerenteUserContextId);

        res.status(200).json({
            success: true,
            ...resultado
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
