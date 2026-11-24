import { createUser, findUserByUsername, findUserByEmail, findUserById, updateUser, updateUserPassword, updateUserRole, getAllUsers, getUsuarioEntidadByNombreApellido, getUsuariosByRole, getUsuarioEntidadCompleto, getUsuarioEntidadByContextId, getUsuarioIdsByRoles, getUsuarioIdsByEntorno, getUsuarioIdsByMultiplesEntornos, getAllUsuarioIdsExcept, bajaUsuarioAtomica } from "../../adapters/db/usuariosRepo";
import { getIdRolPublico } from "../../adapters/db/rolesRepo";
import { validateNewUser } from "../validations/usuariosValidations";
import { UsuarioDTO, UsuarioWithPasswordDTO, CreateUsuarioDTO, UsuarioEntidadDTO } from "../dto/UsuarioDTO";
import argon2 from 'argon2';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../../adapters/errors/AppError";

// Configuración Argon2id
const ARGON2_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 2 ** 14,     // 19 MiB (16384 KB)
  timeCost: 2,             // 2 iteraciones
  parallelism: 1,          // 1 grado de paralelismo
};

// Hash dummy pre-generado con la misma config Argon2id para mitigar timing attacks
// (se usa cuando el usuario no existe, para igualar el tiempo de respuesta)
const DUMMY_HASH = '$argon2id$v=19$m=16384,t=2,p=1$O4r7srUhNu4BpT0iHm/B8w$uKP+r3u6Xz5DS9v/V5k5ikb3Mu871s6YBanILqcL1L8';

/**
 * Prepara los datos del usuario para creación (hash password, validaciones)
 */
export const prepareUserForCreation = async (userData: CreateUsuarioDTO) => {
    const { username, email, password, nombre, apellido } = userData;

    // 1. Validaciones de negocio
    if (!username || !email || !password || !nombre || !apellido) {
        throw new BadRequestError('Username, email, password, nombre y apellido son requeridos');
    }

    // 2. Verificar nuevo usuario
    const verifiedUser = await validateNewUser({ username, nombre, apellido, email, password });

    // 4. Hash seguro de la contraseña con Argon2id
    const hashedPassword = await argon2.hash(password, ARGON2_CONFIG);

    return {
        username,
        email,
        password: hashedPassword,
        nombre,
        apellido,
    };
};

/**
 * Crea un nuevo usuario
 * El usuario podrá hacer login y recibirá un token readonly si no tiene asociación
 */
export const createNewUser = async (userData: CreateUsuarioDTO): Promise<UsuarioDTO> => {
    // 1. Preparar y validar datos
    const preparedData = await prepareUserForCreation(userData);

    // 2. Crear usuario en la base de datos
    const user = await createUser(preparedData);

    return user;
};

export const validateUserCredentials = async (identifier: string, password: string): Promise<UsuarioDTO | null> => {
    // Detectar si el identifier es email o username
    const isEmail = identifier.includes('@');

    // Buscar usuario por email o username
    const user = isEmail
        ? await findUserByEmail(identifier)
        : await findUserByUsername(identifier);

    if (!user) {
        // Verificar contra hash dummy para igualar el tiempo de respuesta (mitigación timing attack)
        await argon2.verify(DUMMY_HASH, password);
        return null;
    }

    // Verificar contraseña con Argon2
    const isValid = await argon2.verify(user.password, password);

    if (!isValid) {
        return null;
    }

    // Retornar usuario sin contraseña
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
};

export const updatePassword = async (userId: number, oldPassword: string, newPassword: string): Promise<boolean> => {
    // 1. Validaciones de entrada
    if (!userId || !newPassword) {
        throw new BadRequestError('ID de usuario y nueva contraseña son requeridos');
    }

    // 2. Verificar que la contraseña antigua es correcta
    const existingUserWithPassword = await findUserById(userId);
    if (!existingUserWithPassword) {
        throw new NotFoundError('Usuario no encontrado');
    }
    const isOldPasswordValid = await argon2.verify(existingUserWithPassword.password, oldPassword);
    if (!isOldPasswordValid) {
        throw new UnauthorizedError('Contraseña antigua incorrecta');
    }

    if (newPassword.length < 8) {
        throw new BadRequestError('La contraseña debe tener al menos 8 caracteres');
    }

    // 2. Verificar que el usuario existe ANTES del hash costoso
    const existingUser = await findUserById(userId);
    if (!existingUser) {
        throw new NotFoundError('Usuario no encontrado');
    }

    // 3. Hash seguro de la nueva contraseña con Argon2id
    const hashedPassword = await argon2.hash(newPassword, ARGON2_CONFIG);

    // 4. Actualizar la contraseña en la base de datos
    const success = await updateUserPassword(userId, hashedPassword);

    if (!success) {
        throw new Error('Error al actualizar la contraseña');
    }

    return true;
};

/**
 * Obtiene un usuario por su ID
 */
export const getUserById = async (userId: number): Promise<UsuarioDTO> => {
    if (!userId) {
        throw new BadRequestError('ID de usuario es requerido');
    }

    const user = await findUserById(userId);

    if (!user) {
        throw new NotFoundError('Usuario no encontrado');
    }

    return user;
};

/**
 * Obtiene todos los usuarios del sistema
 */
export const getUsers = async (): Promise<UsuarioDTO[]> => {
    const users = await getAllUsers();
    return users;
};

/**
 * Actualiza los datos de un usuario (username, email)
 */
export const updateUserData = async (
    userId: number,
    userData: { username?: string, email?: string }
): Promise<UsuarioDTO> => {
    // 1. Validaciones de entrada
    if (!userId) {
        throw new BadRequestError('ID de usuario es requerido');
    }

    if (!userData.username && !userData.email) {
        throw new BadRequestError('Al menos un campo debe ser proporcionado para actualizar');
    }

    // 2. Verificar que el usuario existe
    const existingUser = await findUserById(userId);
    if (!existingUser) {
        throw new NotFoundError('Usuario no encontrado');
    }

    // 3. Verificar duplicados si se actualiza username
    if (userData.username && userData.username !== existingUser.username) {
        const duplicateUsername = await findUserByUsername(userData.username);
        if (duplicateUsername) {
            throw new ConflictError('Ya existe un usuario con ese username');
        }
    }

    // 4. Verificar duplicados si se actualiza email
    if (userData.email && userData.email !== existingUser.email) {
        const duplicateEmail = await findUserByEmail(userData.email);
        if (duplicateEmail) {
            throw new ConflictError('Ya existe un usuario con ese email');
        }
    }

    // 5. Actualizar usuario
    const updatedUser = await updateUser(userId, userData);

    if (!updatedUser) {
        throw new Error('Error al actualizar el usuario');
    }

    return updatedUser;
};

/**
 * Actualiza el rol de un usuario
 */
export const updateUserRoleService = async (userId: number, newRoleId: number): Promise<boolean> => {
    // 1. Validaciones de entrada
    if (!userId || !newRoleId) {
        throw new Error('Usuario o rol desconocido');
    }

    // 2. Verificar que el usuario existe
    const existingUser = await getUsuarioEntidadByContextId(userId);
    if (!existingUser) {
        throw new NotFoundError('Usuario no encontrado');
    }

    // 4. Actualizar el rol
    const success = await updateUserRole(userId, newRoleId);

    if (!success) {
        throw new Error('Error al actualizar el rol del usuario');
    }

    return true;
};

/**
 * Busca usuarios por nombre y/o apellido
 * @param searchTerm - Término de búsqueda
 * @returns Array de usuarios que coinciden con la búsqueda
 */
export const searchUsuariosByNombreApellido = async (searchTerm: string): Promise<UsuarioEntidadDTO[]> => {
    if (!searchTerm || searchTerm.trim().length === 0) {
        throw new BadRequestError('El término de búsqueda es requerido');
    }

    const users = await getUsuarioEntidadByNombreApellido(searchTerm.trim());
    return users;
};

/**
 * Busca usuarios por rol
 * @param roleName - Nombre del rol a buscar
 * @returns Array de usuarios con ese rol
 */
export const searchUsuariosByRole = async (roleName: string): Promise<UsuarioEntidadDTO[]> => {
    if (!roleName || roleName.trim().length === 0) {
        throw new BadRequestError('El nombre del rol es requerido');
    }

    const users = await getUsuariosByRole(roleName.trim());
    return users;
};

export const changePasswordService = async (userId: number, newPassword: string): Promise<boolean> => {
    if (!userId || !newPassword) {
        throw new BadRequestError('ID de usuario y nueva contraseña son requeridos');
    }

    if (newPassword.length < 8) {
        throw new BadRequestError('La contraseña debe tener al menos 8 caracteres');
    }

    // Verificar que el usuario existe ANTES del hash costoso
    const existingUser = await findUserById(userId);
    if (!existingUser) {
        throw new NotFoundError('Usuario no encontrado');
    }

    // Hash seguro de la nueva contraseña con Argon2id
    const hashedPassword = await argon2.hash(newPassword, ARGON2_CONFIG);

    // Actualizar la contraseña en la base de datos
    const success = await updateUserPassword(userId, hashedPassword);

    if (!success) {
        throw new Error('Error al actualizar la contraseña');
    }

    return true;
};

/**
 * Obtiene IDs de usuarios por roles específicos
 * @param roles - Array de nombres de roles
 * @param excludeUserContextId - ID de usuario a excluir (opcional)
 */
export const getUserIdsByRoles = async (roles: string[], excludeUserContextId?: number): Promise<number[]> => {
    return await getUsuarioIdsByRoles(roles, excludeUserContextId);
};

export const getUserContextById = async (userContextId: number): Promise<UsuarioEntidadDTO | null> => {
    return await getUsuarioEntidadByContextId(userContextId);
};

/**
 * Obtiene IDs de usuarios de un entorno específico
 * @param entorno - Nombre del entorno
 * @param excludeUserContextId - ID de usuario a excluir (opcional)
 */
export const getUserIdsByEntorno = async (entorno: string, excludeUserContextId?: number): Promise<number[]> => {
    return await getUsuarioIdsByEntorno(entorno, excludeUserContextId);
};

/**
 * Obtiene IDs de usuarios de múltiples entornos
 * @param entornos - Array de nombres de entornos
 */
export const getUserIdsByMultiplesEntornos = async (entornos: string[]): Promise<number[]> => {
    return await getUsuarioIdsByMultiplesEntornos(entornos);
};

/**
 * Obtiene IDs de todos los usuarios excepto uno específico
 * @param excludeUserContextId - ID de usuario a excluir
 */
export const getAllUserIdsExcept = async (excludeUserContextId: number): Promise<number[]> => {
    return await getAllUsuarioIdsExcept(excludeUserContextId);
};

/**
 * Da de baja un usuario completamente:
 * 1. Revoca todos sus refresh tokens activos
 * 2. Desactiva su entrada en la tabla personal (si corresponde)
 * 3. Elimina sus entradas de usuario_entidad
 * 4. Soft-delete del usuario (setea deleted_at)
 *
 * Solo puede ser ejecutado por un usuario con rol 'gerencia'
 *
 * @param usuarioId - ID del usuario a dar de baja
 * @param gerenteUserContextId - userContextId del gerente que ejecuta la acción
 * @returns Resumen de la operación
 */
export const bajaUsuarioService = async (
    usuarioId: number,
    gerenteUserContextId: number
): Promise<{ message: string; detalles: { tokenRevocados: boolean; personalDesactivado: boolean; usuarioDesactivado: boolean } }> => {
    const gerenteContext = await getUsuarioEntidadByContextId(gerenteUserContextId);
    if (!gerenteContext || gerenteContext.rol_nombre !== 'gerencia') {
        throw new ForbiddenError('No autorizado.');
    }

    if (usuarioId === gerenteContext.id_usuario) {
        throw new BadRequestError('Acción no válida.');
    }

    const bajaResult = await bajaUsuarioAtomica(usuarioId);

    return {
        message: `Usuario ${bajaResult.username} dado de baja exitosamente`,
        detalles: {
            tokenRevocados: true,
            personalDesactivado: bajaResult.personalDesactivado,
            usuarioDesactivado: bajaResult.usuarioDesactivado
        }
    };
};
