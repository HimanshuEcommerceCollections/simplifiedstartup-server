import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  applicationListQuerySchema,
  applicationPatchSchema,
  careerRoleInputSchema,
  careerRolePatchSchema,
} from "../../contracts";
import { db } from "../../lib/db";
import { env } from "../../lib/env";
import { getStorage } from "../../lib/storage";
import { sanitizeRichText } from "../../lib/sanitize";
import { requireAuth, requireRole } from "../../lib/auth";

const idParam = z.object({ id: z.string().min(1) });

/**
 * Careers domain under /api/v1/admin — RECRUITER and ADMIN only,
 * plus the publish endpoint shared with EDITOR (it rebuilds the whole site).
 */
export async function careersAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  const recruiterOnly = requireRole("ADMIN", "RECRUITER");
  const canPublish = requireRole("ADMIN", "EDITOR", "RECRUITER");

  // ---------- job postings ----------

  app.get("/career-roles", { preHandler: [recruiterOnly] }, async () => {
    const roles = await db.careerRole.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { applications: true } } },
    });
    return {
      ok: true,
      items: roles.map(({ _count, ...role }) => ({
        ...role,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
        applicationCount: _count.applications,
      })),
    };
  });

  app.post("/career-roles", { preHandler: [recruiterOnly] }, async (request, reply) => {
    const input = careerRoleInputSchema.parse(request.body);
    const role = await db.careerRole.create({
      data: { ...input, location: input.location || null, body: sanitizeRichText(input.body) },
    });
    return reply.code(201).send({ ok: true, id: role.id });
  });

  app.patch("/career-roles/:id", { preHandler: [recruiterOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = careerRolePatchSchema.parse(request.body);
    const existing = await db.careerRole.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    await db.careerRole.update({
      where: { id },
      data: {
        ...patch,
        ...(patch.location !== undefined ? { location: patch.location || null } : {}),
        ...(patch.body !== undefined ? { body: sanitizeRichText(patch.body) } : {}),
      },
    });
    return { ok: true };
  });

  app.delete("/career-roles/:id", { preHandler: [recruiterOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    // applications survive (roleId becomes null = general application)
    await db.careerRole.deleteMany({ where: { id } });
    return reply.send({ ok: true });
  });

  // ---------- applications ----------

  app.get("/applications", { preHandler: [recruiterOnly] }, async (request) => {
    const { page, pageSize, status, roleId } = applicationListQuerySchema.parse(request.query);
    const where = { ...(status ? { status } : {}), ...(roleId ? { roleId } : {}) };
    const [rows, total] = await Promise.all([
      db.jobApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { role: { select: { title: true } } },
      }),
      db.jobApplication.count({ where }),
    ]);
    return {
      ok: true,
      items: rows.map(({ role, cvPath, ...a }) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        roleTitle: role?.title ?? null,
        hasCv: !!cvPath,
      })),
      total,
      page,
      pageSize,
    };
  });

  app.patch("/applications/:id", { preHandler: [recruiterOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { status } = applicationPatchSchema.parse(request.body);
    const existing = await db.jobApplication.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    await db.jobApplication.update({ where: { id }, data: { status } });
    return { ok: true };
  });

  app.delete("/applications/:id", { preHandler: [recruiterOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const existing = await db.jobApplication.findUnique({ where: { id } });
    if (existing?.cvPath) await getStorage().remove(existing.cvPath);
    await db.jobApplication.deleteMany({ where: { id } });
    return reply.send({ ok: true });
  });

  app.get("/applications/:id/cv", { preHandler: [recruiterOnly] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const application = await db.jobApplication.findUnique({ where: { id } });
    if (!application?.cvPath) return reply.code(404).send({ ok: false, error: "no CV on this application" });
    const { stream, size } = await getStorage().openRead(application.cvPath);
    const ext = application.cvPath.split(".").pop() ?? "pdf";
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", size);
    reply.header("Content-Disposition", `attachment; filename="cv-${application.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}.${ext}"`);
    return reply.send(stream);
  });

  // ---------- publish to website ----------

  app.get("/publish", async () => {
    const [at, by] = await Promise.all([
      db.setting.findUnique({ where: { key: "lastPublishedAt" } }),
      db.setting.findUnique({ where: { key: "lastPublishedBy" } }),
    ]);
    return {
      ok: true,
      status: {
        hookConfigured: !!env.WEBSITE_DEPLOY_HOOK_URL,
        lastPublishedAt: at?.value ?? null,
        lastPublishedBy: by?.value ?? null,
      },
    };
  });

  app.post("/publish", { preHandler: [canPublish] }, async (request, reply) => {
    if (env.WEBSITE_DEPLOY_HOOK_URL) {
      const res = await fetch(env.WEBSITE_DEPLOY_HOOK_URL, { method: "POST" });
      if (!res.ok) {
        return reply.code(502).send({ ok: false, error: `deploy hook answered ${res.status}` });
      }
    }
    const now = new Date().toISOString();
    const by = request.user!.name ?? request.user!.email;
    await Promise.all([
      db.setting.upsert({ where: { key: "lastPublishedAt" }, update: { value: now }, create: { key: "lastPublishedAt", value: now } }),
      db.setting.upsert({ where: { key: "lastPublishedBy" }, update: { value: by }, create: { key: "lastPublishedBy", value: by } }),
    ]);
    return { ok: true, hookConfigured: !!env.WEBSITE_DEPLOY_HOOK_URL, lastPublishedAt: now };
  });
}
