export interface MailDTO {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  bcc?: string;
}
