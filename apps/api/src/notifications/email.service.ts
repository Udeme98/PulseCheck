import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string | null;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const portValue = this.configService.get<string>('SMTP_PORT');
    const port = Number(portValue);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM');

    const validPort = Number.isInteger(port) && port >= 1 && port <= 65535;

    if (!host || !validPort || !user || !pass || !from) {
      this.logger.warn(
        'SMTP is not fully configured or has invalid settings. Email delivery is disabled.',
      );

      this.transporter = null;
      this.from = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    this.from = from;
  }

  async sendMail(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    if (!this.transporter || !this.from) {
      throw new Error('Email delivery is unavailable: SMTP is not configured.');
    }

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
      text,
    });
  }
}
