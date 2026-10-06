import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      auth: user
        ? { user, pass: config.get('SMTP_PASS', { infer: true }) }
        : undefined,
    });
  }

  get teamAddress(): string {
    return this.config.get('MAIL_TEAM', { infer: true });
  }

  /**
   * Envía un correo. Nunca lanza: un fallo del SMTP no debe perder el reclamo o la consulta
   * que ya se guardó. Devuelve `true` si el servidor de correo lo aceptó.
   */
  async send(message: MailMessage): Promise<boolean> {
    if (!message.to) return false;
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM', { infer: true }),
        ...message,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudo enviar "${message.subject}" a ${message.to}`,
        error,
      );
      return false;
    }
  }
}
