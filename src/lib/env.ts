import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:5173")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  DATABASE_URL: z.string().min(1),

  MAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("Simplified Startup <no-reply@simplifiedstartup.local>"),
  NOTIFY_EMAIL: z.string().email().default("hello@simplifiedstartup.com"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  DASHBOARD_URL: z.string().url().default("http://localhost:5173"),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_NAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
