import type { Mailer, MailMessage } from "../Mailer";

/** Local-dev provider: prints the email to stdout instead of sending it. */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
    console.log(
      [
        "",
        "┌──────────────── MAIL (console provider — not sent) ────────────────",
        `│ To:      ${to}`,
        `│ Subject: ${message.subject}`,
        "├──────────────────────────────────────────────────────────────────────",
        (message.text ?? message.html).split("\n").map((l) => `│ ${l}`).join("\n"),
        "└──────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );
  }
}
