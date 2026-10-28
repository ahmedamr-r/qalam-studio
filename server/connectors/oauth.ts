import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { auth, UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { connectorDef } from "@/connectors/catalog";
import { RECIPES } from "@/connectors/recipes";
import { NoSecretStore, secrets } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { withMcp, type McpCall } from "./mcp";

/*
 * Qalam's own sign-in to a connector's MCP server, for one not signed in to in Claude Code: OAuth
 * 2.1 with PKCE, Qalam registering itself with the service. The service's page opens in the
 * system's browser and sends its answer to a listener on 127.0.0.1 that's open only for this
 * sign-in: one answer carrying this sign-in's state, or five minutes, then it closes. The answer
 * is checked (state, issuer), the code exchanged, and one call made with the new token; only then
 * are the registration and the tokens kept, in the Keychain (`connector:<id>:client`,
 * `connector:<id>:oauth`). Calls use them straight (no model, no Claude Code), refreshing when the
 * server asks; when the service refuses the refresh, it's "Sign in again".
 */

const SIGN_IN_MS = 5 * 60_000;
const clientItem = (id: string) => `connector:${id}:client`;
const tokensItem = (id: string) => `connector:${id}:oauth`;

/** What Qalam keeps of a sign-in: its registration with the service, where the service signs in, the tokens. */
interface Kept {
  client?: OAuthClientInformationMixed;
  discovery?: OAuthDiscoveryState;
  tokens?: OAuthTokens;
}

export class SignInAgain extends Error {
  constructor(label: string) {
    super(`Sign in to ${label} again in Connections.`);
  }
}

const parse = <T>(text: string | null): T | undefined => {
  try {
    return text ? (JSON.parse(text) as T) : undefined;
  } catch {
    return undefined;
  }
};

async function load(id: string): Promise<Kept> {
  const [client, tokens] = await Promise.all([secrets().get(clientItem(id)), secrets().get(tokensItem(id))]);
  const c = parse<Pick<Kept, "client" | "discovery">>(client);
  return { client: c?.client, discovery: c?.discovery, tokens: parse<OAuthTokens>(tokens) };
}

async function keep(id: string, k: Kept) {
  if (k.client) await secrets().set(clientItem(id), JSON.stringify({ client: k.client, discovery: k.discovery }));
  else await secrets().remove(clientItem(id));
  if (k.tokens) await secrets().set(tokensItem(id), JSON.stringify(k.tokens));
  else await secrets().remove(tokensItem(id));
}

/** Whether a sign-in's tokens are kept here (its card says Connected). */
export const signedIn = async (id: string) => !!(await secrets().get(tokensItem(id)).catch(() => null));

const redirectsOf = (c: OAuthClientInformationMixed | undefined): string[] => (c as { redirect_uris?: string[] } | undefined)?.redirect_uris ?? [];

/**
 * The SDK's view of what's kept. `register` lets it register Qalam again (a sign-in only: a call
 * never does it behind the user's back); `onRedirect` is where it sends the user to sign in.
 */
function provider(k: Kept, o: { redirectUrl: string; state?: string; register: boolean; onRedirect: (url: URL) => void | Promise<void>; onChange?: () => Promise<void> }): OAuthClientProvider {
  let verifier = "";
  const metadata: OAuthClientMetadata = { client_name: "Qalam Studio", redirect_uris: [o.redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  return {
    redirectUrl: o.redirectUrl,
    clientMetadata: metadata,
    state: () => o.state ?? randomBytes(16).toString("base64url"),
    clientInformation: () => k.client,
    ...(o.register ? { saveClientInformation: (c: OAuthClientInformationMixed) => void (k.client = c) } : {}),
    tokens: () => k.tokens,
    saveTokens: async (t) => {
      k.tokens = t;
      await o.onChange?.();
    },
    redirectToAuthorization: (url) => o.onRedirect(url),
    saveCodeVerifier: (v) => void (verifier = v),
    codeVerifier: () => verifier,
    saveDiscoveryState: (d) => void (k.discovery = d),
    discoveryState: () => k.discovery,
    invalidateCredentials: async (scope) => {
      if (scope === "all" || scope === "client") k.client = undefined;
      if (scope === "all" || scope === "tokens") k.tokens = undefined;
      if (scope === "all" || scope === "discovery") k.discovery = undefined;
      if (scope === "verifier") verifier = "";
      await o.onChange?.();
    },
  };
}

// ---------------------------------------------------------------------------
// Signing in

export interface SignInOptions {
  /** The service's MCP server (the catalog's unless a test points elsewhere). */
  serverUrl?: string;
  /** Shows the service's sign-in page (the system's browser by default). */
  open?: (url: string) => void | Promise<void>;
  /** Hears the sign-in page's address, for a link in case the browser didn't open. */
  onUrl?: (url: string) => void;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

// One sign-in per connector at a time, whichever copy of this module asks (the dev server reloads routes).
const g = globalThis as { __qalamSignIns?: Map<string, () => void>; __qalamOAuthTurns?: Map<string, Promise<unknown>> };
const pending = () => (g.__qalamSignIns ??= new Map());

/** Stop a sign-in under way (its listener closes); false when there's none. */
export function cancelSignIn(id: string): boolean {
  const stop = pending().get(id);
  stop?.();
  return !!stop;
}

/** Sign in to a connector in the browser and keep what it gives. Throws why not, in words. */
export async function signIn(id: string, o: SignInOptions = {}): Promise<void> {
  const def = connectorDef(id);
  const serverUrl = o.serverUrl ?? def?.mcp?.url;
  if (!def || !serverUrl) throw new Error("Qalam can't sign in to this one itself yet.");
  if (!secrets().available) throw new NoSecretStore();
  cancelSignIn(id);
  const before = await load(id);
  const back = await listen(Number(redirectsOf(before.client)[0]?.match(/^http:\/\/127\.0\.0\.1:(\d+)\//)?.[1]) || 0, o.timeoutMs ?? SIGN_IN_MS);
  const stop = () => back.stop(new Error("The sign-in was stopped."));
  pending().set(id, stop);
  try {
    // A registration made for another address (another port) can't come back here: register again.
    const k: Kept = { client: redirectsOf(before.client).includes(back.url) ? before.client : undefined, discovery: before.discovery };
    const state = randomBytes(32).toString("base64url");
    let page: URL | undefined;
    const p = provider(k, { redirectUrl: back.url, state, register: true, onRedirect: (url) => void (page = url) });
    if ((await auth(p, { serverUrl, fetchFn: o.fetchFn }).catch((e: unknown) => Promise.reject(new Error(`${def.label} didn't let Qalam start a sign-in: ${message(e)}`)))) !== "REDIRECT" || !page) throw new Error(`${def.label} didn't offer a sign-in page.`);
    const where = webAddress(page);
    const answered = back.answer(state);
    answered.catch(() => {});
    o.onUrl?.(where);
    await (o.open ?? openInBrowser)(where);
    const a = await answered;
    try {
      if (a.error) throw new Error(a.error === "access_denied" ? `It wasn't allowed in ${def.label}.` : `${def.label} said: ${a.errorDescription ?? a.error}`);
      // The answer must come from the server this sign-in started with (RFC 9207), not another one's page.
      const meta = k.discovery?.authorizationServerMetadata as { issuer?: string; authorization_response_iss_parameter_supported?: boolean } | undefined;
      if ((a.iss !== undefined || meta?.authorization_response_iss_parameter_supported === true) && a.iss !== meta?.issuer) throw new Error(`That answer didn't come from ${def.label}.`);
      if (!a.code) throw new Error(`${def.label} sent no code back.`);
      await auth(p, { serverUrl, authorizationCode: a.code, fetchFn: o.fetchFn }).catch((e: unknown) => Promise.reject(new Error(`${def.label} didn't finish the sign-in: ${message(e)}`)));
      // One call with the new token before it's kept: it works, and the tools Qalam reads with are there.
      const tools = await withMcp(serverUrl, provider(k, { redirectUrl: back.url, register: false, onRedirect: () => Promise.reject(new SignInAgain(def.label)) }), (_call, list) => list(), o.fetchFn);
      const recipe = RECIPES[id];
      const missing = recipe ? [recipe.search("").tool, recipe.fetch({ id: "", title: "" }).tool].filter((t) => !tools.includes(t)) : [];
      if (missing.length) throw new Error(`${def.label}'s server doesn't offer ${missing.join(" or ")}.`);
      back.check();
      await keep(id, k);
      const all = (await readSettings()).connectors ?? {};
      await writeSettings({ connectors: { ...all, [id]: { via: "oauth", url: serverUrl } } });
      a.reply(true, `Signed in to ${def.label}`, "You can close this tab and go back to Qalam Studio.");
    } catch (e) {
      a.reply(false, `${def.label} isn't connected`, message(e));
      throw e;
    }
  } finally {
    back.stop();
    if (pending().get(id) === stop) pending().delete(id);
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A page to open in a browser: a web address only (`open` would start whatever a file or app address names). */
function webAddress(u: URL): string {
  if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))) return u.href;
  throw new Error("The sign-in page isn't a web address.");
}

function openInBrowser(url: string): Promise<void> {
  const cmd = process.platform === "darwin" ? "/usr/bin/open" : process.platform === "linux" ? "xdg-open" : null;
  // Elsewhere the window's link opens it.
  return new Promise((resolve) => (cmd ? execFile(cmd, [url], { timeout: 10_000 }, () => resolve()) : resolve()));
}

interface Answer {
  code?: string;
  iss?: string;
  error?: string;
  errorDescription?: string;
  /** The page the browser shows (the browser waits for it while the code is exchanged). */
  reply: (ok: boolean, title: string, line: string) => void;
}

/**
 * The listener the service's page comes back to, on 127.0.0.1 only: on `port` when it's free (the
 * address Qalam registered with), else any. It takes one answer with the expected state, and
 * turns everything else away; it closes on that answer, on `stop` or after `ms`.
 */
async function listen(port: number, ms: number) {
  let expected = "";
  let settle: { resolve: (a: Answer) => void; reject: (e: Error) => void } | null = null;
  let taken = false;
  let held: ServerResponse | null = null;
  let ended: Error | null = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (taken || req.method !== "GET" || url.pathname !== "/callback" || req.headers.host !== `127.0.0.1:${bound}`) return send(res, 404, "Not here", "Qalam isn't waiting for anything at this address.");
    const state = url.searchParams.get("state") ?? "";
    if (!expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return send(res, 400, "Not this sign-in", "This answer doesn't belong to the sign-in Qalam started.");
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    if (!q("code") && !q("error")) return send(res, 400, "Nothing came back", "The answer carried no code.");
    taken = true;
    held = res;
    server.close();
    settle?.resolve({ code: q("code"), iss: q("iss"), error: q("error"), errorDescription: q("error_description"), reply: (ok, title, line) => reply(ok ? 200 : 400, title, line) });
  });
  const reply = (status: number, title: string, line: string) => {
    if (held && !held.headersSent) send(held, status, title, line);
    held = null;
  };
  const bound = await new Promise<number>((resolve, reject) => {
    const at = (p: number) => server.listen(p, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    server.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EADDRINUSE" || !port) return reject(e);
      server.once("error", reject);
      at(0);
    });
    at(port);
  });
  const timer = setTimeout(() => stop(new Error("The sign-in wasn't finished in time. Try again.")), ms);
  const stop = (why?: Error) => {
    clearTimeout(timer);
    if (!taken && why) settle?.reject(why);
    ended ??= why ?? new Error("The sign-in is over.");
    taken = true;
    reply(400, "Sign-in stopped", "Start it again from Qalam Studio.");
    server.close();
    server.closeAllConnections();
  };
  return {
    url: `http://127.0.0.1:${bound}/callback`,
    answer: (state: string) =>
      new Promise<Answer>((resolve, reject) => {
        if (ended) return reject(ended);
        expected = state;
        settle = { resolve, reject };
      }),
    /** Throws when it was stopped meanwhile (nothing is kept then). */
    check: () => {
      if (ended) throw ended;
    },
    stop,
  };
}

/** A small page with no script, saying how it went. */
function send(res: ServerResponse, status: number, title: string, line: string) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", connection: "close" });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:80vh;margin:0}main{max-width:380px;padding:0 16px;text-align:center}h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;opacity:.7}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(line)}</p></main></body></html>`,
  );
}

// ---------------------------------------------------------------------------
// Calls with what's kept

/** Calls to a connector signed in here, one session at a time per connector (a token refreshed twice at once would be refused). */
export function withSignedIn<T>(id: string, serverUrl: string, fn: (call: McpCall) => Promise<T>, fetchFn?: FetchLike): Promise<T> {
  const turns = (g.__qalamOAuthTurns ??= new Map());
  const run = async () => {
    const label = connectorDef(id)?.label ?? id;
    const k = await load(id);
    if (!k.tokens) throw new SignInAgain(label);
    // The SDK starts a new sign-in when it can't use or refresh the tokens. With a refresh token still
    // kept the service didn't answer (they stay for the next call); without one they're no good any more.
    const onRedirect = async () => {
      if (k.tokens?.refresh_token) throw new Error(`${label} didn't answer. Try again in a moment.`);
      await keep(id, { ...k, tokens: undefined });
      throw new SignInAgain(label);
    };
    const p = provider(k, { redirectUrl: redirectsOf(k.client)[0] ?? "http://127.0.0.1/callback", register: false, onRedirect, onChange: () => keep(id, k) });
    try {
      return await withMcp(serverUrl, p, (call) => fn(call), fetchFn);
    } catch (e) {
      throw e instanceof UnauthorizedError ? new SignInAgain(label) : e;
    }
  };
  const next = (turns.get(id) ?? Promise.resolve()).then(run, run);
  turns.set(id, next.catch(() => {}));
  return next;
}

/** Forget a sign-in: the service is asked to drop its tokens (RFC 7009, when it says where), then the Keychain lets them go. */
export async function forgetSignIn(id: string, fetchFn: FetchLike = fetch): Promise<void> {
  cancelSignIn(id);
  const k = await load(id).catch((): Kept => ({}));
  const at = (k.discovery?.authorizationServerMetadata as { revocation_endpoint?: string } | undefined)?.revocation_endpoint;
  const client = k.client as { client_id?: string; client_secret?: string } | undefined;
  if (at && client?.client_id && k.tokens) {
    for (const [token, hint] of [
      [k.tokens.refresh_token, "refresh_token"],
      [k.tokens.access_token, "access_token"],
    ] as const) {
      if (!token) continue;
      const body = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) });
      await Promise.resolve()
        .then(() => fetchFn(webAddress(new URL(at)), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(5000) }))
        .catch(() => {});
    }
  }
  await keep(id, {});
}
