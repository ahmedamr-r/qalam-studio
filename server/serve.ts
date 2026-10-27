import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { loadEnvFiles } from "./env";
import { checkRequest, factsOf, tokenLanding, type GuardConfig } from "./guard";

/**
 * Browser mode: the built UI (dist/) and the core from one Node process, on 127.0.0.1 only.
 * `pnpm build && pnpm start`, then open the printed address.
 */

const root = process.cwd();
loadEnvFiles(root);
// The routes read their settings when they load (src/ai/server.ts), so they load after the env files.
const { createApi } = await import("./app");

const cfg: GuardConfig = { port: Number(process.env.PORT || 3101), token: process.env.QALAM_TOKEN || undefined };
const dist = "dist";

const app = new Hono();
app.use("/api/*", async (c, next) => {
  const verdict = checkRequest(factsOf(c.req.raw), cfg);
  if (!verdict.ok) return c.json({ error: "forbidden", message: verdict.reason }, verdict.status);
  await next();
});
app.route("/", createApi());
app.use("/*", async (c, next) => {
  const landing = c.req.method === "GET" ? tokenLanding(new URL(c.req.url), cfg) : null;
  if (!landing) return next();
  c.header("set-cookie", landing.setCookie);
  return c.redirect(landing.location, 302);
});
app.use("/*", serveStatic({ root: dist }));
// Every other path is a page of the app (client-side routes such as /d/<id>).
app.get("*", serveStatic({ path: path.join(dist, "index.html") }));

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: cfg.port }, (info) => {
  const link = `http://127.0.0.1:${info.port}/${cfg.token ? `?t=${cfg.token}` : ""}`;
  console.log(`Qalam is running at ${link}`);
});
