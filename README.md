# simplifiedstartup-server

API server for the Simplified Startup website and the (invite-only) admin dashboard.
Owns the database, auth, email, and — later — content publishing and the AI advisor.
The website (`client/`) and dashboard (`simplifiedstartup-ui/`) are pure frontends
that talk to this over HTTP; this repo is the only one holding secrets.

## Stack

Fastify 5 · TypeScript · Prisma · SQLite locally (Postgres in production) · Zod ·
Nodemailer behind a provider abstraction.

## Quick start

```bash
npm install
npx prisma migrate dev      # creates prisma/dev.db and applies migrations
npm run db:seed             # creates the first ADMIN from SEED_ADMIN_* in .env
npm run dev                 # http://localhost:4000
```

Copy `.env.example` to `.env` first and adjust as needed. `npm run peek` prints
row counts and the latest leads/subscribers while developing.

## API (v1)

Envelope: success `{ ok: true, ... }` · error `{ ok: false, error, issues? }`.

### Public (called by the website)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/v1/leads` | `{ name, email, business?, stage, need, message?, company? }` | Growth-plan form. `company` is a honeypot — filled ⇒ fake 201, nothing stored. Rate-limited 5/min/IP. Sends a notification email. |
| POST | `/api/v1/subscribers` | `{ email, sourcePage?, company? }` | Footer newsletter. Idempotent on email. Same honeypot + limit. |
| GET | `/health` | — | Liveness. |

Planned (see the project plan): auth + invites, admin CRUD for leads/subscribers,
content collections + publish deploy-hook, careers applications, AI advisor.

## Roles

Dashboard access is invite-only. Roles (validated strings — SQLite has no enums;
`src/contracts` is the source of truth): `ADMIN` (everything, manages users),
`EDITOR` (leads, subscribers, content), `RECRUITER` (career postings + job
applications), `VIEWER` (read-only).

## Email

`src/lib/mail` is a provider abstraction: all senders depend on the `Mailer`
interface; `MAIL_PROVIDER` picks the implementation.

- `console` (default in dev) — prints emails to stdout.
- `smtp` — real delivery. For Gmail: enable 2FA, create an **App Password**, set
  `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS`.
  Gmail caps ~500 sends/day — fine for invites/notifications; bulk mail gets a
  new provider file later, callers unchanged.

Templates (invite, password reset, lead notification) live in
`src/lib/mail/templates.ts`.

## SQLite → Postgres

Local dev uses SQLite so there's nothing to install. For production: change the
datasource provider in `prisma/schema.prisma` to `postgresql`, point
`DATABASE_URL` at the database, and run `prisma migrate dev` to regenerate
migrations. Role/status columns stay validated strings (or promote them to
Postgres enums then, in one migration).

## Contract

`src/contracts/index.ts` is the API contract both frontends copy types from.
Keep changes backwards-compatible; breaking changes mean a `/v2`.
