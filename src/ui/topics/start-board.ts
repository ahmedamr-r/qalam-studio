import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { sourcesDb } from "@/discovery/db";
import { quoteEvidence, type SourceRecord } from "@/discovery/sources";
import type { OstEvidence } from "@/discovery/types";
import { emptyDoc } from "@/doc/schema";
import { changeGoal } from "@/goals/client";
import type { Goal } from "@/goals/types";
import { topicsDb } from "@/org/topics";
import { projectHref } from "@/projects/model";
import { createProject } from "@/projects/session";

const QUOTE = "hub:quote:";

/**
 * A problem as a card: its page's title, resting on the customers' words its "We know" lines cite,
 * and the sources those words are in (they go on the board with it).
 */
export async function problemCard(topicId: string): Promise<{ title: string; products: string[]; evidence: OstEvidence[]; sources: SourceRecord[] } | null> {
  const view = await topicsDb.get(topicId);
  if (!view) return null;
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
  return { title: t.title, products: t.products, evidence, sources: [...sources.values()].filter((s): s is SourceRecord => !!s) };
}

/** A board for a need no board has yet: the need is its first card, a problem resting on what customers said, for the need's product. */
export async function startBoardForNeed(topicId: string) {
  const c = await problemCard(topicId);
  if (!c) return;
  const doc = emptyDoc();
  addCardIn(doc, makeCardNode(newCard("opportunity", { title: c.title, evidence: c.evidence })), null);
  const p = await createProject("discovery", c.title.slice(0, 80), c.products[0] ? { product: c.products[0] } : {}, doc);
  for (const s of c.sources) await sourcesDb.link(s.id, p.id, true);
  window.location.assign(projectHref(p));
}

/**
 * A board for a goal no board works on yet: its outcome card is the goal (its words, number and
 * stage), and a problem to work on can go under it straight away.
 */
export async function startBoardForGoal(goal: Goal, topicId?: string) {
  const doc = emptyDoc();
  const outcome = makeCardNode(newCard("outcome", { title: goal.title, stage: goal.status, ...(goal.metric ? { metric: goal.metric } : {}) }));
  addCardIn(doc, outcome, null);
  const c = topicId ? await problemCard(topicId) : null;
  if (c) addCardIn(doc, makeCardNode(newCard("opportunity", { title: c.title, evidence: c.evidence })), outcome.id);
  const p = await createProject("discovery", goal.title.slice(0, 80), goal.product ? { product: goal.product } : {}, doc);
  await changeGoal(goal.id, { on: { board: p.id, card: outcome.id } }).catch(() => {});
  for (const s of c?.sources ?? []) await sourcesDb.link(s.id, p.id, true);
  window.location.assign(projectHref(p));
}
