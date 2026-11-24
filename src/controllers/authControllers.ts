import { NextFunction, Request, Response } from "express";
import { loginUser, loginWithGoogle, rotateAccessToken, logoutUser, switchProfile } from "../domain/services/authServices";
import { removeDeviceByToken } from "../domain/services/devicesService";
import { asAppError, BadRequestError, UnauthorizedError } from "../adapters/errors/AppError";

export const loginController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email, password } = req.body;

    // Debe proporcionar username O email, pero no ambos
    if ((!username && !email) || (username && email)) {
      throw new BadRequestError("Por favor ingrese nombre de usuario o email.");
    }

    const identifier = username || email;

    const entornoHeader = req.headers['x-app-entorno'] as string;
    const ENTORNOS_VALIDOS = ['web', 'mayorista', 'interno'];
    if (!entornoHeader || !ENTORNOS_VALIDOS.includes(entornoHeader)) {
      throw new BadRequestError("Entorno no válido.");
    }

    const loginResult = await loginUser(identifier, password, entornoHeader);

    if (!loginResult) {
      throw new UnauthorizedError("Credenciales inválidas.");
    }

    // Si requiere asociación, devolver accessToken readonly
    if (loginResult.requiresAssociation) {
      return res.status(200).json({
        success: true,
        requiresAssociation: true,
        accessToken: loginResult.accessToken,
        message: 'Usuario no verificado. Debe asociar una cuenta para continuar.'
      });
    }

    // Login normal con tokens completos (unificado para todos los clientes)
    res.status(200).json({
      success: true,
      requiresAssociation: false,
      accessToken: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
      availableProfiles: loginResult.availableProfiles
    });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const googleLoginController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      throw new BadRequestError("Sesión inválida.");
    }

    const entornoHeader = req.headers['x-app-entorno'] as string;
    const ENTORNOS_VALIDOS = ['web', 'mayorista', 'interno'];
    if (!entornoHeader || !ENTORNOS_VALIDOS.includes(entornoHeader)) {
      throw new BadRequestError("Entorno de sesión no válido.");
    }

    const loginResult = await loginWithGoogle(idToken, entornoHeader);

    if (loginResult.requiresAssociation) {
      return res.status(200).json({
        success: true,
        requiresAssociation: true,
        accessToken: loginResult.accessToken,
        message: 'Usuario no verificado. Debe asociar una cuenta para continuar.'
      });
    }

    res.status(200).json({
      success: true,
      requiresAssociation: false,
      accessToken: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
      availableProfiles: loginResult.availableProfiles
    });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const refreshTokenController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetEntorno = req.headers['x-app-entorno'] as 'web' | 'mayorista' | 'interno';
    const result = await rotateAccessToken((req as any).dbToken, targetEntorno);

    res.status(200).json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      ...(result.environmentChanged !== undefined && { environmentChanged: result.environmentChanged }),
      ...(result.profile && { profile: result.profile }),
    });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const switchProfileController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { targetUserContextId } = req.body;

    if (!targetUserContextId || typeof targetUserContextId !== 'number') {
      throw new UnauthorizedError("No se pudo verificar el perfil. Por favor, iniciá sesión nuevamente.");
    }

    const result = await switchProfile((req as any).dbToken, targetUserContextId);

    res.status(200).json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      profile: result.profile
    });
  } catch (error) {
    next(asAppError(error, "No se pudo cambiar de perfil"));
  }
};

export const logoutController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken, pushToken } = req.body;

    if (!refreshToken) {
      throw new UnauthorizedError("No autorizado.");
    }

    await logoutUser(refreshToken);

    // Desactivar dispositivo si se envió el pushToken (mobile)
    if (pushToken) {
      try {
        await removeDeviceByToken(pushToken);
      } catch (err) {
        console.error('Error deactivating device on logout:', err);
      }
    }

    res.status(200).json({ success: true, message: "Sesión cerrada correctamente." });
  } catch (error) {
    next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};
