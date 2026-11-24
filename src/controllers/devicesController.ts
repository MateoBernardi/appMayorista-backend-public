import { NextFunction, Request, Response } from 'express';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import { registerDevice } from '../domain/services/devicesService';

/**
 * POST /api/devices
 * Registrar un nuevo dispositivo o actualizar existente
 */
export const registerDeviceController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, platform, device_name } = req.body;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : platform;

    // Validar campos requeridos
    if (!token || !normalizedPlatform) {
      throw new BadRequestError('Missing required fields: token and platform');
    }

    // Obtener userContextId del token JWT (añadido por middleware auth)
    const userContextId = requireUserContextId(req);

    // Obtener IP y User-Agent
    const ipAddress = (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;
    const userAgent = req.headers['user-agent'];

    // Registrar dispositivo
    const result = await registerDevice(
      userContextId,
      { token, platform: normalizedPlatform, device_name },
      ipAddress,
      userAgent
    );

    return res.status(200).json({
      success: true,
      device_id: result.device.id,
      message: result.isNew ? 'Device registered successfully' : 'Device already registered, updated',
    });
  } catch (error) {
    console.error('Error in registerDeviceController:', error);
    next(asAppError(error, 'No se pudo registrar el dispositivo'));
  }
};

