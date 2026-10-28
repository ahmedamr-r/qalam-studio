import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ingested } from "@/discovery/ingest/core";
import type { OrgStore } from "../org/store";
import { connectorDef } from "@/connectors/catalog";
import { resetSecrets, secrets } from "../secrets";
import { readSettings } from "../settings";

const captured: Ingested[] = [];
vi.mock("../capture", () => ({ captureSource: async (_s: unknown, ing: Ingested) => void captured.push(ing) }));

const { cancelSignIn, keepApp, signIn } = await import("./oauth");
const { connectorsView, forgetConnector, importItems, searchConnector } = await import("./index");
const { workStatuses } = await import("./work");

/*
 * A stand-in for a service's hosted server (Notion's, Intercom's): OAuth discovery, registration,
 * the page a person approves on, tokens (PKCE checked), revocation, and an MCP server with their
 * tools that takes only the access tokens it gave.
 */
const ALL_TOOLS = ["notion-search", "notion-fetch", "notion-get-self", "search", "fetch", "slack_search_public_and_private", "slack_read_thread", "get_issue"];
/** An answer the server gives as an error (an issue it doesn't know). */
const MISSING = Symbol("missing");
const SLACK_RESULTS = ["## Result 1 of 1", "Channel: #feedback (C01)", "From: Dana Lee", "Permalink: https://acme.slack.com/archives/C01/p1790771415332219", "Text: We export to sheets every Friday."].join("\n");
const conversation = {
  id: "42",
  source: { body: "<p>We export to sheets every Friday.</p>", author: { type: "user", name: "Dana Lee" } },
  conversation_parts: { conversation_parts: [{ part_type: "comment", body: "<p>Which sheet?</p>", author: { type: "admin", name: "Omar" } }] },
};
const ANSWERS: Record<string, (args: Record<string, unknown> | undefined) => unknown> = {
  "notion-search": (a) => ({ results: [{ id: "p1", title: `Interview: ${String(a?.query)}`, url: "https://www.notion.so/p1" }] }),
  "notion-fetch": () => ({ text: "Dana: we export to spreadsheets every Friday." }),
  search: (a) => ({ total_in_page: 1, results: [{ id: "conversation_42", title: "Exports", text: `<p>${String(a?.query)}</p>`, url: "https://app.intercom.com/a/inbox/x/inbox/conversation/42" }], pages: {} }),
  fetch: (a) => ({ id: a?.id, title: "Exports", text: JSON.stringify(conversation), url: "https://app.intercom.com/a/inbox/x/inbox/conversation/42" }),
  slack_search_public_and_private: () => ({ results: SLACK_RESULTS, next_cursor: "" }),
  slack_read_thread: (a) => ({ messages: a?.channel_id === "C01" && a.message_ts === "1790771415.332219" ? "Dana Lee: We export to sheets every Friday.\nOmar: Which sheet?" : "" }),
  // As Linear's answers for the fields Qalam asks: its id is the identifier.
  get_issue: (a) => (a?.id === "ENG-12" ? { title: "Fee breakdown", status: "In Progress", statusType: "started", id: "ENG-12" } : MISSING),
};
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
    /** The tools its MCP server lists. */
    tools: ALL_TOOLS,
    /** The scope the last registration and approval page asked for. */
    asked: { register: "" as string | undefined, authorize: "" as string | undefined },
    iss: "" as string | null,
    /** Slack's ways: no self-registration, apps made by the workspace (their secret, or none with PKCE), and a 200 with {ok: false} for no. */
    slack: false,
    apps: new Map<string, string | null>(),
    /** The app isn't allowed MCP yet. */
    mcpOff: false,
  };
  const app = new Hono();
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json({ resource: `${s.base}/mcp`, authorization_servers: [s.base], scopes_supported: ["default"] }));
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json(
      s.slack
        ? { issuer: s.base, authorization_endpoint: `${s.base}/authorize`, token_endpoint: `${s.base}/token`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_post"] }
        : { issuer: s.base, authorization_endpoint: `${s.base}/authorize`, token_endpoint: `${s.base}/token`, registration_endpoint: `${s.base}/register`, revocation_endpoint: `${s.base}/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true },
    ),
  );
  app.post("/register", async (c) => {
    const m = (await c.req.json()) as { redirect_uris: string[]; scope?: string };
    s.asked.register = m.scope;
    const id = `client-${++s.n}`;
    s.clients.set(id, m.redirect_uris);
    return c.json({ ...m, client_id: id, client_id_issued_at: 1 }, 201);
  });
  // The person approves; the page sends them back to Qalam with a code.
  app.get("/authorize", (c) => {
    const q = c.req.query();
    s.asked.authorize = q.scope;
    if (!s.clients.get(q.client_id)?.includes(q.redirect_uri) || q.code_challenge_method !== "S256" || !q.state) return c.text("bad request", 400);
    const back = new URL(q.redirect_uri);
    back.searchParams.set("state", q.state);
    if (s.iss !== null && !s.slack) back.searchParams.set("iss", s.iss || s.base);
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
    // Slack says no with a 200.
    const no = (error: string, slack: string) => (s.slack ? c.json({ ok: false, error: slack }) : c.json({ error }, 400));
    if (s.slack) {
      const id = f.get("client_id") ?? "";
      if (!s.apps.has(id) || (s.apps.get(id) ?? undefined) !== (f.get("client_secret") ?? undefined)) return no("invalid_client", "bad_client_secret");
    }
    if (f.get("grant_type") === "authorization_code") {
      const want = s.codes.get(f.get("code") ?? "");
      s.codes.delete(f.get("code") ?? "");
      const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
      if (!want || want.challenge !== challenge || want.redirect !== f.get("redirect_uri")) return no("invalid_grant", "invalid_code");
    } else if (f.get("grant_type") === "refresh_token") {
      if (s.down) return c.text("down", 503);
      if (s.refuseRefresh || !s.refresh.delete(f.get("refresh_token") ?? "")) return no("invalid_grant", "invalid_refresh_token");
    } else return c.json({ error: "unsupported_grant_type" }, 400);
    const n = ++s.n;
    s.access.add(`at-${n}`);
    s.refresh.add(`rt-${n}`);
    return c.json({ ...(s.slack ? { ok: true, token_type: "user" } : { token_type: "Bearer" }), access_token: `at-${n}`, expires_in: 3600, refresh_token: `rt-${n}`, scope: "default" });
  });
  app.post("/revoke", async (c) => {
    s.revoked.push(new URLSearchParams(await c.req.text()).get("token") ?? "");
    return c.body(null, 200);
  });
  app.all("/mcp", async (c) => {
    if (!s.access.has(c.req.header("authorization")?.replace(/^Bearer /, "") ?? "")) return c.body(null, 401, { "www-authenticate": `Bearer resource_metadata="${s.base}/.well-known/oauth-protected-resource/mcp", scope="default"` });
    if (c.req.method !== "POST") return c.body(null, 405);
    if (s.mcpOff) return c.json({ ok: false, error: "This app is not enabled for Slack MCP server access" }, 400);
    const server = new Server({ name: "notion-stand-in", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: s.tools.map((name) => ({ name, inputSchema: { type: "object" as const } })) }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      const a = ANSWERS[r.params.name]?.(r.params.arguments) ?? {};
      return a === MISSING ? { isError: true, content: [{ type: "text", text: "Entity not found: Issue" }] } : { content: [{ type: "text", text: JSON.stringify(a) }] };
    });
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
  Object.assign(s, { refuseRefresh: false, down: false, deny: false, iss: "", tools: ALL_TOOLS, slack: false, mcpOff: false });
  landed = null;
  captured.length = 0;
});
afterEach(async () => {
  cancelSignIn("notion");
  cancelSignIn("slack");
  cancelSignIn("linear");
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

  it("asks Intercom only for the scope Qalam needs, and reads a conversation as who said what", async () => {
    await signIn("intercom", { serverUrl: mcpUrl, open: browser });
    expect(s.asked).toEqual({ register: "mcp", authorize: "mcp" });
    expect((await readSettings()).connectors?.intercom).toEqual({ via: "oauth", url: mcpUrl });
    const hits = await searchConnector("intercom", 'sheets" OR object_type:contacts');
    expect(hits).toEqual([{ id: "conversation_42", title: "Exports", url: "https://app.intercom.com/a/inbox/x/inbox/conversation/42", snippet: 'object_type:conversations q:"sheets OR object_type:contacts" limit:20' }]);
    const store = { listSources: async () => [] } as unknown as OrgStore;
    expect(await importItems(store, "intercom", hits, () => {})).toEqual({ added: ["Exports"], skipped: [], failed: [] });
    expect(captured).toEqual([{ kind: "connector", title: "Exports", origin: "https://app.intercom.com/a/inbox/x/inbox/conversation/42", text: "Customer (Dana Lee): We export to sheets every Friday.\n\nTeam (Omar): Which sheet?" }]);
  });

  it("keeps nothing when the server lacks the tools Qalam reads with", async () => {
    s.tools = ["notion-search", "notion-fetch"];
    await expect(signIn("intercom", { serverUrl: mcpUrl, open: browser })).rejects.toThrow("Intercom's server doesn't offer search or fetch.");
    expect((await landed)?.text).toContain("Intercom isn't connected");
    expect(await secrets().get("connector:intercom:oauth")).toBeNull();
    expect((await readSettings()).connectors?.intercom).toBeUndefined();
  });

  describe("Linear, for where linked issues stand", () => {
    const issue = (ref: string) => ({ connector: "linear", ref, url: `https://linear.app/basket/issue/${ref}` });
    const store = () => ({ dir }) as unknown as OrgStore;

    it("asks for read access only, then reads each issue through get_issue", async () => {
      await signIn("linear", { serverUrl: mcpUrl, open: browser });
      expect(s.asked).toEqual({ register: "read", authorize: "read" });
      expect((await readSettings()).connectors?.linear).toEqual({ via: "oauth", url: mcpUrl });
      expect((await connectorsView()).connectors.find((c) => c.id === "linear")).toMatchObject({ via: "oauth", word: "Connected", tone: "ok", canSignIn: true, canToken: true });
      const got = await workStatuses(store(), [issue("ENG-12"), issue("ENG-404")], { now: 5 });
      expect(got).toEqual({ "linear:ENG-12": { state: "doing", label: "In Progress", title: "Fee breakdown", at: 5 }, "linear:ENG-404": { state: "unknown", label: "Can't see it", at: 5 } });
    });

    it("keeps the last answer when Linear stops taking the sign-in, and says to sign in again where there's none", async () => {
      await signIn("linear", { serverUrl: mcpUrl, open: browser });
      await workStatuses(store(), [issue("ENG-12")], { now: 5 });
      s.access.clear();
      s.refuseRefresh = true;
      const got = await workStatuses(store(), [issue("ENG-12"), issue("ENG-13")], { now: 6, force: true });
      expect(got["linear:ENG-12"]).toMatchObject({ state: "doing", at: 5 });
      expect(got["linear:ENG-13"]).toEqual({ state: "unknown", label: "Sign in to Linear again in Connections", at: 6 });
    });

    it("keeps nothing when Linear's server lacks get_issue", async () => {
      s.tools = ALL_TOOLS.filter((t) => t !== "get_issue");
      await expect(signIn("linear", { serverUrl: mcpUrl, open: browser })).rejects.toThrow("Linear's server doesn't offer get_issue.");
      expect(await secrets().get("connector:linear:oauth")).toBeNull();
      expect((await readSettings()).connectors?.linear).toBeUndefined();
    });
  });

  describe("Slack, with the workspace's own app", () => {
    /** An address the app lists: a free port on localhost. */
    const freeCallback = async () => {
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      return `http://localhost:${port}/callback`;
    };
    const slackCard = async () => (await connectorsView()).connectors.find((c) => c.id === "slack")!;
    let callback: string;
    beforeEach(async () => {
      s.slack = true;
      callback = await freeCallback();
      s.apps.set("1234.5678", "secret-0000-1111");
      s.apps.set("2468.1357", null);
      for (const id of s.apps.keys()) s.clients.set(id, [callback]);
    });

    it("needs the app first, then signs in on the one address it lists, asking only to read", async () => {
      await expect(signIn("slack", { serverUrl: mcpUrl, callback, open: browser })).rejects.toThrow("Set up Slack's app first.");
      expect(await slackCard()).toMatchObject({ canSignIn: true, ownApp: { kept: false, callback: "http://localhost:38712/callback" } });
      await keepApp("slack", "1234.5678", "secret-0000-1111");
      expect((await slackCard()).ownApp?.kept).toBe(true);
      let page = "";
      await signIn("slack", { serverUrl: mcpUrl, callback, open: browser, onUrl: (u) => (page = u) });
      expect(new URL(page).searchParams.get("redirect_uri")).toBe(callback);
      expect(s.asked.authorize).toBe(connectorDef("slack")!.mcp!.scope);
      expect(await landed).toMatchObject({ status: 200, text: expect.stringContaining("Signed in to Slack") });
      expect(await slackCard()).toMatchObject({ via: "oauth", word: "Connected" });
      const hits = await searchConnector("slack", "export");
      expect(hits).toEqual([{ id: "C01/1790771415.332219", title: "We export to sheets every Friday.", url: "https://acme.slack.com/archives/C01/p1790771415332219", snippet: "#feedback (C01) · Dana Lee" }]);
      const store = { listSources: async () => [] } as unknown as OrgStore;
      expect(await importItems(store, "slack", hits, () => {})).toEqual({ added: ["We export to sheets every Friday."], skipped: [], failed: [] });
      expect(captured[0]).toMatchObject({ kind: "connector", origin: "https://acme.slack.com/archives/C01/p1790771415332219", text: "Dana Lee: We export to sheets every Friday.\nOmar: Which sheet?" });
    });

    it("takes an app with PKCE and no secret", async () => {
      await keepApp("slack", "2468.1357");
      await signIn("slack", { serverUrl: mcpUrl, callback, open: browser });
      expect((await slackCard()).word).toBe("Connected");
    });

    it("says in words when Slack refuses the app's secret, and keeps the app to fix", async () => {
      await keepApp("slack", "1234.5678", "secret-wrong-2222");
      await expect(signIn("slack", { serverUrl: mcpUrl, callback, open: browser })).rejects.toThrow("Slack didn't finish the sign-in: it didn't take the app's client secret");
      expect(await secrets().get("connector:slack:oauth")).toBeNull();
      expect((await slackCard()).ownApp?.kept).toBe(true);
    });

    it("says to turn MCP on when the app isn't allowed it yet", async () => {
      s.mcpOff = true;
      await keepApp("slack", "1234.5678", "secret-0000-1111");
      await expect(signIn("slack", { serverUrl: mcpUrl, callback, open: browser })).rejects.toThrow("Turn on Agents & AI Apps → Model Context Protocol in the app's settings, then sign in again.");
    });

    it("drops a refused refresh's tokens but never the app", async () => {
      await keepApp("slack", "1234.5678", "secret-0000-1111");
      await signIn("slack", { serverUrl: mcpUrl, callback, open: browser });
      s.access.clear();
      s.refuseRefresh = true;
      await expect(searchConnector("slack", "export")).rejects.toThrow("Sign in to Slack again in Connections.");
      expect(await secrets().get("connector:slack:oauth")).toBeNull();
      expect(await slackCard()).toMatchObject({ via: "oauth", word: "Sign in again", ownApp: { kept: true } });
      expect(JSON.parse((await secrets().get("connector:slack:client"))!).client).toMatchObject({ client_id: "1234.5678", client_secret: "secret-0000-1111" });
    });

    it("can only come back to the address the app lists, so a busy port says so", async () => {
      await keepApp("slack", "1234.5678", "secret-0000-1111");
      const port = Number(new URL(callback).port);
      const squatter = createServer();
      await new Promise<void>((resolve) => squatter.listen(port, "127.0.0.1", () => resolve()));
      try {
        await expect(signIn("slack", { serverUrl: mcpUrl, callback, open: browser })).rejects.toThrow(`Slack can only come back to localhost:${port}, and something on this Mac is using that port.`);
      } finally {
        squatter.close();
      }
    });
  });
});
