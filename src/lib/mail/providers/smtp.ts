import nodemailer, { type Transporter } from "nodemailer";
import type { Mailer, MailMessage } from "../Mailer";
import { env } from "../../env";

/**
 * SMTP provider — configured for Gmail for now (smtp.gmail.com:465 with an
 * App Password; requires 2FA on the Google account). Gmail caps sending at
 * roughly 500 messages/day, which is fine for invites, password resets, and
 * lead notifications. Bulk mail (newsletters) should get its own provider
 * behind the same Mailer interface.
 */
export class SmtpMailer implements Mailer {
  private transporter: Transporter;

  constructor() {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
      throw new Error("MAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASS");
    }
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 465,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
