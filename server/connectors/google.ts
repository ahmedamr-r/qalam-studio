import { createHash, randomBytes } from "node:crypto";
import { driveFileHits, driveFolder, driveType, driveWords } from "@/connectors/drive";
import type { Hit } from "@/connectors/recipes";
import { IngestError, MAX_FILE, type Ingested } from "@/discovery/ingest/core";
import { ingestBytes } from "../ingest";
import { NoSecretStore, secrets } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { listen, openInBrowser } from "./loopback";
import { SignInAgain } from "./oauth";

/*
 * Qalam's own sign-in to Google, for Drive, when this build has a Google OAuth client
 * (QALAM_GOOGLE_CLIENT_ID and QALAM_GOOGLE_CLIENT_SECRET: a Desktop-type client, whose secret Google
 * says isn't confidential in an installed app). OAuth for installed apps: PKCE, Google's page in the
 * system's browser coming back to a listener on 127.0.0.1 (./loopback.ts), drive.readonly only. The
 * answer is checked (state, issuer), the code exchanged, and one files.list call made before the
 * tokens are kept, in the Keychain (`connector:drive:oauth`). Calls go straight to Drive's API (no
 * model, no Claude Code); a token about to expire is refreshed, and a refused refresh drops the
 * tokens ("Sign in again"); Google not answering keeps them. Disconnect revokes them at Google.
 * Written from Google's docs (October 2026), not yet checked against a real client.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const ISSUER = "https://accounts.google.com";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const ITEM = "connector:drive:oauth";
const SIGN_IN_MS = 5 * 60_000;
const LABEL = "Google Drive";

type FetchFn = typeof fetch;

/** This build's Google client, or null when it has none (the sign-in isn't offered then). */
export function googleClient(): { id: string; secret?: string } | null {
  const id = process.env.QALAM_GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.QALAM_GOOGLE_CLIENT_SECRET?.trim();
  return id ? { id, ...(secret ? { secret } : {}) } : null;
}

interface Tokens {
  access: string;
  refresh?: string;
  /** When the access token stops working (ms). */
  expires: number;
}

async function load(): Promise<Tokens | null> {
  try {
    const t = JSON.parse((await secrets().get(ITEM)) ?? "null") as Tokens | null;
    return t && typeof t.access === "string" ? t : null;
  } catch {
    return null;
  }
}
const keep = (t: Tokens | null) => (t ? secrets().set(ITEM, JSON.stringify(t)) : secrets().remove(ITEM));

export const googleSignedIn = async () => !!(await load());

/** Google turned the code or the refresh token down (as opposed to not answering). */
class Refused extends Error {}

/** A call to Google's token endpoint: new tokens, or why not. */
async function tokenCall(params: Record<string, string>, client: { id: string; secret?: string }, f: FetchFn, before?: Tokens): Promise<Tokens> {
  const body = new URLSearchParams({ ...params, client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}) });
  let res: Response;
  try {
    res = await f(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("Google didn't answer. Try again in a moment.");
  }
  const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown };
  if (res.status >= 500) throw new Error("Google didn't answer. Try again in a moment.");
  if (!res.ok || typeof j.access_token !== "string") throw new Refused(typeof j.error_description === "string" ? j.error_description : typeof j.error === "string" ? j.error : `Google answered ${res.status}.`);
  // A refresh answers no new refresh token: the one kept goes on.
  const refresh = typeof j.refresh_token === "string" ? j.refresh_token : before?.refresh;
  return { access: j.access_token, ...(refresh ? { refresh } : {}), expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
}

/** Drive said the token is no good. */
class Unauthorized extends Error {}

async function driveCall(token: string, path: string, f: FetchFn): Promise<Response> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error("Google Drive didn't answer. Try again in a moment.");
  }
  if (res.status === 401) throw new Unauthorized();
  if (res.status === 403) throw new Error("Google Drive didn't let Qalam read that.");
  if (res.status === 404) throw new IngestError("Google Drive has no such file any more.");
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  return res;
}

// One refresh at a time, whichever call needs it (a refresh token used twice at once may be refused).
const g = globalThis as { __qalamGoogleRefresh?: Promise<Tokens> | null; __qalamGoogleSignIn?: (() => void) | null };

async function refreshed(t: Tokens, f: FetchFn): Promise<Tokens> {
  const client = googleClient();
  if (!client) throw new Error("This copy of Qalam has no Google sign-in.");
  if (!t.refresh) {
    await keep(null);
    throw new SignInAgain(LABEL);
  }
  g.__qalamGoogleRefresh ??= tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh }, client, f, t)
    .then(
      async (next) => {
        await keep(next);
        return next;
      },
      async (e: unknown) => {
        if (!(e instanceof Refused)) throw e;
        // Google won't refresh it any more (revoked, or unused for months): signed out.
        await keep(null);
        throw new SignInAgain(LABEL);
      },
    )
    .finally(() => {
      g.__qalamGoogleRefresh = null;
    });
  return g.__qalamGoogleRefresh;
}

/** Calls with the kept tokens: refreshed first when they're about to expire, and once more when Drive turns them down. */
async function withToken<T>(fn: (token: string) => Promise<T>, f: FetchFn): Promise<T> {
  let t = await load();
  if (!t) throw new SignInAgain(LABEL);
  if (t.expires - Date.now() < 60_000) t = await refreshed(t, f);
  try {
    return await fn(t.access);
  } catch (e) {
    if (!(e instanceof Unauthorized)) throw e;
    t = await refreshed(t, f);
    return fn(t.access).catch((e2: unknown) => Promise.reject(e2 instanceof Unauthorized ? new SignInAgain(LABEL) : e2));
  }
}

// ---------------------------------------------------------------------------
// Signing in

export function cancelGoogleSignIn(): boolean {
  const stop = g.__qalamGoogleSignIn;
  stop?.();
  return !!stop;
}

/** Sign in to Google in the browser and keep what it gives. Throws why not, in words. */
export async function signInGoogle(o: { open?: (url: string) => void | Promise<void>; onUrl?: (url: string) => void; fetchFn?: FetchFn; timeoutMs?: number } = {}): Promise<void> {
  const client = googleClient();
  if (!client) throw new Error("This copy of Qalam has no Google sign-in. Use Google Drive through Claude Code instead.");
  if (!secrets().available) throw new NoSecretStore();
  const f = o.fetchFn ?? fetch;
  cancelGoogleSignIn();
  const back = await listen({ port: 0, host: "127.0.0.1", fixed: false }, o.timeoutMs ?? SIGN_IN_MS);
  const stop = () => back.stop(new Error("The sign-in was stopped."));
  g.__qalamGoogleSignIn = stop;
  try {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const page = new URL(AUTH);
    page.search = new URLSearchParams({
      client_id: client.id,
      redirect_uri: back.url,
      response_type: "code",
      scope: DRIVE_SCOPE,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
      // A refresh token, given again on every sign-in.
      access_type: "offline",
      prompt: "consent",
    }).toString();
    const answered = back.answer(state);
    answered.catch(() => {});
    o.onUrl?.(page.href);
    await (o.open ?? openInBrowser)(page.href);
    const a = await answered;
    try {
      if (a.error) throw new Error(a.error === "access_denied" ? "It wasn't allowed in Google." : `Google said: ${a.errorDescription ?? a.error}`);
      // The answer must come from Google's own sign-in (RFC 9207), when it says where it came from.
      if (a.iss !== undefined && a.iss !== ISSUER) throw new Error("That answer didn't come from Google.");
      if (!a.code) throw new Error("Google sent no code back.");
      const t = await tokenCall({ grant_type: "authorization_code", code: a.code, code_verifier: verifier, redirect_uri: back.url }, client, f).catch((e: unknown) => Promise.reject(new Error(`Google didn't finish the sign-in: ${e instanceof Error ? e.message : String(e)}`)));
      // One call with the new token before it's kept: it reads Drive.
      await driveCall(t.access, "/files?pageSize=1&fields=files(id)", f).catch((e: unknown) => Promise.reject(e instanceof Unauthorized ? new Error("Google signed in, but Drive didn't take the token.") : e));
      back.check();
      await keep(t);
      const all = (await readSettings()).connectors ?? {};
      await writeSettings({ connectors: { ...all, drive: { via: "google" } } });
      a.reply(true, `Signed in to ${LABEL}`, "You can close this tab and go back to Qalam Studio.");
    } catch (e) {
      a.reply(false, `${LABEL} isn't connected`, e instanceof Error ? e.message : String(e));
      throw e;
    }
  } finally {
    back.stop();
    if (g.__qalamGoogleSignIn === stop) g.__qalamGoogleSignIn = null;
  }
}

/** Forget the sign-in: Google is asked to revoke the tokens (the refresh token takes its access tokens with it), then the Keychain lets them go. */
export async function forgetGoogle(f: FetchFn = fetch): Promise<void> {
  cancelGoogleSignIn();
  const t = await load();
  const token = t?.refresh ?? t?.access;
  if (token) await Promise.resolve(f(REVOKE, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(5000) })).catch(() => {});
  await keep(null);
}

// ---------------------------------------------------------------------------
// Drive's API

const FIELDS = "files(id,name,mimeType,modifiedTime,webViewLink)";

/** files.list's parameters for a search (every word in the title or text), a folder's items (null: My Drive), or what was opened lately. */
export function driveList(at: { query?: string; folder?: string | null }): URLSearchParams {
  const common = { fields: FIELDS, supportsAllDrives: "true", includeItemsFromAllDrives: "true" };
  const words = at.query?.trim() ? driveWords(at.query) : null;
  if (at.query?.trim()) return new URLSearchParams({ ...common, q: `${words ?? "name = ''"} and trashed = false`, pageSize: "50" });
  if (at.folder !== undefined) return new URLSearchParams({ ...common, q: `'${driveFolder(at.folder)}' in parents and trashed = false`, orderBy: "folder,name", pageSize: "100" });
  return new URLSearchParams({ ...common, q: "trashed = false", orderBy: "viewedByMeTime desc", pageSize: "25" });
}

export function browseDrive(at: { query?: string; folder?: string | null }, f: FetchFn = fetch): Promise<Hit[]> {
  return withToken(async (token) => {
    const j = (await (await driveCall(token, `/files?${driveList(at)}`, f)).json()) as { files?: unknown };
    return driveFileHits(Array.isArray(j.files) ? j.files : []);
  }, f);
}

/** How Drive gives a Google file as words: Docs and Slides as plain text, Sheets as CSV (its first sheet). */
const EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv" },
};

/** A Drive file's words, read here the way a file dropped in is (PDF, Word, sheets), or exported by Google for its own files. */
export function readDriveFile(hit: Pick<Hit, "id" | "title" | "url">, f: FetchFn = fetch): Promise<Ingested> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hit.id)) return Promise.reject(new IngestError("That isn't a Drive file."));
  return withToken(async (token) => {
    const meta = (await (await driveCall(token, `/files/${hit.id}?fields=id,name,mimeType,size&supportsAllDrives=true`, f)).json()) as { name?: string; mimeType?: string; size?: string };
    const mime = meta.mimeType ?? "";
    const name = meta.name?.trim() || hit.title;
    const ex = EXPORT[mime];
    if (!ex && driveType(mime) === "other") throw new IngestError(`Qalam can't read ${name}: it isn't a document, a PDF, slides or a sheet.`);
    if (!ex && Number(meta.size) > MAX_FILE) throw new IngestError(`${name} is over 40 MB.`);
    const res = await driveCall(token, ex ? `/files/${hit.id}/export?mimeType=${encodeURIComponent(ex.mime)}` : `/files/${hit.id}?alt=media&supportsAllDrives=true`, f);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_FILE) throw new IngestError(`${name} is over 40 MB.`);
    return ingestBytes(bytes, ex?.mime ?? mime, ex ? `${name}.${ex.ext}` : name, hit.url ?? `drive:${hit.id}`);
  }, f);
}
