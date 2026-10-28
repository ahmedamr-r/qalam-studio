import { Hono } from "hono";
import { chooseEngine, engineView, forgetKey, liveTest, saveKey } from "../engine";
import { fixHealth, healthNow } from "../health";
import { recentUsage } from "../usage";
import { connectorDef } from "@/connectors/catalog";
import type { Hit } from "@/connectors/recipes";
import { connectorsView, forgetConnector, importItems, listClaudeCode, saveToken, searchConnector, viaClaudeCode } from "../connectors";
import { storeFor } from "../org/home";

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
  // Connectors: what Claude Code has, connecting one, and bringing an organization's material in.
  r.get("/api/connectors", async (c) => c.json(await connectorsView()));
  r.post("/api/connectors/check", async (c) => {
    if (!(await listClaudeCode(true))) return c.json({ error: "claude_code", message: "Claude Code didn't answer. Is it installed here?" }, 502);
    return c.json(await connectorsView());
  });
  r.put("/api/connectors/:id", async (c) => {
    const { via, server } = (await c.req.json().catch(() => ({}))) as { via?: unknown; server?: unknown };
    if (!connectorDef(c.req.param("id")) || via !== "claude-code" || typeof server !== "string" || !server.trim()) return c.json({ error: "bad_request", message: "Which of Claude Code's servers?" }, 400);
    await viaClaudeCode(c.req.param("id"), server);
    return c.json(await connectorsView());
  });
  r.put("/api/connectors/:id/token", async (c) => {
    const { token } = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    if (typeof token !== "string" || token.trim().length < 10) return c.json({ error: "bad_request", message: "Paste the whole secret." }, 400);
    try {
      const who = await saveToken(c.req.param("id"), token);
      return c.json({ ...(await connectorsView()), who });
    } catch (e) {
      return c.json({ error: "token_failed", message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  r.delete("/api/connectors/:id", async (c) => {
    await forgetConnector(c.req.param("id"));
    return c.json(await connectorsView());
  });
  r.post("/api/org/:org/connectors/:id/search", async (c) => {
    if (!(await storeFor(c.req.param("org")))) return c.json({ error: "not_found", message: "No such organization." }, 404);
    const { query } = (await c.req.json().catch(() => ({}))) as { query?: unknown };
    if (typeof query !== "string" || !query.trim()) return c.json({ error: "bad_request", message: "Search for something." }, 400);
    try {
      return c.json({ hits: await searchConnector(c.req.param("id"), query.trim().slice(0, 200)) });
    } catch (e) {
      return c.json({ error: "search_failed", message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  r.post("/api/org/:org/connectors/:id/import", async (c) => {
    const store = await storeFor(c.req.param("org"));
    if (!store) return c.json({ error: "not_found", message: "No such organization." }, 404);
    const { hits } = (await c.req.json().catch(() => ({}))) as { hits?: unknown };
    const picked = (Array.isArray(hits) ? hits : []).filter((h): h is Hit => !!h && typeof h.id === "string" && typeof h.title === "string").slice(0, 20);
    if (!picked.length) return c.json({ error: "bad_request", message: "Pick something to bring in." }, 400);
    // Taken in to the end even if the window goes: each item is kept, read, filed and placed.
    return ndjson((emit) => importItems(store, c.req.param("id"), picked, emit));
  });
  return r;
}

/** Work streamed as NDJSON (activity lines, then the result or the error); it runs to its end whoever listens. */
function ndjson(run: (emit: (label: string) => void) => Promise<unknown>): Response {
  const enc = new TextEncoder();
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: unknown) => {
        if (!open) return;
        try {
          ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        send({ type: "result", data: await run((label) => send({ type: "activity", label })) });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (open) ctrl.close();
        open = false;
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
