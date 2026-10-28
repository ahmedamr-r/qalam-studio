import { CATALOG, connectorDef, signInGroup, type ConnectorDef } from "@/connectors/catalog";
import { matchClaudeCode, type ListedStatus } from "@/connectors/claude-code";
import { itemText, RECIPES, type Hit, type Recipe, type ToolCall } from "@/connectors/recipes";
import type { ConnectorState, ImportResult } from "@/org/connectors";
import { captureSource } from "../capture";
import type { OrgStore } from "../org/store";
import { secrets } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { claudeCodeKnown, listClaudeCode, runTools } from "./claude-code";
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

export type { ConnectorState, ImportResult } from "@/org/connectors";

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
      const base = { id: def.id, label: def.label, group: def.group, feeds: def.feeds, imports: def.imports, status: def.status ?? null, numbers: !!def.numbers, claudeCode: listed ? { server: listed.name, status: listed.status } : null, token: token ? { last4: token.slice(-4) } : null, canToken: !!def.token, tokenHelp: def.token ?? null, canSignIn: !!def.mcp, account: def.mcp?.account?.label ?? null, regions, ownApp };
      const kept = how?.via === "oauth" ? await signedIn(def.id) : !!token;
      const state = stateOf(def, how?.via === "claude-code" ? (listed?.name === how.server ? listed.status : "unknown") : null, how?.via ?? null, kept, listed?.status ?? null);
      // Which region's server it signed in to, where there are several.
      const region = how?.via === "oauth" && state.tone === "ok" ? def.mcp?.regions?.find((r) => r.url === how.url)?.label : undefined;
      return { ...base, ...state, ...(region ? { word: `${state.word} · ${region}` } : {}) };
    }),
  );
  return { checkedAt: known?.at ?? null, connectors };
}

/** One word and a dot for a connector's card. */
function stateOf(def: ConnectorDef, chosenStatus: ListedStatus | null, via: "claude-code" | "token" | "oauth" | null, kept: boolean, listed: ListedStatus | null): Pick<ConnectorState, "via" | "word" | "tone"> {
  if ((via === "token" || via === "oauth") && kept) return { via, word: "Connected", tone: "ok" };
  // The service stopped taking Qalam's sign-in (its refresh was refused).
  if (via === "oauth") return { via, word: "Sign in again", tone: "warn" };
  if (def.status === "public") return { via: null, word: "Public repositories", tone: "ok" };
  if (via === "claude-code") return chosenStatus === "connected" || chosenStatus === "unknown" ? { via, word: "Through Claude Code", tone: "ok" } : { via, word: "Sign in in Claude Code", tone: "warn" };
  if (listed === "connected") return { via: null, word: "In Claude Code", tone: "off" };
  if (listed === "needs-auth") return { via: null, word: "Sign in in Claude Code", tone: "off" };
  return { via: null, word: def.imports || def.token || def.numbers || def.mcp ? "Not connected" : "Coming next", tone: "off" };
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
  return { via: "claude-code" as const, server: via.server };
}

/** The site a recipe's calls are about (Atlassian's cloudId), asked first when it needs one. */
async function siteOf(id: string, recipe: Recipe, ask: (call: ToolCall) => Promise<string | null>): Promise<string | undefined> {
  if (!recipe.site) return undefined;
  const site = recipe.site.read((await ask(recipe.site.call)) ?? "");
  if (!site) throw new Error(`${connectorDef(id)?.label ?? id} has no site Qalam can reach.`);
  return site;
}

export async function searchConnector(id: string, query: string): Promise<Hit[]> {
  const h = await how(id);
  if (h.via === "token") return notionSearch(h.token, query);
  const recipe = RECIPES[id];
  if (h.via === "mcp") {
    const { site, answer } = await withSignedIn(id, h.url, async (call) => {
      const site = await siteOf(id, recipe, call);
      return { site, answer: await call(recipe.search(query, site)) };
    });
    if (answer === null) throw new Error(`${connectorDef(id)?.label ?? id} didn't search it.`);
    return recipe.hits(answer, site);
  }
  // Through Claude Code: a run per call, the site's first when the recipe needs one.
  const ask = async (call: ToolCall) => (await runTools(h.server, [call]))[0];
  const site = await siteOf(id, recipe, ask);
  const answer = await ask(recipe.search(query, site));
  if (answer === null) throw new Error("Claude Code didn't search it. Is it signed in there?");
  return recipe.hits(answer, site);
}

/** Read the picked items and take each in. `emit` hears how it's going. */
export async function importItems(store: OrgStore, id: string, hits: Hit[], emit: (label: string) => void): Promise<ImportResult> {
  const h = await how(id);
  const label = connectorDef(id)?.label ?? id;
  const recipe = RECIPES[id];
  const read = recipe.text ?? itemText;
  emit(`Reading ${hits.length === 1 ? `“${hits[0].title}”` : `${hits.length} items`} from ${label}`);
  const texts: (string | null)[] =
    h.via === "token"
      ? await Promise.all(hits.map((x) => notionPageText(h.token, x.id).catch(() => null)))
      : h.via === "mcp"
        ? await withSignedIn(id, h.url, async (call) => {
            const out: (string | null)[] = [];
            // An item the tool can't give is noted; a sign-in the service stopped taking ends it.
            for (const x of hits) out.push(await call(recipe.fetch(x)).then((t) => (t === null ? null : read(t)), (e: unknown) => (e instanceof SignInAgain ? Promise.reject(e) : null)));
            return out;
          })
        : (await runTools(h.server, hits.map((x) => recipe.fetch(x)))).map((t) => (t === null ? null : read(t)));
  const out: ImportResult & { sources: string[]; pages: string[] } = { added: [], skipped: [], failed: [], sources: [], pages: [] };
  const have = await store.listSources();
  for (const [i, hit] of hits.entries()) {
    const text = texts[i]?.trim();
    if (!text) {
      out.failed.push({ title: hit.title, why: "Nothing came back for it." });
      continue;
    }
    const origin = hit.url ?? `${id}:${hit.id}`;
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
