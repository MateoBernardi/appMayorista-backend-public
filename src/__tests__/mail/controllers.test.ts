/**
 * Tests de controllers: mailController
 * Capa: Controller
 * Plataforma: Transversal
 */

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test-api-key';

jest.mock('../../domain/services/mailService');

import { createMockReqRes } from '../helpers/testHelpers';
import { sendMailController } from '../../controllers/mailController';
import * as mailService from '../../domain/services/mailService';

const service = jest.mocked(mailService);

describe('Mail Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('debería propagar un error 400 si falta destinatario', async () => {
    const { req, res, next } = createMockReqRes({ body: { text: 'hello' } });
    await sendMailController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('debería retornar 200 al enviar mail exitosamente', async () => {
    service.sendMailService.mockResolvedValue({ messageId: '123' } as any);
    const { req, res, next } = createMockReqRes({
      body: { to: 'dest@test.com', text: 'hello' },
    });
    await sendMailController(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  /**
   * CASO: Array de destinatarios usa BCC
   * RIESGO: Exponer lista de emails entre destinatarios
   * REFERENCIA: OWASP API03:2023
   */
  it('debería usar BCC cuando se envía a múltiples destinatarios', async () => {
    service.sendMailService.mockResolvedValue({ messageId: '123' } as any);
    const { req, res, next } = createMockReqRes({
      body: { to: ['a@b.com', 'c@d.com'], text: 'hello' },
    });
    await sendMailController(req, res, next);
    expect(service.sendMailService).toHaveBeenCalledWith(
      expect.objectContaining({
        bcc: 'a@b.com,c@d.com',
      })
    );
  });

  it('debería propagar un error 500 si el servicio falla', async () => {
    service.sendMailService.mockRejectedValue(new Error('SMTP failed'));
    const { req, res, next } = createMockReqRes({
      body: { to: 'dest@test.com', text: 'hello' },
    });
    await sendMailController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });
});
