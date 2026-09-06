import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role, SessionUser } from "../contracts";
import { db } from "./db";
import { env } from "./env";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = "ss_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export const newToken = () => randomBytes(32).toString("hex");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(reply: FastifyReply, userId: string) {
  const token = newToken();
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  // In production the dashboard and API sit on different *.vercel.app
  // subdomains — a public-suffix boundary, so the browser treats them as
  // cross-site and only sends the cookie with SameSite=None (HTTPS required).
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    secure: env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** preHandler: resolves the session cookie to request.user or replies 401. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return reply.code(401).send({ ok: false, error: "unauthenticated" });

  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.status !== "active") {
    if (session) await db.session.delete({ where: { id: session.id } }).catch(() => {});
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(401).send({ ok: false, error: "unauthenticated" });
  }

  request.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role as Role,
  };
}

/** preHandler factory: requireAuth first, then role check. */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ ok: false, error: "unauthenticated" });
    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }
  };
}
