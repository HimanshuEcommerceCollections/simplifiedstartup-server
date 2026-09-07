import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { list } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

/**
 * Captures the whole database + blob store into snapshots/<timestamp>/ so a
 * testing round can be rolled back exactly (npm run db:restore -- <dir>).
 * Snapshots hold real user data (incl. password hashes) — the folder is
 * gitignored; keep it local.
 */
const db = new PrismaClient();

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.resolve("snapshots", stamp);
  mkdirSync(path.join(dir, "blobs"), { recursive: true });

  const data = {
    users: await db.user.findMany(),
    sessions: [], // everyone re-logs-in after a restore
    leads: await db.lead.findMany(),
    subscribers: await db.subscriber.findMany(),
    contentCategories: await db.contentCategory.findMany(),
    articles: await db.article.findMany(),
    articleImages: await db.articleImage.findMany(),
    faqs: await db.faq.findMany(),
    glossaryTerms: await db.glossaryTerm.findMany(),
    settings: await db.setting.findMany(),
    careerRoles: await db.careerRole.findMany(),
    jobApplications: await db.jobApplication.findMany(),
  };
  writeFileSync(path.join(dir, "db.json"), JSON.stringify(data, null, 2));

  // blob store: manifest + the files themselves, so restore can re-upload deletions
  const blobs: { pathname: string }[] = [];
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    let cursor: string | undefined;
    do {
      const page = await list({ cursor, limit: 100 });
      for (const b of page.blobs) {
        const res = await fetch(b.url);
        writeFileSync(path.join(dir, "blobs", b.pathname), Buffer.from(await res.arrayBuffer()));
        blobs.push({ pathname: b.pathname });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  writeFileSync(path.join(dir, "blobs.json"), JSON.stringify(blobs, null, 2));

  console.log(`snapshot: ${dir}`);
  for (const [k, v] of Object.entries(data)) console.log(`  ${k}: ${(v as unknown[]).length}`);
  console.log(`  blobs: ${blobs.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
