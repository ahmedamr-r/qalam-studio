import { CATALOG, connectorDef, signInGroup, type ConnectorDef } from "@/connectors/catalog";
import { matchClaudeCode, type ListedStatus } from "@/connectors/claude-code";
import { itemText, RECIPES, type Hit, type Recipe, type ToolCall } from "@/connectors/recipes";
import { capText } from "@/discovery/ingest/text";
import type { ConnectorState, ImportResult, ReadItem } from "@/org/connectors";
import { captureSource } from "../capture";
import type { OrgStore } from "../org/store";
import { secrets } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { claudeCodeKnown, listClaudeCode, runTools } from "./claude-code";
import { browseDrive, forgetGoogle, googleClient, googleSignedIn, readDriveFile } from "./google";
import { notionPageText, notionSearch, notionWhoAmI } from "./notion-api";
import { appKept, forgetSignIn, signedIn, SignInAgain, withSignedIn } from "./oauth";
import { linearWhoAmI } from "./work";

/*
 * The organization's connectors on this computer: how each is reached (Claude Code's server of
 * that name, a token Qalam keeps in the Keychain, or Qalam's own sign-in to the service's MCP server,
 * server/connectors/oauth.ts), what Connections shows of them, and bringing
 * their material in. A search lists items; the ones picked are read (their words as the tool gave
 * them) and taken in like any other source (server/capture.ts): kept, read, filed into the topic
 * pages and placed on the boards. An item already taken in with the same words is skipped.
 */

export type { ConnectorState, ImportResult, ReadItem } from "@/org/connectors";

const tokenName = (id: string) => `connector:${id}`;

export async function connectorsView(): Promise<{ checkedAt: number | null; connectors: ConnectorState[] }> {
  const known = claudeCodeKnown();
  const chosen = (await readSettings()).connectors ?? {};
  const connectors = await Promise.all(
    CATALOG.map(async (def): Promise<ConnectorState> => {
      const listed = known ? matchClaudeCode(def, known.list) : null;
      const how = chosen[def.id];
      const token = def.token ? await secrets().get(tokenName(def.id)).catch(() => null) : null;
      const regions = def.mcp?.regions?.map(({ id, label }) => ({ id, label })) ?? null;
      const own = def.mcp?.ownApp;
      const ownApp = own ? { kept: await appKept(def.id), create: own.create, where: own.where, callback: own.callback } : null;
      // Qalam's own Google sign-in, only in a copy that has a Google client.
      const google = !!def.google && !!googleClient();
      const base = { id: def.id, label: def.label, group: def.group, feeds: def.feeds, imports: def.imports, status: def.status ?? null, numbers: !!def.numbers, screens: !!def.screens, claudeCode: listed ? { server: listed.name, status: listed.status } : null, token: token ? { last4: token.slice(-4) } : null, canToken: !!def.token, tokenHelp: def.token ?? null, canSignIn: !!def.mcp || google, account: def.mcp?.account?.label ?? (google ? "Google" : null), regions, ownApp };
      const kept = how?.via === "oauth" ? await signedIn(def.id) : how?.via === "google" ? await googleSignedIn() : !!token;
      const state = stateOf(def, how?.via === "claude-code" ? (listed?.name === how.server ? listed.status : "unknown") : null, how?.via ?? null, kept, listed?.status ?? null);
      // Which region's server it signed in to, where there are several.
      const region = how?.via === "oauth" && state.tone === "ok" ? def.mcp?.regions?.find((r) => r.url === how.url)?.label : undefined;
      return { ...base, ...state, ...(region ? { word: `${state.word} · ${region}` } : {}) };
    }),
  );
  return { checkedAt: known?.at ?? null, connectors };
}

/** One word and a dot for a connector's card. */
function stateOf(def: ConnectorDef, chosenStatus: ListedStatus | null, via: "claude-code" | "token" | "oauth" | "google" | null, kept: boolean, listed: ListedStatus | null): Pick<ConnectorState, "via" | "word" | "tone"> {
  if ((via === "token" || via === "oauth" || via === "google") && kept) return { via, word: "Connected", tone: "ok" };
  // The service stopped taking Qalam's sign-in (its refresh was refused).
  if (via === "oauth" || via === "google") return { via, word: "Sign in again", tone: "warn" };
  if (def.status === "public") return { via: null, word: "Public repositories", tone: "ok" };
  if (via === "claude-code") return chosenStatus === "connected" || chosenStatus === "unknown" ? { via, word: "Through Claude Code", tone: "ok" } : { via, word: "Sign in in Claude Code", tone: "warn" };
  if (listed === "connected") return { via: null, word: "In Claude Code", tone: "off" };
  if (listed === "needs-auth") return { via: null, word: "Sign in in Claude Code", tone: "off" };
  return { via: null, word: def.imports || def.token || def.numbers || def.screens || def.mcp ? "Not connected" : "Coming next", tone: "off" };
}

/** Use Claude Code's server for it (the user signed it in there). */
export async function viaClaudeCode(id: string, server: string) {
  const all = (await readSettings()).connectors ?? {};
  await writeSettings({ connectors: { ...all, [id]: { via: "claude-code", server } } });
}

/** Check a token with the service, keep it in the Keychain, and use it. Throws why not. */
export async function saveToken(id: string, raw: string, f?: typeof fetch): Promise<string> {
  const token = raw.trim();
  const check = TOKEN_CHECKS[id];
  if (!check) throw new Error("Qalam can't keep a token for this one yet.");
  const who = await check(token, f);
  await secrets().set(tokenName(id), token);
  const all = (await readSettings()).connectors ?? {};
  await writeSettings({ connectors: { ...all, [id]: { via: "token" } } });
  return who;
}

export async function forgetConnector(id: string) {
  await secrets().remove(tokenName(id)).catch(() => {});
  if (connectorDef(id)?.mcp) await forgetSignIn(id).catch(() => {});
  if (connectorDef(id)?.google) await forgetGoogle().catch(() => {});
  const all = { ...((await readSettings()).connectors ?? {}) };
  delete all[id];
  // A sign-in shared with other connectors is gone for them too.
  for (const x of signInGroup(id)) if (all[x]?.via === "oauth") delete all[x];
  await writeSettings({ connectors: all });
}

/** Whose token it is, asked of the service (it throws when the service refuses it). */
const TOKEN_CHECKS: Record<string, (token: string, f?: typeof fetch) => Promise<string>> = { notion: notionWhoAmI, linear: linearWhoAmI };

async function how(id: string) {
  const def = connectorDef(id);
  const via = (await readSettings()).connectors?.[id];
  if (!def?.imports || !via) throw new Error("Connect it first.");
  if (via.via === "token") {
    const token = await secrets().get(tokenName(id));
    if (!token) throw new Error("Its token isn't in the Keychain any more: add it again.");
    return { via: "token" as const, token };
  }
  if (via.via === "oauth") return { via: "mcp" as const, url: via.url };
  if (via.via === "google") return { via: "google" as const };
  return { via: "claude-code" as const, server: via.server };
}

/** The site a recipe's calls are about (Atlassian's cloudId), asked first when it needs one. */
async function siteOf(id: string, recipe: Recipe, ask: (call: ToolCall) => Promise<string | null>): Promise<string | undefined> {
  if (!recipe.site) return undefined;
  const site = recipe.site.read((await ask(recipe.site.call)) ?? "");
  if (!site) throw new Error(`${connectorDef(id)?.label ?? id} has no site Qalam can reach.`);
  return site;
}

type How = Awaited<ReturnType<typeof how>>;

/** Calls on the connector's tools, however it's reached (Qalam's sign-in, or Claude Code: a run per call), the site first when its recipe needs one. */
async function onTools<T>(id: string, h: Exclude<How, { via: "token" } | { via: "google" }>, fn: (call: (c: ToolCall) => Promise<string | null>, site: string | undefined) => Promise<T>): Promise<T> {
  const recipe = RECIPES[id];
  if (h.via === "mcp") return withSignedIn(id, h.url, async (call) => fn(call, await siteOf(id, recipe, call)));
  const ask = async (c: ToolCall) => (await runTools(h.server, [c]))[0];
  return fn(ask, await siteOf(id, recipe, ask));
}

export async function searchConnector(id: string, query: string): Promise<Hit[]> {
  const h = await how(id);
  if (h.via === "token") return notionSearch(h.token, query);
  if (h.via === "google") return browseDrive({ query });
  const recipe = RECIPES[id];
  const { site, answer } = await onTools(id, h, async (call, site) => ({ site, answer: await call(recipe.search(query, site)) }));
  if (answer === null) throw new Error(h.via === "mcp" ? `${connectorDef(id)?.label ?? id} didn't search it.` : "Claude Code didn't search it. Is it signed in there?");
  return recipe.hits(answer, site);
}

/*
 * Browsing, for the chat box's picker: what was opened lately, a folder's items, or a search.
 * Through Claude Code each is a run of its own (Drive's took about 9 s in October 2026), so answers
 * are kept five minutes per connector and place, and going back is instant.
 */
const BROWSE_MS = 5 * 60_000;
const gb = globalThis as { __qalamBrowse?: Map<string, { at: number; hits: Hit[] }> };

/** Where to look: words to search for, else a folder (null: the top), else what was opened lately. */
export interface BrowseAt {
  query?: string;
  folder?: string | null;
}

export async function browseConnector(id: string, at: BrowseAt, o: { force?: boolean; now?: number } = {}): Promise<Hit[]> {
  const now = o.now ?? Date.now();
  const words = at.query?.trim() ?? "";
  const key = `${id}\n${words ? `q:${words}` : at.folder !== undefined ? `f:${at.folder ?? ""}` : "recent"}`;
  const kept = (gb.__qalamBrowse ??= new Map());
  const hit = kept.get(key);
  if (!o.force && hit && now - hit.at < BROWSE_MS) return hit.hits;
  const hits = await browseNow(id, words, at.folder);
  kept.set(key, { at: now, hits });
  return hits;
}

async function browseNow(id: string, words: string, folder: string | null | undefined): Promise<Hit[]> {
  if (words) return searchConnector(id, words);
  const h = await how(id);
  // Notion's API lists the pages shared with the integration, newest first.
  if (h.via === "token") return folder === undefined ? notionSearch(h.token, "") : [];
  if (h.via === "google") return browseDrive(folder !== undefined ? { folder } : {});
  const recipe = RECIPES[id];
  const call = folder !== undefined ? recipe.list?.(folder) : recipe.recent?.();
  if (!call) return [];
  const { site, answer } = await onTools(id, h, async (ask, site) => ({ site, answer: await ask(call) }));
  if (answer === null) throw new Error(h.via === "mcp" ? `${connectorDef(id)?.label ?? id} didn't answer.` : "Claude Code didn't answer. Is it signed in there?");
  return recipe.hits(answer, site);
}

/** The picked items' words as each tool gave them (null: nothing came back for it). A sign-in the service stopped taking ends it. */
async function readTexts(id: string, hits: Hit[], emit: (label: string) => void): Promise<(string | null)[]> {
  const h = await how(id);
  const label = connectorDef(id)?.label ?? id;
  const recipe = RECIPES[id];
  const read = recipe.text ?? itemText;
  emit(readingLabel(label, hits));
  if (h.via === "token") return Promise.all(hits.map((x) => notionPageText(h.token, x.id).catch(() => null)));
  // A sign-in Google stopped taking ends it; a file it can't give is noted.
  if (h.via === "google") return Promise.all(hits.map((x) => readDriveFile(x).then((i) => i.text, (e: unknown) => (e instanceof SignInAgain ? Promise.reject(e) : null))));
  if (h.via === "mcp")
    return withSignedIn(id, h.url, async (call) => {
      const out: (string | null)[] = [];
      // An item the tool can't give is noted; a sign-in the service stopped taking ends it.
      for (const x of hits) out.push(await call(recipe.fetch(x)).then((t) => (t === null ? null : read(t)), (e: unknown) => (e instanceof SignInAgain ? Promise.reject(e) : null)));
      return out;
    });
  return (await runTools(h.server, hits.map((x) => recipe.fetch(x)))).map((t) => (t === null ? null : read(t)));
}

const readingLabel = (label: string, hits: Hit[]) => `Reading ${hits.length === 1 ? `“${hits[0].title}”` : `${hits.length} items`} from ${label}`;

/** Where an item came from: its address, else the tool and its id. */
const originOf = (id: string, hit: Hit) => hit.url ?? `${id}:${hit.id}`;

/** The picked items as material, read and not taken in: the chat box holds them until it sends. */
export async function readItems(id: string, hits: Hit[], emit: (label: string) => void): Promise<ReadItem[]> {
  // Drive's own files read here as files are (a PDF keeps its pages), each on its own.
  if ((await how(id)).via === "google") {
    emit(readingLabel(connectorDef(id)?.label ?? id, hits));
    return Promise.all(
      hits.map(async (hit): Promise<ReadItem> => {
        try {
          const ing = await readDriveFile(hit);
          return { id: hit.id, title: hit.title, ingested: { ...ing, kind: "connector", title: hit.title, origin: originOf(id, hit) } };
        } catch (e) {
          if (e instanceof SignInAgain) throw e;
          return { id: hit.id, title: hit.title, why: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }
  const texts = await readTexts(id, hits, emit);
  return hits.map((hit, i) => {
    const text = texts[i]?.trim();
    if (!text) return { id: hit.id, title: hit.title, why: "Nothing came back for it." };
    const c = capText(text);
    return { id: hit.id, title: hit.title, ingested: { kind: "connector", title: hit.title, origin: originOf(id, hit), text: c.text, ...(c.truncated ? { truncated: true } : {}) } };
  });
}

/** Read the picked items and take each in. `emit` hears how it's going. */
export async function importItems(store: OrgStore, id: string, hits: Hit[], emit: (label: string) => void): Promise<ImportResult> {
  const texts = await readTexts(id, hits, emit);
  const out: ImportResult & { sources: string[]; pages: string[] } = { added: [], skipped: [], failed: [], sources: [], pages: [] };
  const have = await store.listSources();
  for (const [i, hit] of hits.entries()) {
    const text = texts[i]?.trim();
    if (!text) {
      out.failed.push({ title: hit.title, why: "Nothing came back for it." });
      continue;
    }
    const origin = originOf(id, hit);
    if (have.some((s) => s.origin === origin && s.text.trim() === text)) {
      out.skipped.push(hit.title);
      continue;
    }
    try {
      emit(`Taking in “${hit.title}”`);
      const r = await captureSource(store, { kind: "connector", title: hit.title, origin, text }, { emit });
      out.added.push(hit.title);
      out.sources.push(r.sourceId);
      for (const p of r.filed?.pages ?? []) if (!out.pages.includes(p.id)) out.pages.push(p.id);
    } catch (e) {
      out.failed.push({ title: hit.title, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export { listClaudeCode };
