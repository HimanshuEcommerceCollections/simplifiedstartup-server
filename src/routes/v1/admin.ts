import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LEAD_STATUSES,
  inviteSchema,
  leadPatchSchema,
  listQuerySchema,
  userPatchSchema,
  type LeadStatus,
} from "../../contracts";
import { db } from "../../lib/db";
import { env } from "../../lib/env";
import { getMailer, templates } from "../../lib/mail";
import { INVITE_TTL_MS, hashToken, newToken, requireAuth, requireRole } from "../../lib/auth";

const idParam = z.object({ id: z.string().min(1) });

/** Everything under /api/v1/admin — session required; roles per route group. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  const canReadIntake = requireRole("ADMIN", "EDITOR", "VIEWER");
  const canWriteIntake = requireRole("ADMIN", "EDITOR");
  const adminOnly = requireRole("ADMIN");

  // ---------- overview ----------

  app.get("/stats", async () => {
    const [total, subscribers, users, ...byStatus] = await Promise.all([
      db.lead.count(),
      db.subscriber.count(),
      db.user.count({ where: { status: { not: "disabled" } } }),
      ...LEAD_STATUSES.map((status) => db.lead.count({ where: { status } })),
    ]);
    const leads = { total } as { total: number } & Record<LeadStatus, number>;
    LEAD_STATUSES.forEach((status, i) => (leads[status] = byStatus[i]));
    return { ok: true, stats: { leads, subscribers, users } };
  });

  // ---------- leads ----------

  app.get("/leads", { preHandler: [canReadIntake] }, async (request) => {
    const { page, pageSize, q, status } = listQuerySchema.parse(request.query);
    const where = {
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { business: { contains: q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      db.lead.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db.lead.count({ where }),
    ]);
    return { ok: true, items, total, page, pageSize };
  });

  app.patch("/leads/:id", { preHandler: [canWriteIntake] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = leadPatchSchema.parse(request.body);
    const existing = await db.lead.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    const lead = await db.lead.update({ where: { id }, data: patch });
    return { ok: true, lead };
  });

  app.delete("/leads/:id", { preHandler: [canWriteIntake] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await db.lead.deleteMany({ where: { id } });
    return reply.send({ ok: true });
  });

  // ---------- subscribers ----------

  app.get("/subscribers", { preHandler: [canReadIntake] }, async (request) => {
    const { page, pageSize, q } = listQuerySchema.parse(request.query);
    const where = q ? { email: { contains: q } } : {};
    const [items, total] = await Promise.all([
      db.subscriber.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db.subscriber.count({ where }),
    ]);
    return { ok: true, items, total, page, pageSize };
  });

  app.delete("/subscribers/:id", { preHandler: [canWriteIntake] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await db.subscriber.deleteMany({ where: { id } });
    return reply.send({ ok: true });
  });

  app.get("/subscribers/export.csv", { preHandler: [canWriteIntake] }, async (_request, reply) => {
    const rows = await db.subscriber.findMany({ orderBy: { createdAt: "desc" } });
    const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["email,source_page,subscribed_at", ...rows.map((r) => [esc(r.email), esc(r.sourcePage), esc(r.createdAt.toISOString())].join(","))].join("\r\n");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(csv);
  });

  // ---------- team (ADMIN only) ----------

  app.get("/users", { preHandler: [adminOnly] }, async () => {
    const users = await db.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { invitedBy: { select: { name: true, email: true } } },
    });
    return {
      ok: true,
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
        invitedByName: u.invitedBy?.name ?? u.invitedBy?.email ?? null,
      })),
    };
  });

  app.post("/users/invite", { preHandler: [adminOnly] }, async (request, reply) => {
    const { email, role } = inviteSchema.parse(request.body);
    if (await db.user.findUnique({ where: { email } })) {
      return reply.code(409).send({ ok: false, error: "a user with this email already exists" });
    }

    const token = newToken();
    const user = await db.user.create({
      data: {
        email,
        role,
        status: "invited",
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: request.user!.id,
      },
    });

    const inviteUrl = `${env.DASHBOARD_URL}/accept-invite?token=${token}`;
    try {
      await getMailer().send({
        to: email,
        ...templates.userInvite({ inviteUrl, role, invitedByName: request.user!.name ?? request.user!.email }),
      });
    } catch (err) {
      // The row exists but the mail failed — surface it so the admin can resend.
      request.log.error({ err }, "invite email failed");
      return reply.code(502).send({ ok: false, error: "user created but the invite email failed — use resend" });
    }
    return reply.code(201).send({ ok: true, id: user.id });
  });

  app.post("/users/:id/resend-invite", { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const user = await db.user.findUnique({ where: { id } });
    if (!user || user.status !== "invited") {
      return reply.code(400).send({ ok: false, error: "only pending invites can be resent" });
    }

    const token = newToken();
    await db.user.update({
      where: { id },
      data: { inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    const inviteUrl = `${env.DASHBOARD_URL}/accept-invite?token=${token}`;
    await getMailer().send({
      to: user.email,
      ...templates.userInvite({ inviteUrl, role: user.role as never, invitedByName: request.user!.name ?? request.user!.email }),
    });
    return { ok: true };
  });

  app.patch("/users/:id", { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = userPatchSchema.parse(request.body);
    if (id === request.user!.id) {
      return reply.code(400).send({ ok: false, error: "you can't change your own role or status" });
    }
    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });

    const user = await db.user.update({ where: { id }, data: patch });
    if (patch.status === "disabled") {
      await db.session.deleteMany({ where: { userId: id } });
    }
    return { ok: true, user: { id: user.id, role: user.role, status: user.status } };
  });

  app.delete("/users/:id", { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (id === request.user!.id) return reply.code(400).send({ ok: false, error: "you can't delete yourself" });
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ ok: false, error: "not found" });
    if (user.status !== "invited") {
      return reply.code(400).send({ ok: false, error: "only pending invites can be removed — disable active users instead" });
    }
    await db.user.delete({ where: { id } });
    return { ok: true };
  });
}
