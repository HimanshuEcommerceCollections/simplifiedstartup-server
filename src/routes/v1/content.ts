import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  articleImagePatchSchema,
  articleInputSchema,
  articlePatchSchema,
  categoryInputSchema,
  categoryPatchSchema,
  faqInputSchema,
  faqPatchSchema,
  glossaryInputSchema,
  glossaryPatchSchema,
} from "../../contracts";
import { db } from "../../lib/db";
import { sanitizeRichText } from "../../lib/sanitize";
import { getStorage } from "../../lib/storage";
import { requireAuth, requireRole } from "../../lib/auth";

const idParam = z.object({ id: z.string().min(1) });
const collectionQuery = z.object({ collection: z.enum(["blog", "faq"]).optional() });

/** Reads one multipart request: text fields + the first non-empty file. */
async function readImagePart(request: FastifyRequest) {
  const fields: Record<string, string> = {};
  let file: { buffer: Buffer; filename: string; mimetype: string } | null = null;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (buffer.length > 0 && !file) file = { buffer, filename: part.filename ?? "image", mimetype: part.mimetype };
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, file };
}

/**
 * Validates + stores an uploaded image; replies with the error itself and
 * returns null when the request is unusable.
 */
async function saveImage(request: FastifyRequest, reply: FastifyReply): Promise<{ key: string; alt: string } | null> {
  if (!request.isMultipart()) {
    await reply.code(400).send({ ok: false, error: "expected multipart/form-data" });
    return null;
  }
  const { fields, file } = await readImagePart(request);
  if (!file) {
    await reply.code(400).send({ ok: false, error: "no image file received" });
    return null;
  }
  if (!IMAGE_MIME_TYPES.includes(file.mimetype as (typeof IMAGE_MIME_TYPES)[number])) {
    await reply.code(400).send({ ok: false, error: "images must be JPEG, PNG, WebP, or GIF" });
    return null;
  }
  if (file.buffer.length > IMAGE_MAX_BYTES) {
    await reply.code(413).send({ ok: false, error: "image is larger than 4MB" });
    return null;
  }
  const { key } = await getStorage().save(file);
  return { key, alt: (fields.alt ?? "").slice(0, 200) };
}

/** Blog / FAQ / glossary management — ADMIN + EDITOR + CONTENT_WRITER write, VIEWER read. */
export async function contentAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  const canRead = requireRole("ADMIN", "EDITOR", "CONTENT_WRITER", "VIEWER");
  const canWrite = requireRole("ADMIN", "EDITOR", "CONTENT_WRITER");

  // ---------- categories ----------

  app.get("/content-categories", { preHandler: [canRead] }, async (request) => {
    const { collection } = collectionQuery.parse(request.query);
    const rows = await db.contentCategory.findMany({
      where: collection ? { collection } : {},
      orderBy: [{ collection: "asc" }, { sortOrder: "asc" }],
      include: { _count: { select: { articles: true, faqs: true } } },
    });
    return {
      ok: true,
      items: rows.map(({ _count, ...c }) => ({
        id: c.id,
        collection: c.collection,
        key: c.key,
        label: c.label,
        sortOrder: c.sortOrder,
        itemCount: _count.articles + _count.faqs,
      })),
    };
  });

  app.post("/content-categories", { preHandler: [canWrite] }, async (request, reply) => {
    const input = categoryInputSchema.parse(request.body);
    const exists = await db.contentCategory.findUnique({
      where: { collection_key: { collection: input.collection, key: input.key } },
    });
    if (exists) return reply.code(409).send({ ok: false, error: "a category with this key already exists" });
    const row = await db.contentCategory.create({ data: input });
    return reply.code(201).send({ ok: true, id: row.id });
  });

  app.patch("/content-categories/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = categoryPatchSchema.parse(request.body);
    const existing = await db.contentCategory.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    await db.contentCategory.update({ where: { id }, data: patch });
    return { ok: true };
  });

  app.delete("/content-categories/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const existing = await db.contentCategory.findUnique({
      where: { id },
      include: { _count: { select: { articles: true, faqs: true } } },
    });
    if (!existing) return reply.send({ ok: true });
    if (existing._count.articles + existing._count.faqs > 0) {
      return reply.code(409).send({ ok: false, error: "category still has items — move or delete them first" });
    }
    await db.contentCategory.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- articles ----------

  const articleInclude = {
    category: { select: { key: true, label: true } },
    images: { orderBy: { sortOrder: "asc" as const } },
  };

  const toArticleDto = (a: {
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
    updatedAt: Date;
    category: { key: string; label: string };
    images: { id: string; key: string; alt: string; isCover: boolean; sortOrder: number }[];
  }) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    readTime: a.readTime,
    artwork: a.artwork,
    body: a.body,
    featured: a.featured,
    published: a.published,
    sortOrder: a.sortOrder,
    categoryId: a.categoryId,
    categoryKey: a.category.key,
    categoryLabel: a.category.label,
    images: a.images.map((img) => ({ id: img.id, url: `/files/${img.key}`, alt: img.alt, isCover: img.isCover, sortOrder: img.sortOrder })),
    updatedAt: a.updatedAt.toISOString(),
  });

  async function assertBlogCategory(categoryId: string) {
    const cat = await db.contentCategory.findUnique({ where: { id: categoryId } });
    if (!cat || cat.collection !== "blog") throw Object.assign(new Error("categoryId must be a blog category"), { statusCode: 400 });
  }

  app.get("/articles", { preHandler: [canRead] }, async () => {
    const rows = await db.article.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], include: articleInclude });
    return { ok: true, items: rows.map(toArticleDto) };
  });

  app.post("/articles", { preHandler: [canWrite] }, async (request, reply) => {
    const input = articleInputSchema.parse(request.body);
    await assertBlogCategory(input.categoryId);
    if (await db.article.findUnique({ where: { slug: input.slug } })) {
      return reply.code(409).send({ ok: false, error: "an article with this slug already exists" });
    }
    const row = await db.article.create({ data: { ...input, body: sanitizeRichText(input.body) } });
    return reply.code(201).send({ ok: true, id: row.id });
  });

  app.patch("/articles/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = articlePatchSchema.parse(request.body);
    const existing = await db.article.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    if (patch.categoryId) await assertBlogCategory(patch.categoryId);
    if (patch.slug && patch.slug !== existing.slug) {
      if (await db.article.findUnique({ where: { slug: patch.slug } })) {
        return reply.code(409).send({ ok: false, error: "an article with this slug already exists" });
      }
    }
    await db.article.update({
      where: { id },
      data: { ...patch, ...(patch.body !== undefined ? { body: sanitizeRichText(patch.body) } : {}) },
    });
    return { ok: true };
  });

  app.delete("/articles/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const images = await db.articleImage.findMany({ where: { articleId: id } });
    await db.article.deleteMany({ where: { id } }); // cascades ArticleImage rows
    await Promise.all(images.map((img) => getStorage().remove(img.key)));
    return reply.send({ ok: true });
  });

  // ---------- article images + editor uploads ----------

  /** Generic upload for inline editor images — returns the public URL. */
  app.post("/uploads", { preHandler: [canWrite] }, async (request, reply) => {
    const saved = await saveImage(request, reply);
    if (!saved) return;
    return reply.code(201).send({ ok: true, key: saved.key, url: `/files/${saved.key}` });
  });

  app.post("/articles/:id/images", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const article = await db.article.findUnique({ where: { id } });
    if (!article) return reply.code(404).send({ ok: false, error: "not found" });
    const saved = await saveImage(request, reply);
    if (!saved) return;
    const count = await db.articleImage.count({ where: { articleId: id } });
    const row = await db.articleImage.create({
      data: { articleId: id, key: saved.key, alt: saved.alt, sortOrder: count, isCover: count === 0 },
    });
    return reply.code(201).send({ ok: true, id: row.id, url: `/files/${saved.key}` });
  });

  app.patch("/article-images/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = articleImagePatchSchema.parse(request.body);
    const existing = await db.articleImage.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    if (patch.isCover) {
      await db.articleImage.updateMany({ where: { articleId: existing.articleId }, data: { isCover: false } });
    }
    await db.articleImage.update({ where: { id }, data: patch });
    return { ok: true };
  });

  app.delete("/article-images/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const existing = await db.articleImage.findUnique({ where: { id } });
    if (existing) {
      await db.articleImage.delete({ where: { id } });
      await getStorage().remove(existing.key);
    }
    return reply.send({ ok: true });
  });

  // ---------- faqs ----------

  const faqInclude = { category: { select: { key: true, label: true } } };
  const toFaqDto = (f: {
    id: string;
    question: string;
    answer: string;
    categoryId: string;
    published: boolean;
    sortOrder: number;
    category: { key: string; label: string };
  }) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    categoryId: f.categoryId,
    categoryKey: f.category.key,
    categoryLabel: f.category.label,
    published: f.published,
    sortOrder: f.sortOrder,
  });

  async function assertFaqCategory(categoryId: string) {
    const cat = await db.contentCategory.findUnique({ where: { id: categoryId } });
    if (!cat || cat.collection !== "faq") throw Object.assign(new Error("categoryId must be a faq category"), { statusCode: 400 });
  }

  app.get("/faqs", { preHandler: [canRead] }, async () => {
    const rows = await db.faq.findMany({
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      include: faqInclude,
    });
    return { ok: true, items: rows.map(toFaqDto) };
  });

  app.post("/faqs", { preHandler: [canWrite] }, async (request, reply) => {
    const input = faqInputSchema.parse(request.body);
    await assertFaqCategory(input.categoryId);
    const row = await db.faq.create({ data: input });
    return reply.code(201).send({ ok: true, id: row.id });
  });

  app.patch("/faqs/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = faqPatchSchema.parse(request.body);
    const existing = await db.faq.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    if (patch.categoryId) await assertFaqCategory(patch.categoryId);
    await db.faq.update({ where: { id }, data: patch });
    return { ok: true };
  });

  app.delete("/faqs/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await db.faq.deleteMany({ where: { id } });
    return reply.send({ ok: true });
  });

  // ---------- glossary ----------

  app.get("/glossary", { preHandler: [canRead] }, async () => {
    const rows = await db.glossaryTerm.findMany({ orderBy: { term: "asc" } });
    return { ok: true, items: rows };
  });

  app.post("/glossary", { preHandler: [canWrite] }, async (request, reply) => {
    const input = glossaryInputSchema.parse(request.body);
    const row = await db.glossaryTerm.create({ data: input });
    return reply.code(201).send({ ok: true, id: row.id });
  });

  app.patch("/glossary/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const patch = glossaryPatchSchema.parse(request.body);
    const existing = await db.glossaryTerm.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ ok: false, error: "not found" });
    await db.glossaryTerm.update({ where: { id }, data: patch });
    return { ok: true };
  });

  app.delete("/glossary/:id", { preHandler: [canWrite] }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await db.glossaryTerm.deleteMany({ where: { id } });
    return reply.send({ ok: true });
  });
}
