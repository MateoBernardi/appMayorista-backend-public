import { sendMail } from "../../adapters/comunications/sendMail";
import { MailDTO } from "../dto/MailDTO";
import { BadRequestError } from "../../adapters/errors/AppError";

export const sendMailService = async (mailData: MailDTO) => {
  if ((!mailData.text || mailData.text.trim() === "") && !mailData.html) {
    throw new BadRequestError("No se puede enviar un mail sin contenido");
  }
  let html: string | undefined = mailData.html;
  if (!html && mailData.text) {
    html = mailData.text.replace(/\n/g, '<br>');
  }
  const mailToSend = html ? { ...mailData, html } : { ...mailData };
  return sendMail(mailToSend);
};
