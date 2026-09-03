/**
 * The mail abstraction. Everything outside src/lib/mail depends only on this
 * interface — the active provider (console for local dev, Gmail SMTP now,
 * Resend/SES/whatever later) is chosen by MAIL_PROVIDER in src/lib/mail/index.ts.
 */
export type MailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export interface Mailer {
  /** Resolves when the provider has accepted the message. Throws on failure. */
  send(message: MailMessage): Promise<void>;
}
