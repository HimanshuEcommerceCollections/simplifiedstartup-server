import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "./lib/env";
import { publicRoutes } from "./routes/v1/public";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
    },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ ok: false, error: "validation", issues: error.flatten().fieldErrors });
    }
    const fastifyError = error as { statusCode?: number; message?: string };
    if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({ ok: false, error: fastifyError.message ?? "request error" });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ ok: false, error: "internal" });
  });

  app.get("/health", async () => ({ ok: true, service: "simplifiedstartup-server" }));
  await app.register(publicRoutes, { prefix: "/api/v1" });

  return app;
}
