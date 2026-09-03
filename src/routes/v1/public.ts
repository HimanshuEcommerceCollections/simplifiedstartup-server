import type { FastifyInstance } from "fastify";
import { leadInputSchema, subscriberInputSchema } from "../../contracts";
import { db } from "../../lib/db";
import { getMailer, templates } from "../../lib/mail";
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
}
