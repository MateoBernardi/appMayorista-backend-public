import { findUserByUsername, findUserByEmail } from "../../adapters/db/usuariosRepo";

// Regex para validar nombres y apellidos (solo letras, espacios, acentos, ñ)
const NOMBRE_REGEX = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,50}$/;

const validationError = (message: string): Error => {
    const err = new Error(message) as any;
    err.statusCode = 400;
    return err;
};

export const validateNombreApellido = (nombre: string, apellido: string) => {
    if (!nombre || !apellido) {
        throw validationError('Nombre y apellido son requeridos');
    }

    if (!NOMBRE_REGEX.test(nombre.trim())) {
        throw validationError('El nombre debe contener solo letras, espacios y tener entre 2-50 caracteres');
    }

    if (!NOMBRE_REGEX.test(apellido.trim())) {
        throw validationError('El apellido debe contener solo letras, espacios y tener entre 2-50 caracteres');
    }

    return true;
};

export const validateNewUser = async (UsuarioDTO: { username: string; email: string; password: string; nombre: string; apellido: string }) => {
    const { username, email, password, nombre, apellido } = UsuarioDTO;

    // Validaciones básicas
    if (!username || !email || !password) {
        throw validationError('Username, email y password son requeridos');
    }

    // Validar nombre y apellido con regex
    validateNombreApellido(nombre, apellido);

    // Verificar unicidad de username
    const existingUserByUsername = await findUserByUsername(username);
    if (existingUserByUsername) {
        throw validationError('Ya existe un usuario con ese username');
    }

    // Verificar unicidad de email
    const existingUserByEmail = await findUserByEmail(email);
    if (existingUserByEmail) {
        throw validationError('Ya existe un usuario con ese email');
    }

    return true;
};