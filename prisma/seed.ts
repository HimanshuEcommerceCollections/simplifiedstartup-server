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

/** The career postings the website shipped with — seeded so the build-time fetch matches. */
const WEBSITE_ROLES = [
  { title: "Growth Marketer", type: "Full-time", description: "Own SEO, paid, and content programs for a handful of startups end to end." },
  { title: "Web Developer (Front-end)", type: "Full-time", description: "Design-minded builder shipping fast, conversion-focused sites." },
  { title: "Brand & Content Designer", type: "Contract → Full-time", description: "Identity systems, landing pages, and content that looks like the leader in the space." },
  { title: "AI Automation Engineer", type: "Full-time", description: "Build workflows and agents that take real busywork off clients' plates." },
  { title: "Virtual Assistant / Ops Specialist", type: "Full-time", description: "Senior support across admin, inbox, and client operations." },
];

async function seedCareerRoles() {
  for (const [i, role] of WEBSITE_ROLES.entries()) {
    const existing = await db.careerRole.findFirst({ where: { title: role.title } });
    if (!existing) {
      await db.careerRole.create({ data: { ...role, location: "Remote", sortOrder: i } });
      console.log(`Seeded career role: ${role.title}`);
    }
  }
}

main()
  .then(seedCareerRoles)
  .finally(() => db.$disconnect());
