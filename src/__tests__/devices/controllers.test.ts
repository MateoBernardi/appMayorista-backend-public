/**
 * Tests de controllers: devicesController
 * Capa: Controller
 */

jest.mock('../../domain/services/devicesService');

import { createMockReqRes } from '../helpers/testHelpers';
import { registerDeviceController } from '../../controllers/devicesController';
import * as devicesService from '../../domain/services/devicesService';

const service = jest.mocked(devicesService);

describe('Devices Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('registerDeviceController', () => {
    it('deberia retornar 400 si faltan token o platform', async () => {
      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { token: 'abc' },
      });

      await registerDeviceController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(service.registerDevice).not.toHaveBeenCalled();
    });

    it('deberia retornar 401 si falta userContextId', async () => {
      const { req, res, next } = createMockReqRes({
        user: {},
        body: { token: 'abc', platform: 'web' },
      });

      await registerDeviceController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
      expect(service.registerDevice).not.toHaveBeenCalled();
    });

    it('deberia normalizar platform a minusculas antes de registrar', async () => {
      service.registerDevice.mockResolvedValue({
        isNew: true,
        device: { id: 50 } as any,
      });

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { token: 'a'.repeat(140), platform: 'WEB', device_name: 'Chrome PWA' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      await registerDeviceController(req, res, next);

      expect(service.registerDevice).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ token: 'a'.repeat(140), platform: 'web', device_name: 'Chrome PWA' }),
        expect.anything(),
        undefined
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          device_id: 50,
          message: 'Device registered successfully',
        })
      );
    });

    it('deberia retornar 500 cuando el token web es invalido', async () => {
      service.registerDevice.mockRejectedValue(new Error('Ocurrió un error'));

      const { req, res, next } = createMockReqRes({
        user: { userContextId: 10 },
        body: { token: 'short', platform: 'web' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      await registerDeviceController(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 500,
        message: 'No se pudo registrar el dispositivo',
      }));
    });
  });
});
