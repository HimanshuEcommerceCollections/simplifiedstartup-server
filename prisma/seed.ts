import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * Bootstraps the first ADMIN from SEED_ADMIN_* env vars — the dashboard is
 * invite-only, so someone has to exist before anyone can be invited.
 * Safe to re-run: does nothing if the user already exists.
 */
const db = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";
  if (!email || !password) {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — nothing to seed.");
    return;
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — skipping.`);
    return;
  }

  await db.user.create({
    data: {
      email,
      name,
      role: "ADMIN",
      status: "active",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  console.log(`Created ADMIN ${email}. Change the password after first login.`);
}

main().finally(() => db.$disconnect());
