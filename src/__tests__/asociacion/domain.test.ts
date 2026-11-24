/**
 * Tests de dominio: asociacionServices
 * Capa: Domain Service
 * Plataforma: Transversal (asociación de cuentas)
 */

jest.mock('../../adapters/db/clientesRepo');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../adapters/db/personalRepo');
jest.mock('../../adapters/db/authRepo');
jest.mock('../../adapters/comunications/expoPushNotifications');
jest.mock('../../domain/services/verificationTokenServices');
jest.mock('../../domain/validations/authValidations');

import { solicitarAsociacion, verificarAsociacion } from '../../domain/services/asociacionServices';
import * as clientesRepo from '../../adapters/db/clientesRepo';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as personalRepo from '../../adapters/db/personalRepo';
import * as pushNotif from '../../adapters/comunications/expoPushNotifications';
import * as verificationService from '../../domain/services/verificationTokenServices';
import * as authValidations from '../../domain/validations/authValidations';
import { TokenPurpose } from '../../types/tokenPurpose';

const mockUsuariosRepo = jest.mocked(usuariosRepo);
const mockClientesRepo = jest.mocked(clientesRepo);
const mockPersonalRepo = jest.mocked(personalRepo);
const mockPush = jest.mocked(pushNotif);
const mockVerification = jest.mocked(verificationService);
const mockAuthValidations = jest.mocked(authValidations);

const cuenta = (id: number, contact: string, over: Record<string, unknown> = {}) => ({
  id,
  nombre: `Empleado ${id}`,
  tipo_entidad: 'empleado',
  tabla_origen: 'personal' as const,
  id_entidad_tipo: 1,
  entorno: 'interno' as const,
  cuit: '20123456789',
  contact,
  ...over,
});

const mockUser = { id: 1, username: 'jdoe', nombre: 'John', apellido: 'Doe', email: 'jdoe@test.com' };

describe('AsociacionServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // ──────────── solicitarAsociacion ────────────

  describe('solicitarAsociacion', () => {
    it('busca las cuentas del CUIT en el entorno y manda un código distinto a cada email, atado a su entidad', async () => {
      mockUsuariosRepo.findCuentasPorCuit.mockResolvedValue([
        cuenta(10, 'uno@empresa.com'),
        cuenta(11, 'dos@empresa.com'),
      ] as any);

      const res = await solicitarAsociacion(1, '20123456789', 'interno');

      expect(mockUsuariosRepo.findCuentasPorCuit).toHaveBeenCalledWith('20123456789', 'interno');
      expect(mockVerification.revocarTokensActivos).toHaveBeenCalledWith(1, TokenPurpose.ACCOUNT_ASSOCIATION);
      expect(mockVerification.sendVerificationToken).toHaveBeenCalledTimes(2);
      expect(mockVerification.sendVerificationToken).toHaveBeenNthCalledWith(
        1, 1, 'uno@empresa.com', 'email', null, TokenPurpose.ACCOUNT_ASSOCIATION, { entidadId: 10, entidadTipoId: 1 },
      );
      expect(mockVerification.sendVerificationToken).toHaveBeenNthCalledWith(
        2, 1, 'dos@empresa.com', 'email', null, TokenPurpose.ACCOUNT_ASSOCIATION, { entidadId: 11, entidadTipoId: 1 },
      );
      // Solo destinos enmascarados: ni ids, ni nombres, ni emails completos
      expect(res).toEqual({ destinos: ['un***@empresa.com', 'do***@empresa.com'] });
    });

    it('no manda código a cuentas sin email', async () => {
      mockUsuariosRepo.findCuentasPorCuit.mockResolvedValue([cuenta(10, ''), cuenta(11, 'dos@empresa.com')] as any);

      await solicitarAsociacion(1, '20123456789', 'interno');

      expect(mockVerification.sendVerificationToken).toHaveBeenCalledTimes(1);
      expect(mockVerification.sendVerificationToken.mock.calls[0]![1]).toBe('dos@empresa.com');
    });

    it('CUIT sin cuentas o sin ninguna con email → 404 y no revoca ni manda nada', async () => {
      mockUsuariosRepo.findCuentasPorCuit.mockResolvedValueOnce([]).mockResolvedValueOnce([cuenta(10, '')] as any);

      await expect(solicitarAsociacion(1, '20000000000', 'web')).rejects.toMatchObject({ statusCode: 404 });
      await expect(solicitarAsociacion(1, '20000000000', 'web')).rejects.toMatchObject({ statusCode: 404 });
      expect(mockVerification.revocarTokensActivos).not.toHaveBeenCalled();
      expect(mockVerification.sendVerificationToken).not.toHaveBeenCalled();
    });
  });

  // ──────────── verificarAsociacion ────────────

  describe('verificarAsociacion', () => {
    const tokenValido = (entidad_id: number | null, entidad_tipo_id: number | null) => ({
      success: true as const,
      message: 'ok',
      token: { id: 1, entidad_id, entidad_tipo_id } as any,
    });

    beforeEach(() => {
      mockUsuariosRepo.findUserById.mockResolvedValue(mockUser as any);
      mockUsuariosRepo.getRolPorDefectoPorEntorno.mockResolvedValue(5);
      mockUsuariosRepo.createUsuarioEntidad.mockResolvedValue(100);
      mockUsuariosRepo.getUsuarioIdsByRoles.mockResolvedValue([]);
      mockUsuariosRepo.getUsuarioEntidadCompleto.mockResolvedValue([
        { user_context_id: 100, rol_nombre: 'empleado-super', id_entidad_tipo: 1, id_entidad: 11, entorno: 'interno' },
      ] as any);
      mockPersonalRepo.getPersonalById.mockResolvedValue({ id_empleado: 11 } as any);
      mockClientesRepo.getClienteById.mockResolvedValue({ id_cliente: 7 } as any);
      mockAuthValidations.generateAccessToken.mockReturnValue('at');
      mockAuthValidations.generateRefreshToken.mockResolvedValue({ token: 'rt', hashedToken: 'h' });
      mockAuthValidations.getRefreshExpiresAt.mockReturnValue(new Date());
    });

    it('asocia la entidad guardada en el token que coincidió, con el rol por defecto de su entorno', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue(tokenValido(11, 1));
      mockUsuariosRepo.getOrigenEntidadTipo.mockResolvedValue('interno');

      const res = await verificarAsociacion(1, '123456', 'interno', 'interno');

      expect(mockVerification.validateVerificationToken).toHaveBeenCalledWith(1, '123456', TokenPurpose.ACCOUNT_ASSOCIATION);
      expect(mockUsuariosRepo.getRolPorDefectoPorEntorno).toHaveBeenCalledWith('interno');
      expect(mockPersonalRepo.getPersonalById).toHaveBeenCalledWith(11);
      expect(mockUsuariosRepo.createUsuarioEntidad).toHaveBeenCalledWith(1, 1, 11, 5);
      expect(res).toEqual({ accessToken: 'at', refreshToken: 'rt', asociacion: 100 });
    });

    it('web: valida contra clientes', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue(tokenValido(7, 3));
      mockUsuariosRepo.getOrigenEntidadTipo.mockResolvedValue('web');

      await verificarAsociacion(1, '123456', 'web', 'web');

      expect(mockClientesRepo.getClienteById).toHaveBeenCalledWith(7);
      expect(mockPersonalRepo.getPersonalById).not.toHaveBeenCalled();
      expect(mockUsuariosRepo.createUsuarioEntidad).toHaveBeenCalledWith(1, 3, 7, 5);
    });

    /**
     * CASO: token readonly de web + código de una cuenta de interno
     * RIESGO: escalar a empleado-super desde la web
     * REFERENCIA: OWASP API01:2023 (BOLA)
     */
    it('código de una cuenta de otro entorno → 400 y no asocia', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue(tokenValido(11, 1));
      mockUsuariosRepo.getOrigenEntidadTipo.mockResolvedValue('interno');

      await expect(verificarAsociacion(1, '123456', 'web', 'web')).rejects.toMatchObject({ statusCode: 400 });
      expect(mockUsuariosRepo.createUsuarioEntidad).not.toHaveBeenCalled();
    });

    it('header de entorno distinto al del access token → 401 sin validar el código', async () => {
      await expect(verificarAsociacion(1, '123456', 'interno', 'web')).rejects.toMatchObject({ statusCode: 401 });
      expect(mockVerification.validateVerificationToken).not.toHaveBeenCalled();
    });

    it('código inválido → 401 con los intentos restantes', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue({ success: false, message: 'Token inválido.', attemptsLeft: 2 });

      await expect(verificarAsociacion(1, '000000', 'interno', 'interno')).rejects.toMatchObject({
        statusCode: 401,
        details: { attemptsLeft: 2 },
      });
      expect(mockUsuariosRepo.createUsuarioEntidad).not.toHaveBeenCalled();
    });

    it('token sin entidad (p. ej. viejo) → 400', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue(tokenValido(null, null));
      await expect(verificarAsociacion(1, '123456', 'interno', 'interno')).rejects.toMatchObject({ statusCode: 400 });
      expect(mockUsuariosRepo.createUsuarioEntidad).not.toHaveBeenCalled();
    });

    it('entidad dada de baja después de mandar el código → error y no asocia', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue(tokenValido(11, 1));
      mockUsuariosRepo.getOrigenEntidadTipo.mockResolvedValue('interno');
      mockPersonalRepo.getPersonalById.mockResolvedValue(null as any);

      await expect(verificarAsociacion(1, '123456', 'interno', 'interno')).rejects.toThrow('Personal no encontrado');
      expect(mockUsuariosRepo.createUsuarioEntidad).not.toHaveBeenCalled();
    });

    it('notifica a gerencia y no falla si la notificación falla', async () => {
      mockVerification.validateVerificationToken.mockResolvedValue(tokenValido(11, 1));
      mockUsuariosRepo.getOrigenEntidadTipo.mockResolvedValue('interno');
      mockUsuariosRepo.getUsuarioIdsByRoles.mockResolvedValue([50]);
      mockPush.sendPushNotificationToMultipleUsers.mockRejectedValue(new Error('push caído'));

      await expect(verificarAsociacion(1, '123456', 'interno', 'interno')).resolves.toMatchObject({ asociacion: 100 });
      expect(mockPush.sendPushNotificationToMultipleUsers).toHaveBeenCalledWith(
        [50],
        expect.objectContaining({ data: expect.objectContaining({ entorno: 'interno' }) }),
      );
    });
  });
});
