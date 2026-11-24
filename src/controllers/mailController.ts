import { Request, Response, NextFunction } from "express";
import { sendMailService } from "../domain/services/mailService";
import { asAppError, BadRequestError } from "../adapters/errors/AppError";

export const sendMailController = async (req: Request, res: Response, next: NextFunction) => {
  let { to, text, html } = req.body;
  if (!to) {
    return next(new BadRequestError("Falta destinatario"));
  }
  let mailData;
  if (Array.isArray(to)) {
    mailData = { to: 'Destinatarios ocultos <insumos@italoarg.com.ar>', bcc: to.join(","), text, html };
  } else {
    mailData = { to, text, html };
  }
  try {
    const info = await sendMailService(mailData);
    res.status(200).json({ message: "Correo enviado", info });
  } catch (error) {
    next(asAppError(error, "No se pudo enviar el correo"));
  }
};
