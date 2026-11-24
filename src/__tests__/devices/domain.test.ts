/**
 * Tests de dominio: devicesService
 * Capa: Domain Service
 */

jest.mock('../../adapters/db/devicesRepo');
jest.mock('../../adapters/comunications/expoPushNotifications');

import * as devicesRepo from '../../adapters/db/devicesRepo';
import * as pushAdapter from '../../adapters/comunications/expoPushNotifications';
import {
  registerDevice,
  sendNotificationToUser,
  sendNotificationToMultipleUsers,
} from '../../domain/services/devicesService';

const repo = jest.mocked(devicesRepo);
const push = jest.mocked(pushAdapter);

const validExpoToken = 'ExponentPushToken[abcdefghijklmnopqrs]';
const validWebToken = 'a'.repeat(140);

describe('Devices Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.findDeviceByUserAndToken.mockResolvedValue(null);
    repo.findDeviceByToken.mockResolvedValue(null);
    repo.createDevice.mockResolvedValue({ id: 99 } as any);
    push.sendPushNotificationToUser.mockResolvedValue({ success: true, sentCount: 1, errors: [] });
    push.sendPushNotificationToMultipleUsers.mockResolvedValue({
      success: true,
      totalSent: 2,
      results: new Map(),
    });
  });

  describe('registerDevice', () => {
    it('deberia rechazar token web invalido', async () => {
      await expect(
        registerDevice(10, { token: 'short-token', platform: 'web' })
      ).rejects.toThrow('Invalid web push token format');
    });

    it('deberia rechazar token expo invalido para ios/android', async () => {
      await expect(
        registerDevice(10, { token: validWebToken, platform: 'ios' })
      ).rejects.toThrow('Invalid Expo push token format');
    });

    it('deberia aceptar platform en mayusculas y normalizar a web', async () => {
      await registerDevice(10, { token: validWebToken, platform: 'WEB' as any, device_name: 'PWA' });

      expect(repo.createDevice).toHaveBeenCalledWith(
        10,
        validWebToken,
        'web',
        'PWA',
        undefined,
        undefined
      );
    });

    it('deberia reactivar y refrescar el dispositivo si ya existe user+token', async () => {
      repo.findDeviceByUserAndToken.mockResolvedValue({ id: 7, is_active: false } as any);
      repo.reassignDevice.mockResolvedValue({ id: 7, is_active: true } as any);

      const result = await registerDevice(10, { token: validExpoToken, platform: 'android' });

      expect(result.isNew).toBe(false);
      expect(repo.reassignDevice).toHaveBeenCalledWith(
        7,
        10,
        'android',
        undefined,
        undefined,
        undefined
      );
      expect(repo.createDevice).not.toHaveBeenCalled();
    });

    it('deberia reasignar token cuando pertenece a otro usuario', async () => {
      repo.findDeviceByToken.mockResolvedValue({ id: 22, user_context_id: 44 } as any);
      repo.reassignDevice.mockResolvedValue({ id: 22, user_context_id: 10 } as any);

      const result = await registerDevice(10, { token: validExpoToken, platform: 'ios' });

      expect(result.isNew).toBe(false);
      expect(repo.reassignDevice).toHaveBeenCalledWith(
        22,
        10,
        'ios',
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('notifications', () => {
    it('deberia normalizar payload y delegar en adapter al enviar a un usuario', async () => {
      await sendNotificationToUser(10, {
        body: 'Cambios',
        link: '/app/licencias/123',
        data: { type: 'licencia_aprobada', solicitud_id: 123 },
      });

      expect(push.sendPushNotificationToUser).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          link: '/app/licencias/123',
          data: expect.objectContaining({
            link: '/app/licencias/123',
            domain: 'licencias',
            event: 'status_changed',
            entity_id: '123',
          }),
        })
      );
    });

    it('deberia delegar envio multiple en adapter', async () => {
      const result = await sendNotificationToMultipleUsers([10, 11], {
        body: 'Actualizacion',
        data: { type: 'nueva_actividad', actividad_id: 20 },
      });

      expect(push.sendPushNotificationToMultipleUsers).toHaveBeenCalledWith(
        [10, 11],
        expect.objectContaining({
          data: expect.objectContaining({
            domain: 'solicitudesActividades',
            event: 'created',
            entity_id: '20',
          }),
        })
      );
      expect(result.success).toBe(true);
    });
  });
});
