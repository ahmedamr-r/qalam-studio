import { pickCall, searchesCall } from "@/ai/tool-look";
import { structured } from "@/ai/server";
import { connectorDef } from "@/connectors/catalog";
import { sanitizePicks, sanitizeSearches, type LookedHit } from "@/connectors/look";
import type { Hit } from "@/connectors/recipes";
import { browseConnector } from ".";

/*
 * Qalam AI looking inside a connected tool: it writes the searches, code runs them on the tool, and
 * it picks from the titles and snippets that came back. Code keeps a pick only as a result it was
 * sent. Nothing is read: the picks come back ticked for the person to add or leave.
 */

export interface LookDeps {
  structured: typeof structured;
  search: (id: string, words: string) => Promise<Hit[]>;
}

const realDeps: LookDeps = { structured, search: (id, query) => browseConnector(id, { query }) };

export async function lookInside(id: string, about: string, emit: (label: string) => void, signal?: AbortSignal, deps: LookDeps = realDeps): Promise<{ hits: LookedHit[]; searched: string[] }> {
  const tool = connectorDef(id)?.label ?? id;
  emit(`Qalam AI is working out what to search ${tool} for…`);
  const { data } = await deps.structured<unknown>(searchesCall(about, tool), signal);
  const searched = sanitizeSearches(data, about);
  const found = new Map<string, Hit>();
  for (const words of searched) {
    emit(`Searching ${tool} for “${words}”…`);
    // One search that fails doesn't end the look; all of them failing says why.
    const hits = await deps.search(id, words).catch((e: unknown) => {
      if (searched.length === 1) throw e;
      return [] as Hit[];
    });
    for (const h of hits) if (!h.folder && h.type !== "other" && !found.has(h.id)) found.set(h.id, h);
  }
  const sent = [...found.values()].slice(0, 40);
  if (!sent.length) return { hits: [], searched };
  emit(`Qalam AI is picking from ${sent.length} results…`);
  const picked = await deps.structured<unknown>(pickCall(about, tool, sent), signal);
  return { hits: sanitizePicks(picked.data, sent), searched };
}
