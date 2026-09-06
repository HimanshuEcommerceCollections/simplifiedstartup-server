import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../src/app";

/**
 * Vercel serverless entrypoint. Fastify normally owns a long-running listener;
 * here we boot it once per lambda instance and forward Vercel's request/response
 * pair into its internal server. vercel.json rewrites every path to this function.
 */
const ready = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  app.server.emit("request", req, res);
}
