jest.mock('../../adapters/db/verificationTokensRepo');
jest.mock('../../adapters/comunications/sendMail');
jest.mock('../../utils/tokenGenerator');
jest.mock('argon2');

import * as verificationTokensRepo from '../../adapters/db/verificationTokensRepo';
import * as sendMailModule from '../../adapters/comunications/sendMail';
import * as tokenGenerator from '../../utils/tokenGenerator';
import argon2 from 'argon2';
import {
  sendVerificationToken,
  validateVerificationToken,
} from '../../domain/services/verificationTokenServices';
import { TokenPurpose } from '../../types/tokenPurpose';

const mockRepo = jest.mocked(verificationTokensRepo);
const mockMail = jest.mocked(sendMailModule);
const mockTokenGen = jest.mocked(tokenGenerator);
const mockArgon2 = jest.mocked(argon2);

describe('VerificationTokenServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTokenGen.generateRandomToken.mockReturnValue('123456');
    mockArgon2.hash.mockResolvedValue('$argon2id$hashed' as any);
    mockRepo.createVerificationToken.mockResolvedValue({
      id: 1,
      expires_at: new Date('2026-06-01'),
    } as any);
  });

  describe('sendVerificationToken', () => {
    it('should generate a 6-digit random token', async () => {
      await sendVerificationToken(1, 'user@test.com', 'email');
      expect(mockTokenGen.generateRandomToken).toHaveBeenCalledWith(6);
    });

    it('should hash the generated token with argon2id', async () => {
      await sendVerificationToken(1, 'user@test.com', 'email');
      expect(mockArgon2.hash).toHaveBeenCalledWith(
        '123456',
        expect.objectContaining({ type: argon2.argon2id })
      );
    });

    it('should store the hashed token in the repo with a 30-min expiry', async () => {
      const before = Date.now();
      await sendVerificationToken(1, 'user@test.com', 'email', 5);
      const [userId, contact, hash, method, expiresAt, createdBy] =
        mockRepo.createVerificationToken.mock.calls[0] as any;

      expect(userId).toBe(1);
      expect(contact).toBe('user@test.com');
      expect(hash).toBe('$argon2id$hashed');
      expect(method).toBe('email');
      expect(createdBy).toBe(5);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 29 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(before + 31 * 60 * 1000);
    });

    it('should send a verification email when method is "email"', async () => {
      mockMail.sendVerificationMail.mockResolvedValue(undefined as any);
      await sendVerificationToken(1, 'user@test.com', 'email');
      expect(mockMail.sendVerificationMail).toHaveBeenCalledWith('user@test.com', '123456');
    });

    it('should NOT send email when method is "sms"', async () => {
      await sendVerificationToken(1, '+549111', 'sms');
      expect(mockMail.sendVerificationMail).not.toHaveBeenCalled();
    });

    it('should return id, expires_at, method, and plain token', async () => {
      const result = await sendVerificationToken(1, 'user@test.com', 'email');
      expect(result).toEqual({
        id: 1,
        expires_at: expect.any(Date),
        method: 'email',
        token: '123456',
      });
    });

    it('should use ACCOUNT_ASSOCIATION as default purpose', async () => {
      await sendVerificationToken(1, 'user@test.com', 'email');
      const args = mockRepo.createVerificationToken.mock.calls[0] as any;
      expect(args[6]).toBe(TokenPurpose.ACCOUNT_ASSOCIATION);
    });
  });

  describe('validateVerificationToken', () => {
    const tok = (id: number, over: Record<string, unknown> = {}) => ({
      id,
      token: `$argon2id$hash-${id}`,
      failed_attempts: 0,
      entidad_id: id * 10,
      entidad_tipo_id: 1,
      ...over,
    });

    beforeEach(() => {
      mockRepo.revokeActiveTokensByUserAndPurpose.mockResolvedValue(undefined as any);
    });

    it('busca solo los tokens activos del propósito pedido', async () => {
      mockRepo.findActiveTokensByUserAndPurpose.mockResolvedValue([]);
      const result = await validateVerificationToken(1, '123456', TokenPurpose.PASSWORD_RESET);
      expect(mockRepo.findActiveTokensByUserAndPurpose).toHaveBeenCalledWith(1, TokenPurpose.PASSWORD_RESET);
      expect(result).toEqual({ success: false, message: 'Token inválido.', attemptsLeft: 0 });
    });

    it('con varios códigos activos, devuelve el que coincide (con su entidad) y revoca el lote', async () => {
      mockRepo.findActiveTokensByUserAndPurpose.mockResolvedValue([tok(1), tok(2), tok(3)] as any);
      mockArgon2.verify.mockImplementation((async (hash: string) => hash === '$argon2id$hash-2') as any);

      const result = await validateVerificationToken(1, '654321', TokenPurpose.ACCOUNT_ASSOCIATION);

      expect(result).toMatchObject({ success: true, token: { id: 2, entidad_id: 20 } });
      expect(mockRepo.revokeActiveTokensByUserAndPurpose).toHaveBeenCalledWith(1, TokenPurpose.ACCOUNT_ASSOCIATION);
      expect(mockRepo.incrementFailedAttemptsForLote).not.toHaveBeenCalled();
    });

    it('código incorrecto: suma un intento a todo el lote (N códigos no multiplican los intentos)', async () => {
      mockRepo.findActiveTokensByUserAndPurpose.mockResolvedValue([tok(1), tok(2)] as any);
      mockArgon2.verify.mockResolvedValue(false as any);
      mockRepo.incrementFailedAttemptsForLote.mockResolvedValue(1);

      const result = await validateVerificationToken(1, '000000', TokenPurpose.ACCOUNT_ASSOCIATION);

      expect(mockRepo.incrementFailedAttemptsForLote).toHaveBeenCalledWith([1, 2]);
      expect(result).toEqual({ success: false, message: 'Token inválido.', attemptsLeft: 2 });
      expect(mockRepo.revokeActiveTokensByUserAndPurpose).not.toHaveBeenCalled();
    });

    it('al 3.er fallo revoca el lote', async () => {
      mockRepo.findActiveTokensByUserAndPurpose.mockResolvedValue([tok(1, { failed_attempts: 2 }), tok(2, { failed_attempts: 2 })] as any);
      mockArgon2.verify.mockResolvedValue(false as any);
      mockRepo.incrementFailedAttemptsForLote.mockResolvedValue(3);

      const result = await validateVerificationToken(1, '000000', TokenPurpose.ACCOUNT_ASSOCIATION);

      expect(result).toEqual({ success: false, message: 'Token inválido.', attemptsLeft: 0 });
      expect(mockRepo.revokeActiveTokensByUserAndPurpose).toHaveBeenCalledWith(1, TokenPurpose.ACCOUNT_ASSOCIATION);
    });

    it('con los intentos ya agotados revoca sin verificar', async () => {
      mockRepo.findActiveTokensByUserAndPurpose.mockResolvedValue([tok(1, { failed_attempts: 3 })] as any);

      const result = await validateVerificationToken(1, '123456', TokenPurpose.ACCOUNT_ASSOCIATION);

      expect(result).toMatchObject({ success: false, attemptsLeft: 0 });
      expect(mockArgon2.verify).not.toHaveBeenCalled();
      expect(mockRepo.revokeActiveTokensByUserAndPurpose).toHaveBeenCalled();
    });
  });

  describe('sendVerificationToken - entidad', () => {
    it('guarda la entidad destino junto al token', async () => {
      await sendVerificationToken(1, 'user@test.com', 'email', null, TokenPurpose.ACCOUNT_ASSOCIATION, { entidadId: 7, entidadTipoId: 2 });
      const args = mockRepo.createVerificationToken.mock.calls[0] as any;
      expect(args[7]).toEqual({ entidadId: 7, entidadTipoId: 2 });
    });
  });
});
