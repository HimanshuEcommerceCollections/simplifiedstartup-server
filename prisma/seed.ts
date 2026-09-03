import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
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

/** Blog categories + the four articles the website shipped with (artwork = client-side preset keys). */
const BLOG_CATEGORIES = [
  { key: "seo", label: "SEO" },
  { key: "social", label: "Social Media" },
  { key: "ads", label: "Paid Ads" },
  { key: "ai", label: "AI & Automation" },
  { key: "pricing", label: "Pricing & Choosing an Agency" },
];

const WEBSITE_ARTICLES = [
  {
    slug: "how-to-choose-a-digital-marketing-agency",
    title: "How to Choose a Digital Marketing Agency (Without Getting Burned)",
    summary:
      "What to ask before signing with any agency, the red flags that mean walk away, and why hidden pricing is usually a bad sign. Ends with a short checklist you can use on your own.",
    readTime: "6 min read",
    artwork: "agency-checklist",
    featured: true,
    category: "pricing",
  },
  {
    slug: "what-marketing-actually-costs-in-2026",
    title: "What Marketing Actually Costs in 2026 (With Real Numbers)",
    summary:
      "A transparent breakdown of typical SEO, social, and ad-management pricing across the industry — so you know whether a quote you received is fair.",
    readTime: "7 min read",
    artwork: "cost-bars",
    featured: false,
    category: "pricing",
  },
  {
    slug: "seo-checklist-for-small-businesses",
    title: "SEO Checklist for Small Businesses",
    summary:
      "The exact on-page, technical, and local SEO basics every small-business site needs — a step-by-step list a non-technical owner can follow.",
    readTime: "8 min read",
    artwork: "seo-scope",
    featured: false,
    category: "seo",
  },
  {
    slug: "5-social-media-mistakes-quietly-hurting-local-businesses",
    title: "5 Social Media Mistakes Quietly Hurting Local Businesses",
    summary:
      "Common, fixable mistakes seen across every industry — posting without a goal, ignoring comments, inconsistent branding, and more.",
    readTime: "5 min read",
    artwork: "social-chat",
    featured: false,
    category: "social",
  },
];

/** FAQ + glossary content generated from the website's bundled data (prisma/seed-data). */
async function seedContent() {
  const dataDir = path.join(__dirname, "seed-data");

  if ((await db.contentCategory.count({ where: { collection: "blog" } })) === 0) {
    for (const [i, cat] of BLOG_CATEGORIES.entries()) {
      await db.contentCategory.create({ data: { collection: "blog", key: cat.key, label: cat.label, sortOrder: i } });
    }
    console.log(`Seeded ${BLOG_CATEGORIES.length} blog categories.`);
  }

  if ((await db.article.count()) === 0) {
    for (const [i, article] of WEBSITE_ARTICLES.entries()) {
      const category = await db.contentCategory.findUnique({
        where: { collection_key: { collection: "blog", key: article.category } },
      });
      if (!category) continue;
      const { category: _key, ...data } = article;
      await db.article.create({ data: { ...data, sortOrder: i, categoryId: category.id } });
    }
    console.log(`Seeded ${WEBSITE_ARTICLES.length} articles.`);
  }

  if ((await db.contentCategory.count({ where: { collection: "faq" } })) === 0) {
    const faqCats = JSON.parse(readFileSync(path.join(dataDir, "faqs.json"), "utf8")) as {
      key: string;
      label: string;
      sortOrder: number;
      items: { question: string; answer: string; sortOrder: number }[];
    }[];
    let count = 0;
    for (const cat of faqCats) {
      const row = await db.contentCategory.create({
        data: { collection: "faq", key: cat.key, label: cat.label, sortOrder: cat.sortOrder },
      });
      for (const item of cat.items) {
        await db.faq.create({ data: { ...item, categoryId: row.id } });
        count++;
      }
    }
    console.log(`Seeded ${faqCats.length} FAQ categories / ${count} questions.`);
  }

  if ((await db.glossaryTerm.count()) === 0) {
    const terms = JSON.parse(readFileSync(path.join(dataDir, "glossary.json"), "utf8")) as {
      term: string;
      definition: string;
      sortOrder: number;
    }[];
    for (const term of terms) await db.glossaryTerm.create({ data: term });
    console.log(`Seeded ${terms.length} glossary terms.`);
  }
}

main()
  .then(seedCareerRoles)
  .then(seedContent)
  .finally(() => db.$disconnect());
