import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import admin from 'firebase-admin';
import {
  getActiveDevicesByUserContext,
  deactivateDevice,
  saveNotificationLog,
  updateNotificationReceipt,
  getPendingTickets,
  getActiveDevicesByMultipleUserContexts
} from '../db/devicesRepo';
import { Device } from '../../domain/dto/DeviceDTO';

// Crear instancia del SDK de Expo
const expo = new Expo(
  process.env.TOKEN_EXPO ? { accessToken: process.env.TOKEN_EXPO } : {}
);

const NOTIFICATION_TIMEOUT_MS = 10000;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
};

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
};

const loadFirebaseServiceAccountFromEnv = (): admin.ServiceAccount => {
  const projectId = requiredEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requiredEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  return {
    projectId,
    clientEmail,
    privateKey,
  };
};

if (!admin.apps.length) {
  const hasFirebaseEnv =
    !!process.env.FIREBASE_PROJECT_ID ||
    !!process.env.FIREBASE_CLIENT_EMAIL ||
    !!process.env.FIREBASE_PRIVATE_KEY;

  if (hasFirebaseEnv) {
    admin.initializeApp({
      credential: admin.credential.cert(loadFirebaseServiceAccountFromEnv()),
    });
  } else {
    // Para desarrollo local
    const serviceAccount = require('../../../service_key.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

const toFcmData = (data?: Record<string, unknown>): Record<string, string> | undefined => {
  if (!data) return undefined;

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const withPayloadLink = (payload: PushNotificationPayload): Record<string, unknown> | undefined => {
  const baseData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? { ...(payload.data as Record<string, unknown>) }
    : {};

  if (payload.link) {
    baseData.link = payload.link;
  }

  return Object.keys(baseData).length > 0 ? baseData : undefined;
};

const sendExpoNotifications = async (
  userContextId: number,
  devices: Device[],
  payload: PushNotificationPayload,
): Promise<{ sentCount: number; errors: string[] }> => {
  const validExpoDevices = devices.filter(device => Expo.isExpoPushToken(device.push_token));

  if (validExpoDevices.length === 0) {
    return { sentCount: 0, errors: [] };
  }

  const notificationData = withPayloadLink(payload);

  const messages: ExpoPushMessage[] = validExpoDevices.map(device => {
    const message: ExpoPushMessage = {
      to: device.push_token,
      body: payload.body,
    };

    if (payload.sound !== undefined) message.sound = payload.sound;
    if (payload.title) message.title = payload.title;
    if (notificationData) message.data = notificationData;
    if (payload.badge) message.badge = payload.badge;
    if (payload.channelId) message.channelId = payload.channelId;
    if (payload.priority) message.priority = payload.priority;

    return message;
  });

  const errors: string[] = [];
  let sentCount = 0;
  let offset = 0;

  const messageChunks = expo.chunkPushNotifications(messages);
  for (const chunk of messageChunks) {
    const chunkDevices = validExpoDevices.slice(offset, offset + chunk.length);
    offset += chunk.length;

    try {
      const ticketChunk = await withTimeout(
        expo.sendPushNotificationsAsync(chunk),
        NOTIFICATION_TIMEOUT_MS,
        'Expo send',
      );

      for (let i = 0; i < ticketChunk.length; i++) {
        const ticket = ticketChunk[i];
        const device = chunkDevices[i];

        if (!ticket || !device) continue;

        if (ticket.status === 'error') {
          const errorCode = 'details' in ticket && ticket.details?.error ? ticket.details.error : 'Unknown';
          const errorMessage = `${errorCode}`;
          errors.push(errorMessage);

          await saveNotificationLog(
            device.id,
            userContextId,
            payload.title,
            payload.body,
            notificationData,
            'error',
            undefined,
            errorMessage,
          );

          if (errorCode === 'DeviceNotRegistered') {
            await deactivateDevice(device.id);
          }
          continue;
        }

        sentCount++;
        const ticketId = 'id' in ticket ? ticket.id : undefined;
        await saveNotificationLog(
          device.id,
          userContextId,
          payload.title,
          payload.body,
          notificationData,
          'sent',
          ticketId,
          undefined,
        );
      }
    } catch (error: any) {
      const message = error?.message || 'Error sending Expo notification chunk';
      console.error('[Expo]', message);
      errors.push(message);

      for (const device of chunkDevices) {
        await saveNotificationLog(
          device.id,
          userContextId,
          payload.title,
          payload.body,
          notificationData,
          'error',
          undefined,
          message,
        );
      }
    }
  }

  return { sentCount, errors };
};

const sendWebNotifications = async (
  userContextId: number,
  devices: Device[],
  payload: PushNotificationPayload,
): Promise<{ sentCount: number; errors: string[] }> => {
  if (devices.length === 0) {
    return { sentCount: 0, errors: [] };
  }

  const errors: string[] = [];
  let sentCount = 0;
  const maxTokensPerBatch = 500;
  const notificationData = withPayloadLink(payload);

  for (let start = 0; start < devices.length; start += maxTokensPerBatch) {
    const batchDevices = devices.slice(start, start + maxTokensPerBatch);
    const tokens = batchDevices.map(device => device.push_token);

    try {
      const firebaseNotification: { title?: string; body: string } = {
        body: payload.body,
      };
      const messageData = toFcmData(notificationData);

      const multicastMessage: admin.messaging.MulticastMessage = {
        tokens,
        notification: firebaseNotification,
      };

      if (payload.title !== undefined) {
        firebaseNotification.title = payload.title;
      }

      if (messageData) {
        multicastMessage.data = messageData;
      }

      if (payload.link) {
        multicastMessage.webpush = {
          fcmOptions: {
            link: payload.link,
          },
        };
      }

      const response = await withTimeout(
        admin.messaging().sendEachForMulticast(multicastMessage),
        NOTIFICATION_TIMEOUT_MS,
        'FCM send',
      );

      for (let i = 0; i < response.responses.length; i++) {
        const item = response.responses[i];
        const device = batchDevices[i];

        if (!item || !device) continue;

        if (!item.success) {
          const code = item.error?.code;
          const message = item.error?.message || 'Unknown FCM error';
          const fullMessage = code ? `[web] ${code}: ${message}` : `[web] ${message}`;
          errors.push(fullMessage);

          await saveNotificationLog(
            device.id,
            userContextId,
            payload.title,
            payload.body,
            notificationData,
            'error',
            undefined,
            fullMessage,
          );

          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            await deactivateDevice(device.id);
          }

          continue;
        }

        sentCount++;
        await saveNotificationLog(
          device.id,
          userContextId,
          payload.title,
          payload.body,
          notificationData,
          'delivered',
          item.messageId,
          undefined,
          new Date(),
        );
      }
    } catch (error: any) {
      const batchError = `[web] ${error?.message || 'Error sending FCM web notification batch'}`;
      console.error(batchError);
      errors.push(batchError);

      for (const device of batchDevices) {
        await saveNotificationLog(
          device.id,
          userContextId,
          payload.title,
          payload.body,
          notificationData,
          'error',
          undefined,
          batchError,
        );
      }
    }
  }

  return { sentCount, errors };
};

export interface PushNotificationPayload {
  title?: string;
  body: string;
  data?: any;
  link?: string;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}

/**
 * Enviar notificación push a un usuario específico
 */
export const sendPushNotificationToUser = async (
  userContextId: number,
  payload: PushNotificationPayload
): Promise<{ success: boolean; sentCount: number; errors: string[] }> => {
  try {
    const devices = await getActiveDevicesByUserContext(userContextId);

    if (devices.length === 0) {
      return { success: true, sentCount: 0, errors: [] };
    }

    const webDevices = devices.filter(device => device.platform === 'web');
    const mobileDevices = devices.filter(device => device.platform !== 'web');

    const [expoResult, webResult] = await Promise.all([
      sendExpoNotifications(userContextId, mobileDevices, payload),
      sendWebNotifications(userContextId, webDevices, payload),
    ]);

    const sentCount = expoResult.sentCount + webResult.sentCount;
    const errors = [...expoResult.errors, ...webResult.errors];

    return {
      success: errors.length === 0,
      sentCount,
      errors,
    };
  } catch (error: any) {
    console.error('Error in sendPushNotificationToUser:', error);
    return {
      success: false,
      sentCount: 0,
      errors: [error.message || 'Unknown error'],
    };
  }
};

/**
 * Verificar receipts de notificaciones enviadas
 * Este método debe ejecutarse periódicamente (ej: cada 15 minutos)
 * para verificar el estado final de las notificaciones
 */
export const checkNotificationReceipts = async (): Promise<void> => {
  try {
    // Obtener tickets pendientes de la última hora
    const ticketIds = await getPendingTickets(1);

    if (ticketIds.length === 0) {
      return;
    }


    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(ticketIds);

    for (const chunk of receiptIdChunks) {
      try {
        const receipts = await withTimeout(
          expo.getPushNotificationReceiptsAsync(chunk),
          NOTIFICATION_TIMEOUT_MS,
          'Expo receipts',
        );

        for (const ticketId in receipts) {
          const receipt = receipts[ticketId];

          if (!receipt) continue;

          if (receipt.status === 'error') {
            const errorMessage = 'message' in receipt && receipt.message ? receipt.message : 'Unknown error';
            const errorCode = 'details' in receipt && receipt.details?.error ? receipt.details.error : 'Unknown code';
            console.error(`Error in receipt for ${ticketId}: [${errorCode}] ${errorMessage}`);

            const log = await updateNotificationReceipt(
              ticketId,
              'error',
              undefined,
              errorMessage
            );

            if (errorCode === 'DeviceNotRegistered' && log?.device_id) {
              await deactivateDevice(log.device_id);
            }
          } else if (receipt.status === 'ok') {
            await updateNotificationReceipt(
              ticketId,
              'delivered',
              ticketId,
              undefined
            );
          }
        }
      } catch (error) {
        console.error('Error checking receipts chunk:', error);
      }
    }

  } catch (error) {
    console.error('Error in checkNotificationReceipts:', error);
  }
};

export const sendPushNotificationToMultipleUsers = async (
  userContextIds: number[],
  payload: PushNotificationPayload,
  batchSize = 50,
): Promise<{
  success: boolean;
  results: Map<number, { sentCount: number; errors: string[] }>;
  totalSent: number;
}> => {
  try {
    const devicesByUser = await withTimeout(
      getActiveDevicesByMultipleUserContexts(userContextIds),
      NOTIFICATION_TIMEOUT_MS,
      'DB getActiveDevices',
    );

    const results = new Map<number, { sentCount: number; errors: string[] }>();
    let totalSent = 0;

    for (let i = 0; i < userContextIds.length; i += batchSize) {
      const batch = userContextIds.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (userContextId) => {
          const devices = devicesByUser.get(userContextId) ?? [];

          if (devices.length === 0) {
            return { userContextId, sentCount: 0, errors: [] };
          }

          const webDevices = devices.filter(d => d.platform === 'web');
          const mobileDevices = devices.filter(d => d.platform !== 'web');

          const [expoResult, webResult] = await Promise.all([
            sendExpoNotifications(userContextId, mobileDevices, payload),
            sendWebNotifications(userContextId, webDevices, payload),
          ]);

          return {
            userContextId,
            sentCount: expoResult.sentCount + webResult.sentCount,
            errors: [...expoResult.errors, ...webResult.errors],
          };
        })
      );

      for (const { userContextId, sentCount, errors } of batchResults) {
        results.set(userContextId, { sentCount, errors });
        totalSent += sentCount;
      }
    }

    return {
      success: Array.from(results.values()).every(r => r.errors.length === 0),
      results,
      totalSent,
    };
  } catch (error: any) {
    console.error('Error in sendPushNotificationToMultipleUsers:', error);
    return {
      success: false,
      results: new Map(),
      totalSent: 0,
    };
  }
};