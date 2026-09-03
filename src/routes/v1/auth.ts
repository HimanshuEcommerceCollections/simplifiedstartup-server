import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { acceptInviteSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from "../../contracts";
import { db } from "../../lib/db";
import { env } from "../../lib/env";
import { getMailer, templates } from "../../lib/mail";
import { RESET_TTL_MS, createSession, destroySession, hashToken, newToken, requireAuth } from "../../lib/auth";

export async function authRoutes(app: FastifyInstance) {
  const tightLimit = { rateLimit: { max: 5, timeWindow: "1 minute" } };

  app.post("/login", { config: tightLimit }, async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);
    const user = await db.user.findUnique({ where: { email } });
    const ok =
      user && user.status === "active" && user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) return reply.code(401).send({ ok: false, error: "invalid credentials" });

    await createSession(reply, user.id);
    return { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.post("/logout", { preHandler: [requireAuth] }, async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });

  app.get("/me", { preHandler: [requireAuth] }, async (request) => ({ ok: true, user: request.user }));

  app.post("/accept-invite", { config: tightLimit }, async (request, reply) => {
    const { token, name, password } = acceptInviteSchema.parse(request.body);
    const user = await db.user.findFirst({ where: { inviteTokenHash: hashToken(token), status: "invited" } });
    if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
      return reply.code(400).send({ ok: false, error: "invite invalid or expired" });
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        name,
        passwordHash: await bcrypt.hash(password, 12),
        status: "active",
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    await createSession(reply, updated.id);
    return { ok: true, user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } };
  });

  app.post("/forgot-password", { config: tightLimit }, async (request) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    const user = await db.user.findUnique({ where: { email } });
    // Always report success — never leak whether an account exists.
    if (user && user.status === "active") {
      const token = newToken();
      await db.user.update({
        where: { id: user.id },
        data: { resetTokenHash: hashToken(token), resetExpiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      const resetUrl = `${env.DASHBOARD_URL}/reset-password?token=${token}`;
      try {
        await getMailer().send({ to: user.email, ...templates.passwordReset({ resetUrl }) });
      } catch (err) {
        request.log.error({ err }, "password-reset email failed");
      }
    }
    return { ok: true };
  });

  app.post("/reset-password", { config: tightLimit }, async (request, reply) => {
    const { token, password } = resetPasswordSchema.parse(request.body);
    const user = await db.user.findFirst({ where: { resetTokenHash: hashToken(token) } });
    if (!user || !user.resetExpiresAt || user.resetExpiresAt < new Date()) {
      return reply.code(400).send({ ok: false, error: "reset link invalid or expired" });
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 12), resetTokenHash: null, resetExpiresAt: null },
    });
    // A reset invalidates every existing session for the account.
    await db.session.deleteMany({ where: { userId: user.id } });
    return { ok: true };
  });
}
