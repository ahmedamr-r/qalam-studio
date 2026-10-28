import { Hono } from "hono";
import { chooseEngine, engineView, forgetKey, liveTest, saveKey } from "../engine";
import { fixHealth, healthNow } from "../health";
import { recentUsage } from "../usage";

/**
 * Connections' API: the engine Qalam AI runs on (which one, who pays, a test, a key kept in the
 * Keychain), what it used this week, and This Mac's health. Keys only ever come in; the last four
 * characters are all that goes out.
 */
export function connectionsRoutes(): Hono {
  const r = new Hono();
  r.get("/api/engine", async (c) => c.json(await engineView()));
  r.put("/api/engine", async (c) => {
    const { kind } = (await c.req.json().catch(() => ({}))) as { kind?: unknown };
    if (kind !== "cli" && kind !== "api") return c.json({ error: "bad_request", message: "Pick cli or api." }, 400);
    await chooseEngine(kind);
    return c.json(await engineView());
  });
  r.post("/api/engine/test", async (c) => {
    const { kind } = (await c.req.json().catch(() => ({}))) as { kind?: unknown };
    return c.json(await liveTest(kind === "cli" || kind === "api" ? kind : undefined));
  });
  r.put("/api/engine/key", async (c) => {
    const { key } = (await c.req.json().catch(() => ({}))) as { key?: unknown };
    if (typeof key !== "string" || key.trim().length < 20) return c.json({ error: "bad_request", message: "That doesn't look like a Claude API key." }, 400);
    const saved = await saveKey(key);
    return saved.ok ? c.json(await engineView()) : c.json({ error: "key_failed", message: saved.message, test: saved.test }, 400);
  });
  r.delete("/api/engine/key", async (c) => {
    await forgetKey();
    return c.json(await engineView());
  });
  r.get("/api/engine/usage", async (c) => c.json(await recentUsage(Date.now(), Math.min(31, Math.max(1, Number(c.req.query("days") ?? 7) || 7)))));
  r.get("/api/health", async (c) => c.json({ rows: await healthNow(c.req.query("org")) }));
  r.post("/api/health/fix", async (c) => {
    const { id, org } = (await c.req.json().catch(() => ({}))) as { id?: unknown; org?: unknown };
    if (typeof id === "string") await fixHealth(id);
    return c.json({ rows: await healthNow(typeof org === "string" ? org : null) });
  });
  return r;
}
