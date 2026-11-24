/**
 * Tests de controllers: asociacionControllers
 * Capa: Controller
 * Plataforma: Transversal (asociación + verificación)
 */

jest.mock('../../domain/services/asociacionServices');
jest.mock('../../domain/services/verificationTokenServices');
jest.mock('../../adapters/db/verificationTokensRepo');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../adapters/db/authRepo');
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ error: null }),
    },
  })),
}));
jest.mock('../../adapters/comunications/sendMail');
jest.mock('../../adapters/db/pgClient', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  },
}));
jest.mock('../../domain/validations/authValidations');

import { createMockReqRes } from '../helpers/testHelpers';
import {
  requestVerificationTokenController,
  verifyAndAssociateController,
  generatePasswordTokenController,
  validateTokenController,
} from '../../controllers/asociacionControllers';
import { TokenPurpose } from '../../types/tokenPurpose';
import * as asociacionService from '../../domain/services/asociacionServices';
import * as verificationService from '../../domain/services/verificationTokenServices';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as authValidations from '../../domain/validations/authValidations';

const mockAsociacion = jest.mocked(asociacionService);
const mockVerification = jest.mocked(verificationService);
const mockUsuariosRepo = jest.mocked(usuariosRepo);
const mockAuthValidations = jest.mocked(authValidations);
const nullFindUserByEmailResult = null as unknown as Awaited<ReturnType<typeof usuariosRepo.findUserByEmail>>;

describe('Asociacion Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  const readonly = (entorno = 'web') => ({ userId: 1, role: 'readonly', entorno });

  // ──────────── requestVerificationTokenController ────────────

  describe('requestVerificationTokenController', () => {
    it('debería llamar a next con UnauthorizedError si falta userId', async () => {
      const { req, res, next } = createMockReqRes({ body: { cuit: '20123456789' }, headers: { 'x-app-entorno': 'web' } });
      await requestVerificationTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería llamar a next con BadRequestError si falta el CUIT', async () => {
      const { req, res, next } = createMockReqRes({ user: readonly(), body: {}, headers: { 'x-app-entorno': 'web' } });
      await requestVerificationTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(mockAsociacion.solicitarAsociacion).not.toHaveBeenCalled();
    });

    it('debería llamar a next con BadRequestError si el entorno no es válido', async () => {
      const { req, res, next } = createMockReqRes({ user: readonly(), body: { cuit: '20123456789' }, headers: { 'x-app-entorno': 'otro' } });
      await requestVerificationTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    /**
     * CASO: el cliente intenta elegir a dónde se manda el código
     * RIESGO: asociarse a una cuenta ajena recibiendo el código en un email propio
     * REFERENCIA: OWASP API01:2023 (BOLA)
     */
    it('solo usa el CUIT y el entorno del header: ignora cuenta/contact del body', async () => {
      mockAsociacion.solicitarAsociacion.mockResolvedValue({ destinos: ['us***@empresa.com'] });
      const { req, res, next } = createMockReqRes({
        user: readonly('interno'),
        body: { cuit: ' 20123456789 ', cuenta: { id: 99, contact: 'atacante@mal.com', entorno: 'interno' }, contact: 'atacante@mal.com' },
        headers: { 'x-app-entorno': 'interno' },
      });
      await requestVerificationTokenController(req, res, next);

      expect(mockAsociacion.solicitarAsociacion).toHaveBeenCalledWith(1, '20123456789', 'interno');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ destinos: ['us***@empresa.com'] }));
    });
  });

  // ──────────── verifyAndAssociateController ────────────

  describe('verifyAndAssociateController', () => {
    it('debería llamar a next con UnauthorizedError si falta userId', async () => {
      const { req, res, next } = createMockReqRes({ body: { token: '123456' }, headers: { 'x-app-entorno': 'web' } });
      await verifyAndAssociateController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería llamar a next con BadRequestError si falta el token', async () => {
      const { req, res, next } = createMockReqRes({ user: readonly(), body: {}, headers: { 'x-app-entorno': 'web' } });
      await verifyAndAssociateController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('solo pasa el código, el entorno del header y el del access token (ignora cuenta del body)', async () => {
      mockAsociacion.verificarAsociacion.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', asociacion: 100 });
      const { req, res, next } = createMockReqRes({
        user: readonly('web'),
        body: { token: '123456', cuenta: { id: 99, id_entidad_tipo: 1, entorno: 'interno' } },
        headers: { 'x-app-entorno': 'web' },
      });
      await verifyAndAssociateController(req, res, next);

      expect(mockAsociacion.verificarAsociacion).toHaveBeenCalledWith(1, '123456', 'web', 'web');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'at', refreshToken: 'rt' }));
    });

    it('propaga el 401 del service si el código es inválido', async () => {
      const { UnauthorizedError } = jest.requireActual('../../adapters/errors/AppError');
      mockAsociacion.verificarAsociacion.mockRejectedValue(new UnauthorizedError('Token inválido.', { attemptsLeft: 1 }));
      const { req, res, next } = createMockReqRes({ user: readonly(), body: { token: '000000' }, headers: { 'x-app-entorno': 'web' } });
      await verifyAndAssociateController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
  });

  // ──────────── generatePasswordTokenController ────────────

  describe('generatePasswordTokenController', () => {
    it('debería llamar a next con BadRequestError si falta email', async () => {
      const { req, res, next } = createMockReqRes({ body: {} });
      await generatePasswordTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería retornar 200 genérico si el usuario no existe', async () => {
      mockUsuariosRepo.findUserByEmail.mockResolvedValue(nullFindUserByEmailResult);
      const { req, res, next } = createMockReqRes({ body: { email: 'no@exist.com' } });
      await generatePasswordTokenController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('un pedido nuevo revoca los códigos de recuperación anteriores', async () => {
      mockUsuariosRepo.findUserByEmail.mockResolvedValue({ id: 1, email: 'test@test.com' } as any);
      const { req, res, next } = createMockReqRes({ body: { email: 'test@test.com' } });
      await generatePasswordTokenController(req, res, next);
      expect(mockVerification.revocarTokensActivos).toHaveBeenCalledWith(1, TokenPurpose.PASSWORD_RESET);
      expect(mockVerification.sendVerificationToken).toHaveBeenCalledWith(1, 'test@test.com', 'email', null, TokenPurpose.PASSWORD_RESET);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ──────────── validateTokenController ────────────

  describe('validateTokenController', () => {
    it('debería llamar a next con BadRequestError si faltan email o token', async () => {
      const { req, res, next } = createMockReqRes({ body: {} });
      await validateTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('debería llamar a next con UnauthorizedError si el usuario no existe', async () => {
      mockUsuariosRepo.findUserByEmail.mockResolvedValue(nullFindUserByEmailResult);
      const { req, res, next } = createMockReqRes({ body: { email: 'no@exist.com', token: '123' } });
      await validateTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('debería llamar a next con UnauthorizedError si el token es inválido', async () => {
      mockUsuariosRepo.findUserByEmail.mockResolvedValue({ id: 1 } as any);
      mockVerification.validateVerificationToken.mockResolvedValue({ success: false, message: 'Token inválido', attemptsLeft: 2 });
      const { req, res, next } = createMockReqRes({ body: { email: 'test@test.com', token: 'wrong' } });
      await validateTokenController(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    /**
     * CASO: Token válido genera accessToken con rol change_pass
     * RIESGO: El token no debe tener permisos amplios
     * REFERENCIA: OWASP API01:2023 (Broken Object Level Authorization)
     */
    it('debería generar accessToken con rol change_pass ante token válido', async () => {
      mockUsuariosRepo.findUserByEmail.mockResolvedValue({ id: 1 } as any);
      mockVerification.validateVerificationToken.mockResolvedValue({ success: true, message: 'Token validado correctamente.', token: { id: 1 } as any });
      mockAuthValidations.generateAccessToken.mockReturnValue('jwt-token');
      const { req, res, next } = createMockReqRes({ body: { email: 'test@test.com', token: '123456' } });
      await validateTokenController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      // Un código de otro propósito (p. ej. asociación) no sirve para resetear la contraseña
      expect(mockVerification.validateVerificationToken).toHaveBeenCalledWith(1, '123456', TokenPurpose.PASSWORD_RESET);
      expect(mockAuthValidations.generateAccessToken).toHaveBeenCalledWith(
        1,
        'change_pass',
        expect.objectContaining({ userContextId: null })
      );
    });
  });
});
