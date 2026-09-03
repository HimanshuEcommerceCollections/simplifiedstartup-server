import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/** Dev helper: prints row counts and the latest intake rows. */
const db = new PrismaClient();

async function main() {
  const [users, leads, subscribers] = await Promise.all([db.user.count(), db.lead.count(), db.subscriber.count()]);
  console.log({ users, leads, subscribers });
  console.log(
    "latest leads:",
    await db.lead.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { name: true, email: true, stage: true, need: true, status: true, createdAt: true } })
  );
  console.log(
    "latest subscribers:",
    await db.subscriber.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { email: true, sourcePage: true, createdAt: true } })
  );
}

main().finally(() => db.$disconnect());
