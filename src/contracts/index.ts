/**
 * The API contract — single source of truth for both UIs.
 * The dashboard (simplifiedstartup-ui) and the website (client/) copy the
 * pieces they need from here; keep changes backwards-compatible or version
 * the routes.
 */
import { z } from "zod";

// ---------- roles & statuses (SQLite has no enums — these arrays are the law) ----------

export const ROLES = ["ADMIN", "EDITOR", "RECRUITER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["invited", "active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LEAD_STATUSES = ["new", "contacted", "booked", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const APPLICATION_STATUSES = ["new", "reviewed", "shortlisted", "hired", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// ---------- public intake payloads ----------

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** POST /api/v1/leads — the growth-plan request form. `company` is a honeypot. */
export const leadInputSchema = z.object({
  name: trimmed(120),
  email: z.string().trim().email().max(200),
  business: z.string().trim().max(200).optional().or(z.literal("")),
  stage: trimmed(60),
  need: trimmed(120),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  company: z.string().max(200).optional(), // honeypot — humans never see it
});
export type LeadInput = z.infer<typeof leadInputSchema>;

/** POST /api/v1/subscribers — the footer newsletter. `company` is a honeypot. */
export const subscriberInputSchema = z.object({
  email: z.string().trim().email().max(200),
  sourcePage: z.string().trim().max(200).optional().or(z.literal("")),
  company: z.string().max(200).optional(), // honeypot
});
export type SubscriberInput = z.infer<typeof subscriberInputSchema>;

// ---------- response envelope ----------

export type ApiOk<T = Record<string, never>> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; issues?: unknown };
