import { Hono } from "hono";
import { chooseBase, chooseEngine, chooseModels, chooseTiers, engineModels, engineView, forgetKey, forgetTavily, liveTest, saveKey, saveTavily } from "../engine";
import { adapterFor } from "@/ai/engines";
import { ENGINE_LABEL, isEngineKind, isKeyed, type EngineKind } from "@/ai/engine-kinds";
import { fixHealth, healthNow } from "../health";
import { recentUsage } from "../usage";
import { connectorDef } from "@/connectors/catalog";
import type { Hit } from "@/connectors/recipes";
import { connectorsView, forgetConnector, importItems, listClaudeCode, saveToken, searchConnector, viaClaudeCode } from "../connectors";
import { storeFor } from "../org/home";
import type { OstWork } from "@/discovery/types";
import { readInsight, searchInsights } from "../connectors/numbers";
import { cancelSignIn, keepApp, signIn } from "../connectors/oauth";
import { workStatuses } from "../connectors/work";
import { forgetGitHub, pollGitHubSignIn, startGitHubSignIn } from "../code/github";
import { chooseFolder } from "../org/home";
import { readSettings, writeSettings } from "../settings";
import { nameShape } from "@/org/you";

/**
 * Connections' API: the engine Qalam AI runs on (which one, who pays, a test, a key kept in the
 * Keychain, the models its calls run on), what it used this week, and This Mac's health. Keys only ever come in; the last four
 * characters are all that goes out.
 */
export function connectionsRoutes(): Hono {
  const r = new Hono();
  r.get("/api/engine", async (c) => c.json(await engineView()));
  r.put("/api/engine", async (c) => {
    const { kind } = (await c.req.json().catch(() => ({}))) as { kind?: unknown };
    if (!runs(kind)) return c.json({ error: "bad_request", message: "Qalam AI can't run on that here." }, 400);
    await chooseEngine(kind);
    return c.json(await engineView());
  });
  r.put("/api/engine/models", async (c) => {
    const { models } = (await c.req.json().catch(() => ({}))) as { models?: unknown };
    if (models !== "balanced" && models !== "best") return c.json({ error: "bad_request", message: "Pick balanced or best." }, 400);
    await chooseModels(models);
    return c.json(await engineView());
  });
  // The models an engine that isn't Claude offers (its own list), and the ones picked for each tier.
  r.get("/api/engine/:kind/models", async (c) => {
    const kind = c.req.param("kind");
    if (!runs(kind)) return c.json({ error: "bad_request", message: "Which engine?" }, 400);
    try {
      return c.json({ models: await engineModels(kind) });
    } catch (e) {
      return c.json({ error: "models", message: e instanceof Error ? e.message : String(e) }, 502);
    }
  });
  r.put("/api/engine/:kind/tiers", async (c) => {
    const kind = c.req.param("kind");
    const { tiers } = (await c.req.json().catch(() => ({}))) as { tiers?: unknown };
    if (!runs(kind) || !tiers || typeof tiers !== "object") return c.json({ error: "bad_request", message: "Pick a model." }, 400);
    await chooseTiers(kind, tiers as Record<string, string>);
    return c.json(await engineView());
  });
  r.put("/api/engine/:kind/base", async (c) => {
    const kind = c.req.param("kind");
    const { base } = (await c.req.json().catch(() => ({}))) as { base?: unknown };
    if (!runs(kind) || (base !== null && typeof base !== "string")) return c.json({ error: "bad_request", message: "Give an address on this computer." }, 400);
    const set = await chooseBase(kind, base);
    return set.ok ? c.json(await engineView()) : c.json({ error: "bad_request", message: set.message }, 400);
  });
  r.post("/api/engine/test", async (c) => {
    const { kind } = (await c.req.json().catch(() => ({}))) as { kind?: unknown };
    return c.json(await liveTest(runs(kind) ? kind : undefined));
  });
  r.put("/api/engine/key", async (c) => {
    const { key, kind = "api" } = (await c.req.json().catch(() => ({}))) as { key?: unknown; kind?: unknown };
    if (!isEngineKind(kind) || !isKeyed(kind)) return c.json({ error: "bad_request", message: "Which engine is the key for?" }, 400);
    if (typeof key !== "string" || key.trim().length < 20) return c.json({ error: "bad_request", message: `That doesn't look like ${keyName(kind)}.` }, 400);
    const saved = await saveKey(key, { kind });
    return saved.ok ? c.json(await engineView()) : c.json({ error: "key_failed", message: saved.message, test: saved.test }, 400);
  });
  r.delete("/api/engine/key", async (c) => {
    const kind = c.req.query("kind") ?? "api";
    if (!isEngineKind(kind) || !isKeyed(kind)) return c.json({ error: "bad_request", message: "Which engine's key?" }, 400);
    await forgetKey(kind);
    return c.json(await engineView());
  });
  // Tavily: web search for a model on this computer.
  r.put("/api/engine/tavily", async (c) => {
    const { key } = (await c.req.json().catch(() => ({}))) as { key?: unknown };
    if (typeof key !== "string" || key.trim().length < 20) return c.json({ error: "bad_request", message: "That doesn't look like a Tavily key." }, 400);
    const saved = await saveTavily(key);
    return saved.ok ? c.json(await engineView()) : c.json({ error: "key_failed", message: saved.message }, 400);
  });
  r.delete("/api/engine/tavily", async (c) => {
    await forgetTavily();
    return c.json(await engineView());
  });
  r.get("/api/engine/usage", async (c) => c.json(await recentUsage(Date.now(), Math.min(31, Math.max(1, Number(c.req.query("days") ?? 7) || 7)))));
  // Who's on this Mac: their name, from the first run.
  r.get("/api/you", async (c) => c.json({ name: (await readSettings()).you?.name ?? null }));
  r.put("/api/you", async (c) => {
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const n = nameShape(name);
    if (!n) return c.json({ error: "bad_request", message: "Write your name." }, 400);
    return c.json({ name: (await writeSettings({ you: { name: n } })).you?.name ?? null });
  });
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
  // Qalam's own sign-in to the service, in the system's browser: the page's address, then the connectors once it's done.
  r.post("/api/connectors/:id/signin", async (c) => {
    const id = c.req.param("id");
    const mcp = connectorDef(id)?.mcp;
    if (!mcp) return c.json({ error: "bad_request", message: "Qalam can't sign in to this one itself yet." }, 400);
    // Only a server the catalog names: the region picks one of them.
    const { region } = (await c.req.json().catch(() => ({}))) as { region?: unknown };
    const serverUrl = typeof region === "string" ? mcp.regions?.find((x) => x.id === region)?.url : mcp.url;
    if (!serverUrl) return c.json({ error: "bad_request", message: "Which region is the workspace in?" }, 400);
    return ndjson(async (_emit, send) => {
      await signIn(id, { serverUrl, onUrl: (url) => send({ type: "open", url }) });
      return connectorsView();
    });
  });
  r.delete("/api/connectors/:id/signin", (c) => c.json({ stopped: cancelSignIn(c.req.param("id")) }));
  // The ID and secret of an app the workspace made (a service that lets no app register itself), into the Keychain.
  r.put("/api/connectors/:id/app", async (c) => {
    const { clientId, clientSecret } = (await c.req.json().catch(() => ({}))) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof clientId !== "string" || (clientSecret !== undefined && typeof clientSecret !== "string")) return c.json({ error: "bad_request", message: "Paste the app's client ID." }, 400);
    try {
      await keepApp(c.req.param("id"), clientId.trim(), (clientSecret as string | undefined)?.trim() || undefined);
      return c.json(await connectorsView());
    } catch (e) {
      return c.json({ error: "app_failed", message: e instanceof Error ? e.message : String(e) }, 400);
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
  // An outcome's number from a saved PostHog insight (through Claude Code's PostHog server).
  r.post("/api/connectors/posthog/insights", async (c) => {
    const { query } = (await c.req.json().catch(() => ({}))) as { query?: unknown };
    try {
      return c.json({ hits: await searchInsights(typeof query === "string" ? query.trim().slice(0, 120) : "") });
    } catch (e) {
      return c.json({ error: "posthog", message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  r.post("/api/connectors/posthog/read", async (c) => {
    const { ref } = (await c.req.json().catch(() => ({}))) as { ref?: unknown };
    if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(ref)) return c.json({ error: "bad_request", message: "Which insight?" }, 400);
    try {
      return c.json(await readInsight(ref));
    } catch (e) {
      return c.json({ error: "posthog", message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  // Reading a product's code: Qalam's own GitHub sign-in (device flow, read-only), or a folder on this Mac.
  r.post("/api/code/github/signin", async (c) => {
    try {
      return c.json(await startGitHubSignIn());
    } catch (e) {
      return c.json({ error: "github", message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  r.post("/api/code/github/signin/:id", async (c) => c.json({ state: await pollGitHubSignIn(c.req.param("id")) }));
  r.delete("/api/code/github", async (c) => {
    await forgetGitHub();
    return c.json({ ok: true });
  });
  r.post("/api/code/folder", async (c) => {
    const picked = await chooseFolder("Choose the folder with the product's code");
    return picked === "unsupported" ? c.json({ error: "no_picker", message: "Type the folder's path instead." }, 400) : c.json({ path: picked });
  });
  // Where the work linked to solutions stands (Linear, GitHub), kept per computer.
  r.post("/api/org/:org/work/status", async (c) => {
    const store = await storeFor(c.req.param("org"));
    if (!store) return c.json({ error: "not_found", message: "No such organization." }, 404);
    const { links, force } = (await c.req.json().catch(() => ({}))) as { links?: unknown; force?: unknown };
    const list = (Array.isArray(links) ? links : []).filter((l): l is OstWork => !!l && typeof l.connector === "string" && typeof l.ref === "string" && typeof l.url === "string").slice(0, 60);
    return c.json({ statuses: await workStatuses(store, list, { force: force === true }) });
  });
  return r;
}

/** An engine this version can run Qalam AI on: Claude's own two, or one with an adapter. */
const runs = (kind: unknown): kind is EngineKind => isEngineKind(kind) && (kind === "cli" || kind === "api" || !!adapterFor(kind));

const keyName = (kind: EngineKind) => (kind === "api" ? "a Claude API key" : `${/^[AEIOU]/.test(ENGINE_LABEL[kind]) ? "an" : "a"} ${ENGINE_LABEL[kind]}`);

/** Work streamed as NDJSON (activity lines and any others it sends, then the result or the error); it runs to its end whoever listens. */
function ndjson(run: (emit: (label: string) => void, send: (line: Record<string, unknown>) => void) => Promise<unknown>): Response {
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
        send({ type: "result", data: await run((label) => send({ type: "activity", label }), send) });
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
