import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { sourcesDb } from "@/discovery/db";
import { quoteEvidence, type SourceRecord } from "@/discovery/sources";
import type { OstEvidence } from "@/discovery/types";
import { emptyDoc } from "@/doc/schema";
import { topicsDb } from "@/org/topics";
import { projectHref } from "@/projects/model";
import { createProject } from "@/projects/session";

const QUOTE = "hub:quote:";

/**
 * A board for a need no board has yet: the need is its first card, an opportunity resting on the
 * customers' words its "We know" lines cite, for the need's product. The sources those words are in
 * go on the board with it.
 */
export async function startBoardForNeed(topicId: string) {
  const view = await topicsDb.get(topicId);
  if (!view) return;
  const t = view.topic;
  const refs = [...new Set(t.lines.filter((l) => l.section === "know").flatMap((l) => l.cites))].filter((r) => r.startsWith(QUOTE));
  const sources = new Map<string, SourceRecord | null>();
  const evidence: OstEvidence[] = [];
  for (const ref of refs) {
    const sid = view.cited[ref]?.source;
    if (!sid) continue;
    if (!sources.has(sid)) sources.set(sid, await sourcesDb.get(sid).catch(() => null));
    const s = sources.get(sid);
    const q = s?.quotes.find((x) => x.id === ref.slice(QUOTE.length));
    if (s && q) evidence.push(quoteEvidence(s, q, "user"));
  }
  const doc = emptyDoc();
  addCardIn(doc, makeCardNode(newCard("opportunity", { title: t.title, evidence })), null);
  const p = await createProject("discovery", t.title.slice(0, 80), t.products[0] ? { product: t.products[0] } : {}, doc);
  for (const [id, s] of sources) if (s) await sourcesDb.link(id, p.id, true);
  window.location.assign(projectHref(p));
}
