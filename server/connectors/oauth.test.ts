import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSecrets, secrets } from "../secrets";
import { readSettings } from "../settings";

vi.mock("../capture", () => ({ captureSource: async () => {} }));

const { cancelSignIn, signIn } = await import("./oauth");
const { connectorsView, forgetConnector, searchConnector } = await import("./index");

/*
 * A stand-in for Notion's hosted server: OAuth discovery, registration, the page a person approves
 * on, tokens (PKCE checked), revocation, and an MCP server with notion-search and notion-fetch that
 * takes only the access tokens it gave.
 */
function standIn() {
  const s = {
    base: "",
    n: 0,
    clients: new Map<string, string[]>(),
    codes: new Map<string, { challenge: string; redirect: string }>(),
    access: new Set<string>(),
    refresh: new Set<string>(),
    revoked: [] as string[],
    refuseRefresh: false,
    /** The token endpoint is down (a 503). */
    down: false,
    /** What the approval page sends back instead of a code. */
    deny: false,
    iss: "" as string | null,
  };
  const app = new Hono();
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json({ resource: `${s.base}/mcp`, authorization_servers: [s.base], scopes_supported: ["default"] }));
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({ issuer: s.base, authorization_endpoint: `${s.base}/authorize`, token_endpoint: `${s.base}/token`, registration_endpoint: `${s.base}/register`, revocation_endpoint: `${s.base}/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true }),
  );
  app.post("/register", async (c) => {
    const m = (await c.req.json()) as { redirect_uris: string[] };
    const id = `client-${++s.n}`;
    s.clients.set(id, m.redirect_uris);
    return c.json({ ...m, client_id: id, client_id_issued_at: 1 }, 201);
  });
  // The person approves; the page sends them back to Qalam with a code.
  app.get("/authorize", (c) => {
    const q = c.req.query();
    if (!s.clients.get(q.client_id)?.includes(q.redirect_uri) || q.code_challenge_method !== "S256" || !q.state) return c.text("bad request", 400);
    const back = new URL(q.redirect_uri);
    back.searchParams.set("state", q.state);
    if (s.iss !== null) back.searchParams.set("iss", s.iss || s.base);
    if (s.deny) back.searchParams.set("error", "access_denied");
    else {
      const code = `code-${++s.n}`;
      s.codes.set(code, { challenge: q.code_challenge, redirect: q.redirect_uri });
      back.searchParams.set("code", code);
    }
    return c.redirect(back.href, 302);
  });
  app.post("/token", async (c) => {
    const f = new URLSearchParams(await c.req.text());
    if (f.get("grant_type") === "authorization_code") {
      const want = s.codes.get(f.get("code") ?? "");
      s.codes.delete(f.get("code") ?? "");
      const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
      if (!want || want.challenge !== challenge || want.redirect !== f.get("redirect_uri")) return c.json({ error: "invalid_grant" }, 400);
    } else if (f.get("grant_type") === "refresh_token") {
      if (s.down) return c.text("down", 503);
      if (s.refuseRefresh || !s.refresh.delete(f.get("refresh_token") ?? "")) return c.json({ error: "invalid_grant" }, 400);
    } else return c.json({ error: "unsupported_grant_type" }, 400);
    const n = ++s.n;
    s.access.add(`at-${n}`);
    s.refresh.add(`rt-${n}`);
    return c.json({ access_token: `at-${n}`, token_type: "Bearer", expires_in: 3600, refresh_token: `rt-${n}`, scope: "default" });
  });
  app.post("/revoke", async (c) => {
    s.revoked.push(new URLSearchParams(await c.req.text()).get("token") ?? "");
    return c.body(null, 200);
  });
  app.all("/mcp", async (c) => {
    if (!s.access.has(c.req.header("authorization")?.replace(/^Bearer /, "") ?? "")) return c.body(null, 401, { "www-authenticate": `Bearer resource_metadata="${s.base}/.well-known/oauth-protected-resource/mcp", scope="default"` });
    if (c.req.method !== "POST") return c.body(null, 405);
    const server = new Server({ name: "notion-stand-in", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ["notion-search", "notion-fetch", "notion-get-self"].map((name) => ({ name, inputSchema: { type: "object" as const } })) }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => ({
      content: [{ type: "text", text: r.params.name === "notion-search" ? JSON.stringify({ results: [{ id: "p1", title: `Interview: ${String(r.params.arguments?.query)}`, url: "https://www.notion.so/p1" }] }) : JSON.stringify({ text: "Dana: we export to spreadsheets every Friday." }) }],
    }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return { s, app };
}

let dir: string;
let http: ServerType;
let s: ReturnType<typeof standIn>["s"];
let mcpUrl: string;
/** The browser's part: open the page, and follow it back to Qalam (the answer page comes once the code is exchanged). */
let landed: Promise<{ status: number; text: string }> | null;
const browser = async (url: string) => {
  const r = await fetch(url, { redirect: "manual" });
  const to = r.headers.get("location");
  landed = to ? fetch(to).then(async (b) => ({ status: b.status, text: await b.text() })) : null;
};
const card = async () => (await connectorsView()).connectors.find((c) => c.id === "notion")!;
const refused = (url: string) => fetch(url).then(
  () => false,
  () => true,
);

beforeAll(async () => {
  const made = standIn();
  s = made.s;
  http = await new Promise<ServerType>((resolve) => {
    // As Qalam's own servers run it (server/serve.ts): the global Response stays the platform's.
    const h = serve({ fetch: made.app.fetch, port: 0, hostname: "127.0.0.1", overrideGlobalObjects: false }, () => resolve(h));
  });
  s.base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  mcpUrl = `${s.base}/mcp`;
});
afterAll(() => void http.close());
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-oauth-"));
  process.env.QALAM_HOME = dir;
  process.env.QALAM_SECRETS = "memory";
  resetSecrets();
  Object.assign(s, { refuseRefresh: false, down: false, deny: false, iss: "" });
  landed = null;
});
afterEach(async () => {
  cancelSignIn("notion");
  await rm(dir, { recursive: true, force: true });
});

describe("Qalam's own sign-in to a connector's MCP server", () => {
  it("signs in through the browser, keeps the tokens only once a call with them works, and closes its port", async () => {
    let page = "";
    await signIn("notion", { serverUrl: mcpUrl, open: browser, onUrl: (u) => (page = u) });
    expect(page).toMatch(new RegExp(`^${s.base}/authorize\\?`));
    expect(new URL(page).searchParams.get("code_challenge_method")).toBe("S256");
    expect(await landed).toMatchObject({ status: 200, text: expect.stringContaining("Signed in to Notion") });
    expect((await readSettings()).connectors?.notion).toEqual({ via: "oauth", url: mcpUrl });
    expect(JSON.parse((await secrets().get("connector:notion:oauth"))!)).toMatchObject({ access_token: expect.stringMatching(/^at-/), refresh_token: expect.stringMatching(/^rt-/), issuer: s.base });
    expect(await card()).toMatchObject({ via: "oauth", word: "Connected", tone: "ok", canSignIn: true });
    // The listener took its one answer and is gone.
    expect(await refused(new URL(page).searchParams.get("redirect_uri")!)).toBe(true);
    // Calls go straight to the server with the kept token.
    expect(await searchConnector("notion", "Dana")).toEqual([{ id: "p1", title: "Interview: Dana", url: "https://www.notion.so/p1" }]);
  });

  it("turns away an answer without this sign-in's state, or for another address, and keeps waiting", async () => {
    const done = signIn("notion", {
      serverUrl: mcpUrl,
      open: async (url) => {
        const back = new URL(new URL(url).searchParams.get("redirect_uri")!);
        const bad = new URL(back);
        bad.searchParams.set("state", "not-this-one");
        bad.searchParams.set("code", "stolen");
        expect((await fetch(bad)).status).toBe(400);
        // A page on another name for this address (DNS rebinding) is turned away too.
        const status = await new Promise<number>((resolve) => request({ host: "127.0.0.1", port: back.port, path: `${back.pathname}?state=x&code=y`, headers: { host: "evil.example" } }, (r) => resolve(r.statusCode ?? 0)).end());
        expect(status).toBe(404);
        await browser(url);
      },
    });
    await done;
    expect((await landed)?.status).toBe(200);
  });

  it("ends with words when the person says no there, and keeps nothing", async () => {
    s.deny = true;
    await expect(signIn("notion", { serverUrl: mcpUrl, open: browser })).rejects.toThrow("It wasn't allowed in Notion.");
    expect((await landed)?.text).toContain("Notion isn't connected");
    expect(await secrets().get("connector:notion:oauth")).toBeNull();
    expect((await readSettings()).connectors?.notion).toBeUndefined();
  });

  it("refuses an answer that names another issuer, or none when the server says it names one", async () => {
    s.iss = "https://evil.example";
    await expect(signIn("notion", { serverUrl: mcpUrl, open: browser })).rejects.toThrow("didn't come from Notion");
    s.iss = null;
    await expect(signIn("notion", { serverUrl: mcpUrl, open: browser })).rejects.toThrow("didn't come from Notion");
    expect(await secrets().get("connector:notion:oauth")).toBeNull();
  });

  it("closes its port when the time runs out, or when it's stopped", async () => {
    let back = "";
    const keep = (url: string) => void (back = new URL(url).searchParams.get("redirect_uri")!);
    await expect(signIn("notion", { serverUrl: mcpUrl, open: keep, timeoutMs: 80 })).rejects.toThrow("wasn't finished in time");
    expect(await refused(back)).toBe(true);
    back = "";
    const stopped = signIn("notion", { serverUrl: mcpUrl, open: keep });
    await vi.waitFor(() => expect(back).not.toBe(""));
    expect(cancelSignIn("notion")).toBe(true);
    await expect(stopped).rejects.toThrow("stopped");
    expect(await refused(back)).toBe(true);
  });

  it("registers again only when the address it comes back to has changed", async () => {
    await signIn("notion", { serverUrl: mcpUrl, open: browser });
    const first = JSON.parse((await secrets().get("connector:notion:client"))!).client.client_id;
    await signIn("notion", { serverUrl: mcpUrl, open: browser });
    expect(JSON.parse((await secrets().get("connector:notion:client"))!).client.client_id).toBe(first);
  });

  it("refreshes a token the server stops taking, and keeps the new one", async () => {
    await signIn("notion", { serverUrl: mcpUrl, open: browser });
    const before = JSON.parse((await secrets().get("connector:notion:oauth"))!).access_token;
    s.access.clear();
    expect(await searchConnector("notion", "Dana")).toHaveLength(1);
    const after = JSON.parse((await secrets().get("connector:notion:oauth"))!).access_token;
    expect(after).not.toBe(before);
    expect(s.access.has(after)).toBe(true);
  });

  it("keeps the tokens when the service is down at refresh time, and the next call refreshes", async () => {
    await signIn("notion", { serverUrl: mcpUrl, open: browser });
    s.access.clear();
    s.down = true;
    await expect(searchConnector("notion", "Dana")).rejects.toThrow("Notion didn't answer. Try again in a moment.");
    expect(await card()).toMatchObject({ via: "oauth", word: "Connected" });
    s.down = false;
    expect(await searchConnector("notion", "Dana")).toHaveLength(1);
  });

  it("asks to sign in again when the service refuses the refresh, and the card says so", async () => {
    await signIn("notion", { serverUrl: mcpUrl, open: browser });
    s.access.clear();
    s.refuseRefresh = true;
    await expect(searchConnector("notion", "Dana")).rejects.toThrow("Sign in to Notion again in Connections.");
    expect(await secrets().get("connector:notion:oauth")).toBeNull();
    expect(await card()).toMatchObject({ via: "oauth", word: "Sign in again", tone: "warn" });
  });

  it("disconnecting asks the service to drop the tokens, and the Keychain forgets them", async () => {
    await signIn("notion", { serverUrl: mcpUrl, open: browser });
    const t = JSON.parse((await secrets().get("connector:notion:oauth"))!);
    await forgetConnector("notion");
    expect(s.revoked).toEqual(expect.arrayContaining([t.refresh_token, t.access_token]));
    expect(await secrets().get("connector:notion:oauth")).toBeNull();
    expect(await secrets().get("connector:notion:client")).toBeNull();
    expect(await card()).toMatchObject({ via: null, word: "Not connected" });
  });
});
