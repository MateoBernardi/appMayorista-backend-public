import { NextFunction, Request, Response } from 'express';
import { solicitarAsociacion, verificarAsociacion } from '../domain/services/asociacionServices';
import { revocarTokensActivos, sendVerificationToken, validateVerificationToken } from '../domain/services/verificationTokenServices';
import { findUserByEmail } from '../adapters/db/usuariosRepo';
import { generateAccessToken } from '../domain/validations/authValidations';
import { TokenPurpose } from '../types/tokenPurpose';
import { asAppError, BadRequestError, UnauthorizedError } from '../adapters/errors/AppError';

const ENTORNOS_VALIDOS = ['web', 'mayorista', 'interno'] as const;
type Entorno = typeof ENTORNOS_VALIDOS[number];

const leerEntorno = (req: Request): Entorno => {
    const entorno = req.headers['x-app-entorno'];
    if (typeof entorno !== 'string' || !(ENTORNOS_VALIDOS as readonly string[]).includes(entorno)) {
        throw new BadRequestError('Entorno no válido.');
    }
    return entorno as Entorno;
};

/**
 * PASO 1: Solicitar códigos de verificación
 * POST /asociar
 * Body: { cuit: string } (cualquier otro campo se ignora)
 * Requiere: accessToken con rol readonly y header x-app-entorno
 *
 * El servidor busca las cuentas de ese CUIT en el entorno y manda un código distinto
 * al email registrado de cada una. Solo devuelve los destinos enmascarados.
 */
export const requestVerificationTokenController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const cuit = typeof req.body?.cuit === 'string' ? req.body.cuit.trim() : '';

        if (!userId) {
            throw new UnauthorizedError('No autorizado.');
        }

        if (!cuit) {
            throw new BadRequestError('El CUIT es requerido');
        }

        const { destinos } = await solicitarAsociacion(userId, cuit, leerEntorno(req));

        res.status(200).json({
            success: true,
            message: 'Te enviamos un código al email registrado de cada cuenta.',
            destinos
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

/**
 * PASO 2: Validar código y completar asociación
 * POST /asociar/verify
 * Body: { token: string } (cualquier otro campo se ignora)
 * Requiere: accessToken con rol readonly y header x-app-entorno
 *
 * La cuenta a asociar es la del código que coincide (guardada del lado del servidor).
 */
export const verifyAndAssociateController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const token = req.body?.token;

        if (!userId) {
            throw new UnauthorizedError('No autorizado.');
        }

        if (!token || (typeof token !== 'string' && typeof token !== 'number')) {
            throw new BadRequestError('Por favor ingresá el token de verificación.');
        }

        const result = await verificarAsociacion(userId, String(token), leerEntorno(req), req.user?.entorno);

        return res.status(201).json({
            success: true,
            requiresAssociation: false,
            message: 'Cuenta asociada exitosamente.',
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            asociacion: result.asociacion
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const generatePasswordTokenController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email } = req.body;

        if (!email) {
            throw new BadRequestError('Por favor ingresá tu email para recibir el token de recuperación de contraseña.');
        }

        const user = await findUserByEmail(email);
        if (!user) {
            // Respuesta genérica para evitar enumeración de usuarios
            return res.status(200).json({
                success: true,
                message: 'Token de recuperación de contraseña generado y enviado al correo proporcionado.'
            });
        }

        // Un pedido nuevo invalida los códigos de recuperación anteriores
        await revocarTokensActivos(user.id, TokenPurpose.PASSWORD_RESET);

        // Enviar token de recuperación de contraseña
        await sendVerificationToken(
            user.id,
            user.email,
            'email',
            null,  // created_by es null cuando es creado por el sistema
            TokenPurpose.PASSWORD_RESET  // purpose específico para recuperación de contraseña
        );


        res.status(200).json({
            success: true,
            message: 'Token de recuperación de contraseña generado y enviado al correo proporcionado.'
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
}

export const validateTokenController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, token } = req.body;

        if (!email || !token) {
            throw new BadRequestError('Por favor, ingresá el token de verificación.');
        }

        const user = await findUserByEmail(email);
        if (!user) {
            throw new UnauthorizedError('Ocurrió un error al validar el token. Por favor, intentá de nuevo.');
        }

        const validationResult = await validateVerificationToken(user.id, String(token), TokenPurpose.PASSWORD_RESET);

        if (!validationResult.success) {
            throw new UnauthorizedError(validationResult.message);
        }

        const accessToken = generateAccessToken(
            user.id,
            'change_pass', // Rol temporal readonly para permitir cambiar contraseña
            {
                userContextId: null,
                entidadTipoId: null,
                entidadId: null,
                entorno: null
            }
        );

        res.status(200).json({
            success: true,
            message: 'Token válido. Podés proceder a cambiar tu contraseña.',
            accessToken
        });
    } catch (error) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
