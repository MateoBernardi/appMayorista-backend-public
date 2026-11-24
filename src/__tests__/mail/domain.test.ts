/**
 * Tests de dominio: mailService
 * Capa: Domain Service
 * Plataforma: Transversal
 */

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test-api-key';

jest.mock('../../adapters/comunications/sendMail');

import { sendMailService } from '../../domain/services/mailService';
import { sendMail } from '../../adapters/comunications/sendMail';

const mockSendMail = jest.mocked(sendMail);

describe('MailService', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * CASO: Mail sin texto debería lanzar error
   * REFERENCIA: Validación de entradas
   */
  it('debería lanzar error si el texto está vacío', async () => {
    await expect(sendMailService({ to: 'a@b.com', text: '' })).rejects.toThrow('sin contenido');
  });

  it('debería lanzar error si el texto es solo espacios', async () => {
    await expect(sendMailService({ to: 'a@b.com', text: '   ' })).rejects.toThrow('sin contenido');
  });

  /**
   * CASO: Genera HTML automáticamente si no se proporciona
   */
  it('debería convertir text a html con <br> si no hay html', async () => {
    mockSendMail.mockResolvedValue({ messageId: '123' } as any);
    await sendMailService({ to: 'a@b.com', text: 'linea1\nlinea2' });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ html: 'linea1<br>linea2' })
    );
  });

  /**
   * CASO: Usa HTML proporcionado si existe
   */
  it('debería usar el html proporcionado sin generar uno', async () => {
    mockSendMail.mockResolvedValue({ messageId: '123' } as any);
    await sendMailService({ to: 'a@b.com', text: 'text', html: '<p>custom</p>' });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>custom</p>' })
    );
  });

  /**
   * CASO: Propaga errores del adaptador
   */
  it('debería propagar error si sendMail falla', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP error'));
    await expect(sendMailService({ to: 'a@b.com', text: 'test' })).rejects.toThrow('SMTP error');
  });
});
