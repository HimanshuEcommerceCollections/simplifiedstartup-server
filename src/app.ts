import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "./lib/env";
import { filesRoutes, publicRoutes } from "./routes/v1/public";
import { authRoutes } from "./routes/v1/auth";
import { adminRoutes } from "./routes/v1/admin";
import { careersAdminRoutes } from "./routes/v1/careers";
import { contentAdminRoutes } from "./routes/v1/content";
import { CV_MAX_BYTES } from "./contracts";

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
  await app.register(multipart, { limits: { fileSize: CV_MAX_BYTES, files: 1, fields: 12 } });
  await app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });

  // Accept body-less / non-JSON POSTs (e.g. logout with no body) instead of 415ing;
  // routes that expect a body still 400 through their zod schemas.
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
    done(null, body.length ? body : null);
  });

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
  await app.register(filesRoutes);
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(adminRoutes, { prefix: "/api/v1/admin" });
  await app.register(careersAdminRoutes, { prefix: "/api/v1/admin" });
  await app.register(contentAdminRoutes, { prefix: "/api/v1/admin" });

  return app;
}
