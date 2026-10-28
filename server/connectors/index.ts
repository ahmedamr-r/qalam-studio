import { CATALOG, connectorDef, type ConnectorDef } from "@/connectors/catalog";
import { matchClaudeCode, type ListedStatus } from "@/connectors/claude-code";
import { itemText, RECIPES, type Hit } from "@/connectors/recipes";
import type { ConnectorState, ImportResult } from "@/org/connectors";
import { captureSource } from "../capture";
import type { OrgStore } from "../org/store";
import { secrets } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { claudeCodeKnown, listClaudeCode, runTools } from "./claude-code";
import { notionPageText, notionSearch, notionWhoAmI } from "./notion-api";

/*
 * The organization's connectors on this computer: how each is reached (Claude Code's server of
 * that name, or a token Qalam keeps in the Keychain), what Connections shows of them, and bringing
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
      const base = { id: def.id, label: def.label, group: def.group, feeds: def.feeds, imports: def.imports, claudeCode: listed ? { server: listed.name, status: listed.status } : null, token: token ? { last4: token.slice(-4) } : null, canToken: !!def.token, tokenHelp: def.token ?? null };
      return { ...base, ...stateOf(def, how?.via === "claude-code" ? (listed?.name === how.server ? listed.status : "unknown") : null, how?.via ?? null, !!token, listed?.status ?? null) };
    }),
  );
  return { checkedAt: known?.at ?? null, connectors };
}

/** One word and a dot for a connector's card. */
function stateOf(def: ConnectorDef, chosenStatus: ListedStatus | null, via: "claude-code" | "token" | null, hasToken: boolean, listed: ListedStatus | null): Pick<ConnectorState, "via" | "word" | "tone"> {
  if (via === "token" && hasToken) return { via, word: "Connected", tone: "ok" };
  if (via === "claude-code") return chosenStatus === "connected" || chosenStatus === "unknown" ? { via, word: "Through Claude Code", tone: "ok" } : { via, word: "Sign in in Claude Code", tone: "warn" };
  if (listed === "connected") return { via: null, word: "In Claude Code", tone: "off" };
  if (listed === "needs-auth") return { via: null, word: "Sign in in Claude Code", tone: "off" };
  return { via: null, word: def.imports || def.token ? "Not connected" : "Coming next", tone: "off" };
}

/** Use Claude Code's server for it (the user signed it in there). */
export async function viaClaudeCode(id: string, server: string) {
  const all = (await readSettings()).connectors ?? {};
  await writeSettings({ connectors: { ...all, [id]: { via: "claude-code", server } } });
}

/** Check a token with the service, keep it in the Keychain, and use it. Throws why not. */
export async function saveToken(id: string, raw: string, f?: typeof fetch): Promise<string> {
  const token = raw.trim();
  if (id !== "notion") throw new Error("Qalam can't keep a token for this one yet.");
  const who = await notionWhoAmI(token, f);
  await secrets().set(tokenName(id), token);
  const all = (await readSettings()).connectors ?? {};
  await writeSettings({ connectors: { ...all, [id]: { via: "token" } } });
  return who;
}

export async function forgetConnector(id: string) {
  await secrets().remove(tokenName(id)).catch(() => {});
  const all = { ...((await readSettings()).connectors ?? {}) };
  delete all[id];
  await writeSettings({ connectors: all });
}

async function how(id: string) {
  const def = connectorDef(id);
  const via = (await readSettings()).connectors?.[id];
  if (!def?.imports || !via) throw new Error("Connect it first.");
  if (via.via === "token") {
    const token = await secrets().get(tokenName(id));
    if (!token) throw new Error("Its token isn't in the Keychain any more: add it again.");
    return { via: "token" as const, token };
  }
  return { via: "claude-code" as const, server: via.server };
}

export async function searchConnector(id: string, query: string): Promise<Hit[]> {
  const h = await how(id);
  if (h.via === "token") return notionSearch(h.token, query);
  const recipe = RECIPES[id];
  const [answer] = await runTools(h.server, [recipe.search(query)]);
  if (answer === null) throw new Error("Claude Code didn't search it. Is it signed in there?");
  return recipe.hits(answer);
}

/** Read the picked items and take each in. `emit` hears how it's going. */
export async function importItems(store: OrgStore, id: string, hits: Hit[], emit: (label: string) => void): Promise<ImportResult> {
  const h = await how(id);
  const label = connectorDef(id)?.label ?? id;
  emit(`Reading ${hits.length === 1 ? `“${hits[0].title}”` : `${hits.length} items`} from ${label}`);
  const texts: (string | null)[] = h.via === "token" ? await Promise.all(hits.map((x) => notionPageText(h.token, x.id).catch(() => null))) : (await runTools(h.server, hits.map((x) => RECIPES[id].fetch(x)))).map((t) => (t === null ? null : itemText(t)));
  const out: ImportResult = { added: [], skipped: [], failed: [] };
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
      await captureSource(store, { kind: "connector", title: hit.title, origin, text }, { emit });
      out.added.push(hit.title);
    } catch (e) {
      out.failed.push({ title: hit.title, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export { listClaudeCode };
