import { Resend } from 'resend';
import { MailDTO } from '../../domain/dto/MailDTO';

let _resend: Resend | null = null;
const getResend = () => {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
};

const FROM = process.env.MAIL_FROM ?? 'Insumos Italo Argentina <insumos@italoarg.com.ar>';
const FROM_REMITO = process.env.MAIL_FROM_REMITO ?? 'Compras Italo Argentina <comprasitaloarg@gmail.com>';

export const sendMail = async (mailData: MailDTO) => {
  const { error } = await getResend().emails.send({
    from: FROM,
    to: mailData.to,
    subject: mailData.subject ?? 'Italo Argentina',
    ...(mailData.text !== undefined && { text: mailData.text }),
    ...(mailData.html !== undefined && { html: mailData.html }),
    ...(mailData.bcc !== undefined && { bcc: mailData.bcc }),
  } as any);

  if (error) {
    throw new Error(`Error al enviar correo: ${error.message}`);
  }
};

export const sendVerificationMail = async (email: string, token: string) => {
  const { error } = await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Código de Verificación - Italo Argentina',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Verificación de Identidad</h2>
        <p>Ingresá el siguiente código:</p>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px;">
          <h1 style="color: #27ae60;">${token}</h1>
        </div>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Error al enviar código de verificación: ${error.message}`);
  }
};

const streamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

export const sendRemitoMail = async (email: string, subject: string, remito: NodeJS.ReadableStream) => {
  const pdfBuffer = await streamToBuffer(remito);

  const { error } = await getResend().emails.send({
    from: FROM,
    to: email,
    subject,
    html: '<p>Adjunto encontrará su remito de compra de Italo Argentina.</p>',
    attachments: [
      {
        filename: 'remito.pdf',
        content: pdfBuffer,
      },
    ],
  } as any);

  if (error) {
    throw new Error(`Error al enviar remito: ${error.message}`);
  }
};