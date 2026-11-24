import {
  findDeviceByUserAndToken,
  findDeviceByToken,
  createDevice,
  reassignDevice,
  deactivateDeviceByToken,
  deleteInactiveDevices,
} from '../../adapters/db/devicesRepo';
import { Device } from '../dto/DeviceDTO';
import {
  sendPushNotificationToUser,
  sendPushNotificationToMultipleUsers,
  PushNotificationPayload
} from '../../adapters/comunications/expoPushNotifications';
import { BadRequestError } from '../../adapters/errors/AppError';

export interface RegisterDeviceInput {
  token: string;
  platform: 'ios' | 'android' | 'web';
  device_name?: string;
}

const isValidExpoToken = (token: string): boolean => {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
};

const isValidWebFcmToken = (token: string): boolean => {
  // FCM registration tokens are typically long URL-safe strings and may include ":".
  return token.length >= 100 && token.length <= 4096 && /^[A-Za-z0-9:_\-.]+$/.test(token);
};

type CacheDomain = 'solicitudesActividades' | 'kanban' | 'reportes' | 'licencias' | 'documentos' | 'horarios';
type CacheEvent = 'created' | 'updated' | 'deleted' | 'status_changed';

const inferDomainFromData = (data: Record<string, any>): CacheDomain => {
  const type = String(data.type || '').toLowerCase();

  if (type.includes('solicitud') || type.includes('actividad')) return 'solicitudesActividades';
  if (type.includes('objetivo') || type.includes('kanban')) return 'kanban';
  if (type.includes('reporte')) return 'reportes';
  if (type.includes('licencia')) return 'licencias';
  if (type.includes('turno') || type.includes('horario')) return 'horarios';

  return 'documentos';
};

const inferEventFromData = (data: Record<string, any>): CacheEvent => {
  const type = String(data.type || '').toLowerCase();

  if (type.includes('elimin') || type.includes('borr')) return 'deleted';
  if (type.includes('estado') || type.includes('aprobad') || type.includes('rechazad')) return 'status_changed';
  if (type.includes('nuevo') || type.includes('nueva') || type.includes('cread')) return 'created';

  return 'updated';
};

const inferEntityIdFromData = (data: Record<string, any>): string | undefined => {
  const candidates = [
    data.entity_id,
    data.solicitud_id,
    data.actividad_id,
    data.objetivo_id,
    data.reporte_id,
    data.archivo_id,
    data.solicitudId,
  ];

  const entityId = candidates.find(value => value !== undefined && value !== null);
  return entityId !== undefined ? String(entityId) : undefined;
};

const normalizeNotificationPayload = (notification: PushNotificationPayload): PushNotificationPayload => {
  const data = (notification.data || {}) as Record<string, any>;
  const topLevelLink = typeof notification.link === 'string' ? notification.link.trim() : '';
  const dataLink = typeof data.link === 'string' ? data.link.trim() : '';
  const link = topLevelLink || dataLink || undefined;
  const domain = (data.domain as CacheDomain) || inferDomainFromData(data);
  const event = (data.event as CacheEvent) || inferEventFromData(data);
  const updatedAt = data.updated_at || new Date().toISOString();
  const entityId = inferEntityIdFromData(data);

  return {
    ...notification,
    ...(link ? { link } : {}),
    data: {
      ...data,
      ...(link ? { link } : {}),
      domain,
      event,
      updated_at: updatedAt,
      ...(entityId ? { entity_id: entityId } : {}),
    },
  };
};

/**
 * Registrar o actualizar un dispositivo
 */
export const registerDevice = async (
  userContextId: number,
  input: RegisterDeviceInput,
  ipAddress?: string,
  userAgent?: string
): Promise<{ device: Device; isNew: boolean }> => {
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const normalizedPlatform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : input.platform;
  const allowedPlatforms = ['ios', 'android', 'web'] as const;

  if (!token || token.length === 0) {
    throw new BadRequestError('Invalid token');
  }

  if (!allowedPlatforms.includes(normalizedPlatform as any)) {
    throw new BadRequestError('Invalid platform');
  }

  const platform = normalizedPlatform as RegisterDeviceInput['platform'];

  if (token.length > 1000) {
    throw new BadRequestError('Token too long');
  }

  if (platform === 'web' && !isValidWebFcmToken(token)) {
    throw new BadRequestError('Invalid web push token format');
  }

  if ((platform === 'ios' || platform === 'android') && !isValidExpoToken(token)) {
    throw new BadRequestError('Invalid Expo push token format');
  }

  // Verificar si el dispositivo ya existe para este usuario
  const existingDevice = await findDeviceByUserAndToken(userContextId, token);

  if (existingDevice) {
    // Reactivar (por si fue desactivado tras un DeviceNotRegistered) y refrescar metadata/last_active
    const updated = await reassignDevice(
      existingDevice.id,
      userContextId,
      platform,
      input.device_name,
      ipAddress,
      userAgent
    );
    return { device: updated, isNew: false };
  }

  // Verificar si el push_token ya existe para OTRO usuario (mismo dispositivo físico, distinto login)
  const existingByToken = await findDeviceByToken(token);

  if (existingByToken) {
    // Reasignar el dispositivo al nuevo usuario
    const reassigned = await reassignDevice(
      existingByToken.id,
      userContextId,
      platform,
      input.device_name,
      ipAddress,
      userAgent
    );
    return { device: reassigned, isNew: false };
  }

  // Crear nuevo dispositivo
  const newDevice = await createDevice(
    userContextId,
    token,
    platform,
    input.device_name,
    ipAddress,
    userAgent
  );

  return { device: newDevice, isNew: true };
};

/**
 * Desactivar un dispositivo por push_token (usado en logout)
 */
export const removeDeviceByToken = async (pushToken: string): Promise<void> => {
  await deactivateDeviceByToken(pushToken);
};

/**
 * Limpiar dispositivos inactivos (cron job)
 */
export const cleanupInactiveDevices = async (daysInactive: number = 30): Promise<number> => {
  return await deleteInactiveDevices(daysInactive);
};

/**
 * Enviar notificación a un usuario
 */
export const sendNotificationToUser = async (
  userContextId: number,
  notification: PushNotificationPayload
): Promise<{ success: boolean; sentCount: number; errors: string[] }> => {
  return await sendPushNotificationToUser(userContextId, normalizeNotificationPayload(notification));
};

/**
 * Enviar notificación a múltiples usuarios
 */
export const sendNotificationToMultipleUsers = async (
  userContextIds: number[],
  notification: PushNotificationPayload
): Promise<{
  success: boolean;
  results: Map<number, { sentCount: number; errors: string[] }>;
  totalSent: number;
}> => {
  return await sendPushNotificationToMultipleUsers(userContextIds, normalizeNotificationPayload(notification));
};
