import type { Mailer } from "./Mailer";
import { ConsoleMailer } from "./providers/console";
import { SmtpMailer } from "./providers/smtp";
import { env } from "../env";

let instance: Mailer | null = null;

/** The active mailer, chosen by MAIL_PROVIDER (console | smtp). */
export function getMailer(): Mailer {
  if (!instance) {
    instance = env.MAIL_PROVIDER === "smtp" ? new SmtpMailer() : new ConsoleMailer();
  }
  return instance;
}

export * as templates from "./templates";
export type { Mailer, MailMessage } from "./Mailer";
