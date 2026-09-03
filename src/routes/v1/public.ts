import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CV_MAX_BYTES,
  CV_MIME_TYPES,
  applicationInputSchema,
  leadInputSchema,
  subscriberInputSchema,
} from "../../contracts";
import { db } from "../../lib/db";
import { getMailer, templates } from "../../lib/mail";
import { getStorage } from "../../lib/storage";
import { env } from "../../lib/env";

/**
 * Public intake endpoints, called by the website. Both carry a `company`
 * honeypot field: bots that fill it get a fake success and nothing is stored.
 * Per-IP rate limits are tighter here than the global default.
 */
export async function publicRoutes(app: FastifyInstance) {
  const intakeLimit = { rateLimit: { max: 5, timeWindow: "1 minute" } };

  app.post("/leads", { config: intakeLimit }, async (request, reply) => {
    const input = leadInputSchema.parse(request.body);
    if (input.company) return reply.code(201).send({ ok: true }); // honeypot

    const lead = await db.lead.create({
      data: {
        name: input.name,
        email: input.email,
        business: input.business || null,
        stage: input.stage,
        need: input.need,
        message: input.message || null,
      },
    });

    // Notify, but never fail the visitor's submission over a mail hiccup.
    try {
      await getMailer().send({ to: env.NOTIFY_EMAIL, ...templates.leadNotification(lead) });
    } catch (err) {
      request.log.error({ err }, "lead notification email failed");
    }

    return reply.code(201).send({ ok: true, id: lead.id });
  });

  app.post("/subscribers", { config: intakeLimit }, async (request, reply) => {
    const input = subscriberInputSchema.parse(request.body);
    if (input.company) return reply.code(201).send({ ok: true }); // honeypot

    // Idempotent: re-subscribing the same address is a success, not an error.
    await db.subscriber.upsert({
      where: { email: input.email },
      update: {},
      create: { email: input.email, sourcePage: input.sourcePage || null },
    });

    return reply.code(201).send({ ok: true });
  });

  /** Published career roles — consumed by the website at build time. */
  app.get("/content/career-roles", async () => {
    const roles = await db.careerRole.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, type: true, location: true, description: true, body: true },
    });
    return { ok: true, items: roles };
  });

  /** Published blog cards + category chips — consumed by the website at build time. */
  app.get("/content/articles", async () => {
    const [categories, articles] = await Promise.all([
      db.contentCategory.findMany({ where: { collection: "blog" }, orderBy: { sortOrder: "asc" }, select: { key: true, label: true } }),
      db.article.findMany({
        where: { published: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        include: { category: { select: { key: true, label: true } }, images: { orderBy: { sortOrder: "asc" } } },
      }),
    ]);
    return {
      ok: true,
      categories,
      items: articles.map((a) => {
        const cover = a.images.find((img) => img.isCover) ?? null;
        return {
          slug: a.slug,
          title: a.title,
          summary: a.summary,
          readTime: a.readTime,
          artwork: a.artwork,
          featured: a.featured,
          categoryKey: a.category.key,
          categoryLabel: a.category.label,
          hasBody: !!a.body,
          cover: cover ? { url: `/files/${cover.key}`, alt: cover.alt } : null,
        };
      }),
    };
  });

  /** One published article with its body — powers /blog/[slug]. */
  app.get("/content/articles/:slug", async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(160) }).parse(request.params);
    const a = await db.article.findFirst({
      where: { slug, published: true },
      include: { category: { select: { key: true, label: true } }, images: { orderBy: { sortOrder: "asc" } } },
    });
    if (!a) return reply.code(404).send({ ok: false, error: "not found" });
    return {
      ok: true,
      article: {
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        readTime: a.readTime,
        artwork: a.artwork,
        featured: a.featured,
        categoryKey: a.category.key,
        categoryLabel: a.category.label,
        body: a.body,
        publishedAt: a.createdAt.toISOString(),
        images: a.images.map((img) => ({ url: `/files/${img.key}`, alt: img.alt, isCover: img.isCover })),
      },
    };
  });

  /** Published FAQ categories + questions — consumed by the website at build time. */
  app.get("/content/faqs", async () => {
    const categories = await db.contentCategory.findMany({
      where: { collection: "faq" },
      orderBy: { sortOrder: "asc" },
      include: { faqs: { where: { published: true }, orderBy: { sortOrder: "asc" }, select: { question: true, answer: true } } },
    });
    return {
      ok: true,
      categories: categories
        .filter((c) => c.faqs.length > 0)
        .map((c) => ({ key: c.key, label: c.label, items: c.faqs.map((f) => ({ q: f.question, a: f.answer })) })),
    };
  });

  /** Published glossary terms — the website groups them by letter. */
  app.get("/content/glossary", async () => {
    const items = await db.glossaryTerm.findMany({
      where: { published: true },
      orderBy: { term: "asc" },
      select: { term: true, definition: true },
    });
    return { ok: true, items };
  });

  /** Job application (multipart: fields + optional `cv` file). */
  app.post("/applications", { config: intakeLimit }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ ok: false, error: "expected multipart/form-data" });
    }

    const fields: Record<string, string> = {};
    let cv: { buffer: Buffer; filename: string; mimetype: string } | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "cv") {
          part.file.resume(); // drain and ignore unexpected files
          continue;
        }
        const buffer = await part.toBuffer(); // throws 413 past the multipart fileSize limit
        if (buffer.length > 0) cv = { buffer, filename: part.filename ?? "cv", mimetype: part.mimetype };
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }

    const input = applicationInputSchema.parse(fields);
    if (input.company) return reply.code(201).send({ ok: true }); // honeypot

    if (cv && !CV_MIME_TYPES.includes(cv.mimetype as (typeof CV_MIME_TYPES)[number])) {
      return reply.code(400).send({ ok: false, error: "CV must be a PDF or Word document" });
    }
    if (cv && cv.buffer.length > CV_MAX_BYTES) {
      return reply.code(413).send({ ok: false, error: "CV is larger than 5MB" });
    }

    // A stale/unknown roleId (e.g. role unpublished since the page was built) degrades
    // to a general application rather than failing the applicant.
    let roleId: string | null = null;
    if (input.roleId) {
      const role = await db.careerRole.findUnique({ where: { id: input.roleId } });
      roleId = role?.id ?? null;
    }

    const cvPath = cv ? (await getStorage().save(cv)).key : null;
    const application = await db.jobApplication.create({
      data: {
        roleId,
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        portfolioUrl: input.portfolioUrl || null,
        message: input.message || null,
        cvPath,
      },
    });

    try {
      const role = roleId ? await db.careerRole.findUnique({ where: { id: roleId } }) : null;
      await getMailer().send({
        to: env.NOTIFY_EMAIL,
        subject: `New job application — ${input.name}${role ? ` (${role.title})` : " (general)"}`,
        html: `<p><b>${input.name}</b> (${input.email}) applied${role ? ` for <b>${role.title}</b>` : " (general application)"}.${cv ? " CV attached in the dashboard." : ""}</p>`,
        text: `${input.name} (${input.email}) applied${role ? ` for ${role.title}` : " (general)"}.`,
      });
    } catch (err) {
      request.log.error({ err }, "application notification email failed");
    }

    return reply.code(201).send({ ok: true, id: application.id });
  });
}

/** Public image serving at /files/:key — root-level, no /api/v1 prefix (never CVs: image extensions only). */
export async function filesRoutes(app: FastifyInstance) {
  app.get("/files/:key", async (request, reply) => {
    const { key } = z.object({ key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(200) }).parse(request.params);
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
    if (!mime[ext]) return reply.code(404).send({ ok: false, error: "not found" });
    try {
      const { stream, size } = await getStorage().openRead(key);
      reply.header("Content-Type", mime[ext]);
      reply.header("Content-Length", size);
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.send(stream);
    } catch {
      return reply.code(404).send({ ok: false, error: "not found" });
    }
  });
}
