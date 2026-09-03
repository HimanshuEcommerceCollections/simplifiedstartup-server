import type { Role } from "../../contracts";
import type { MailMessage } from "./Mailer";

/** All emails the system sends, as data-in → message-out template functions. */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shell = (title: string, bodyHtml: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>
    ${bodyHtml}
    <p style="margin-top:28px;font-size:12px;color:#64748b">Simplified Startup · automated message</p>
  </div>`;

export function leadNotification(lead: {
  name: string;
  email: string;
  business?: string | null;
  stage: string;
  need: string;
  message?: string | null;
}): Omit<MailMessage, "to"> {
  const rows: [string, string][] = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Business", lead.business || "—"],
    ["Stage", lead.stage],
    ["Needs", lead.need],
    ["Message", lead.message || "—"],
  ];
  return {
    subject: `New growth-plan request — ${lead.name}`,
    html: shell(
      "New growth-plan request",
      `<table style="border-collapse:collapse;width:100%">${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px">${esc(v)}</td></tr>`
        )
        .join("")}</table>`
    ),
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
  };
}

export function userInvite(args: { inviteUrl: string; role: Role; invitedByName: string }): Omit<MailMessage, "to"> {
  return {
    subject: "You're invited to the Simplified Startup dashboard",
    html: shell(
      "You're invited",
      `<p style="font-size:14px;line-height:1.6">${esc(args.invitedByName)} invited you to the Simplified Startup dashboard as <b>${esc(args.role)}</b>.</p>
       <p style="margin:24px 0"><a href="${esc(args.inviteUrl)}" style="background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-size:14px">Accept invite &amp; set your password</a></p>
       <p style="font-size:13px;color:#64748b">This link expires in 48 hours. If you weren't expecting it, you can ignore this email.</p>`
    ),
    text: `${args.invitedByName} invited you to the Simplified Startup dashboard as ${args.role}.\nAccept: ${args.inviteUrl}\n(The link expires in 48 hours.)`,
  };
}

export function passwordReset(args: { resetUrl: string }): Omit<MailMessage, "to"> {
  return {
    subject: "Reset your Simplified Startup dashboard password",
    html: shell(
      "Reset your password",
      `<p style="margin:24px 0"><a href="${esc(args.resetUrl)}" style="background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-size:14px">Choose a new password</a></p>
       <p style="font-size:13px;color:#64748b">This link expires in 1 hour. If you didn't request it, ignore this email.</p>`
    ),
    text: `Reset your password: ${args.resetUrl}\n(The link expires in 1 hour.)`,
  };
}
