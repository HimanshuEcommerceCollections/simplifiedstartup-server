/**
 * The API contract — single source of truth for both UIs.
 * The dashboard (simplifiedstartup-ui) and the website (client/) copy the
 * pieces they need from here; keep changes backwards-compatible or version
 * the routes.
 */
import { z } from "zod";

// ---------- roles & statuses (SQLite has no enums — these arrays are the law) ----------

export const ROLES = ["ADMIN", "EDITOR", "CONTENT_WRITER", "RECRUITER", "VIEWER"] as const;
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

// ---------- auth & team ----------

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(ROLES),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(16).max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(100),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(200) });
export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(8).max(100),
});

export const userPatchSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, { message: "nothing to update" });
export type UserPatchInput = z.infer<typeof userPatchSchema>;

// ---------- admin: leads & subscribers ----------

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const leadPatchSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => v.status !== undefined || v.notes !== undefined, { message: "nothing to update" });
export type LeadPatchInput = z.infer<typeof leadPatchSchema>;

// ---------- careers ----------

export const careerRoleInputSchema = z.object({
  title: trimmed(140),
  type: trimmed(60),
  location: z.string().trim().max(80).optional().or(z.literal("")),
  description: trimmed(2000), // short plain blurb (careers-page row)
  body: z.string().max(50_000).optional().or(z.literal("")), // rich HTML, sanitized server-side
  published: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
export type CareerRoleInput = z.infer<typeof careerRoleInputSchema>;

export const careerRolePatchSchema = careerRoleInputSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "nothing to update",
});

/** POST /api/v1/applications — JSON body; the CV arrives as a shared link (Drive etc.), not a file. */
export const applicationInputSchema = z.object({
  name: trimmed(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  portfolioUrl: z.string().trim().max(300).optional().or(z.literal("")),
  cvUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://") || u.startsWith("http://"), { message: "CV link must be a web URL" }),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  roleId: z.string().trim().max(64).optional().or(z.literal("")),
  company: z.string().max(200).optional(), // honeypot
});
export type ApplicationInput = z.infer<typeof applicationInputSchema>;

export const applicationPatchSchema = z.object({ status: z.enum(APPLICATION_STATUSES) });

export const applicationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(APPLICATION_STATUSES).optional(),
  roleId: z.string().max(64).optional(),
});

// ---------- content collections (blog / faq / glossary) ----------

export const CATEGORY_COLLECTIONS = ["blog", "faq"] as const;
export type CategoryCollection = (typeof CATEGORY_COLLECTIONS)[number];

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase words separated by dashes")
  .max(120);

export const categoryInputSchema = z.object({
  collection: z.enum(CATEGORY_COLLECTIONS),
  key: slug,
  label: trimmed(80),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
/** key is immutable after creation — the website's chips reference it. */
export const categoryPatchSchema = z
  .object({ label: trimmed(80).optional(), sortOrder: z.coerce.number().int().min(0).max(9999).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

const richHtml = z.string().max(100_000);

export const articleInputSchema = z.object({
  slug,
  title: trimmed(200),
  summary: trimmed(600),
  readTime: trimmed(30),
  artwork: slug, // preset key from the website's card-art registry
  body: richHtml.optional().or(z.literal("")),
  featured: z.boolean().optional(),
  published: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  categoryId: z.string().min(1),
});
export const articlePatchSchema = articleInputSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "nothing to update",
});

export const articleImagePatchSchema = z
  .object({
    alt: z.string().trim().max(200).optional(),
    isCover: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

export const faqInputSchema = z.object({
  question: trimmed(300),
  answer: trimmed(4000), // plain text
  categoryId: z.string().min(1),
  published: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
export const faqPatchSchema = faqInputSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "nothing to update",
});

export const glossaryInputSchema = z.object({
  term: trimmed(120),
  definition: trimmed(2000),
  published: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});
export const glossaryPatchSchema = glossaryInputSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "nothing to update",
});

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export type ContentCategoryDto = {
  id: string;
  collection: CategoryCollection;
  key: string;
  label: string;
  sortOrder: number;
  itemCount: number;
};

export type ArticleImageDto = { id: string; url: string; alt: string; isCover: boolean; sortOrder: number };

export type ArticleDto = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  readTime: string;
  artwork: string;
  body: string | null;
  featured: boolean;
  published: boolean;
  sortOrder: number;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  images: ArticleImageDto[];
  updatedAt: string;
};

export type FaqDto = {
  id: string;
  question: string;
  answer: string;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  published: boolean;
  sortOrder: number;
};

export type GlossaryTermDto = { id: string; term: string; definition: string; published: boolean; sortOrder: number };

// ---------- DTOs (what the API returns) ----------

export type CareerRoleDto = {
  id: string;
  title: string;
  type: string;
  location: string | null;
  description: string;
  published: boolean;
  sortOrder: number;
  applicationCount?: number;
  createdAt: string;
  updatedAt: string;
};

/** What the website consumes at build time. */
export type PublicCareerRole = { id: string; title: string; type: string; location: string | null; description: string };

export type JobApplicationDto = {
  id: string;
  roleId: string | null;
  roleTitle: string | null;
  name: string;
  email: string;
  phone: string | null;
  portfolioUrl: string | null;
  cvUrl: string | null;
  message: string | null;
  status: ApplicationStatus;
  createdAt: string;
};

export type PublishStatusDto = { hookConfigured: boolean; lastPublishedAt: string | null; lastPublishedBy: string | null };

export type SessionUser = { id: string; email: string; name: string | null; role: Role };

export type UserDto = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  createdAt: string;
  invitedByName?: string | null;
};

export type LeadDto = {
  id: string;
  name: string;
  email: string;
  business: string | null;
  stage: string;
  need: string;
  message: string | null;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriberDto = { id: string; email: string; sourcePage: string | null; createdAt: string };

export type StatsDto = {
  leads: { total: number } & Record<LeadStatus, number>;
  subscribers: number;
  users: number;
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

// ---------- response envelope ----------

export type ApiOk<T = Record<string, never>> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; issues?: unknown };
