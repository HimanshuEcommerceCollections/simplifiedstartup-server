import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { del, list, put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

/**
 * Restores a snapshot taken by db-snapshot.ts, wiping whatever the testing
 * round changed: every table is emptied and re-imported exactly (same ids,
 * timestamps, password hashes), all sessions are cleared (everyone signs in
 * again), and the blob store is reconciled — files added since the snapshot
 * are deleted, files deleted since are re-uploaded.
 *
 *   npm run db:restore -- snapshots/<timestamp>
 *   npm run db:restore            (uses the newest snapshot)
 */
const db = new PrismaClient();

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain" };

async function main() {
  let dir = process.argv[2];
  if (!dir) {
    const all = readdirSync(path.resolve("snapshots")).sort();
    if (all.length === 0) throw new Error("no snapshots found");
    dir = path.join("snapshots", all[all.length - 1]);
  }
  dir = path.resolve(dir);
  console.log(`restoring from ${dir}`);
  const data = JSON.parse(readFileSync(path.join(dir, "db.json"), "utf8"));

  // wipe in FK-safe order (children first)
  await db.session.deleteMany();
  await db.articleImage.deleteMany();
  await db.article.deleteMany();
  await db.faq.deleteMany();
  await db.jobApplication.deleteMany();
  await db.careerRole.deleteMany();
  await db.contentCategory.deleteMany();
  await db.glossaryTerm.deleteMany();
  await db.lead.deleteMany();
  await db.subscriber.deleteMany();
  await db.setting.deleteMany();
  await db.user.deleteMany();

  // re-import (parents first); ISO strings are valid Prisma DateTime input
  await db.user.createMany({ data: data.users });
  await db.lead.createMany({ data: data.leads });
  await db.subscriber.createMany({ data: data.subscribers });
  await db.contentCategory.createMany({ data: data.contentCategories });
  await db.article.createMany({ data: data.articles });
  await db.articleImage.createMany({ data: data.articleImages });
  await db.faq.createMany({ data: data.faqs });
  await db.glossaryTerm.createMany({ data: data.glossaryTerms });
  await db.setting.createMany({ data: data.settings });
  await db.careerRole.createMany({ data: data.careerRoles });
  await db.jobApplication.createMany({ data: data.jobApplications });
  for (const k of ["users", "leads", "subscribers", "contentCategories", "articles", "articleImages", "faqs", "glossaryTerms", "settings", "careerRoles", "jobApplications"]) {
    console.log(`  ${k}: ${data[k].length}`);
  }

  // reconcile the blob store with the snapshot manifest
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const want = new Set<string>(JSON.parse(readFileSync(path.join(dir, "blobs.json"), "utf8")).map((b: { pathname: string }) => b.pathname));
    const have = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = await list({ cursor, limit: 100 });
      for (const b of page.blobs) have.set(b.pathname, b.url);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    for (const [pathname, url] of have) {
      if (!want.has(pathname)) {
        await del(url);
        console.log(`  blob deleted (added during testing): ${pathname}`);
      }
    }
    for (const pathname of want) {
      if (!have.has(pathname)) {
        const buffer = readFileSync(path.join(dir, "blobs", pathname));
        const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
        await put(pathname, buffer, { access: "public", contentType: MIME[ext] ?? "application/octet-stream", addRandomSuffix: false });
        console.log(`  blob re-uploaded (deleted during testing): ${pathname}`);
      }
    }
    console.log(`  blobs reconciled: ${want.size}`);
  }

  console.log("restore complete — all sessions cleared, everyone signs in again.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
