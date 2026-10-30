import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { sourcesDb } from "@/discovery/db";
import { draftBacking, draftCards, type Drafted, type SolutionDraft } from "@/discovery/solutions";
import { newId } from "@/doc/factory";
import { decideDraft } from "@/org/solutions";
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

/**
 * A board for a need no board has yet: the need is its first card, a problem resting on what
 * customers said, for the need's product. Drafted solutions taken with it go under it, each with
 * its test, resting on the words they cite.
 */
export async function startBoardForNeed(topicId: string, o: { drafts?: SolutionDraft[]; quotes?: Drafted["quotes"] } = {}) {
  const c = await problemCard(topicId);
  if (!c) return;
  const doc = emptyDoc();
  const problem = makeCardNode(newCard("opportunity", { title: c.title, evidence: c.evidence }));
  addCardIn(doc, problem, null);
  const sources = new Map(c.sources.map((s) => [s.id, s]));
  for (const d of o.drafts ?? []) {
    const { solution, test } = draftCards(d);
    const backing = draftBacking(d, (ref) => o.quotes?.[ref] ?? null, Date.now(), newId);
    const evidence: OstEvidence[] = [...backing.words];
    for (const q of backing.quotes) {
      if (!sources.has(q.sourceId)) {
        const s = await sourcesDb.get(q.sourceId).catch(() => null);
        if (s) sources.set(s.id, s);
      }
      const s = sources.get(q.sourceId);
      const quote = s?.quotes.find((x) => x.id === q.quoteId);
      if (s && quote) evidence.push(quoteEvidence(s, quote, "ai"));
    }
    const node = makeCardNode({ ...solution, evidence });
    addCardIn(doc, node, problem.id);
    if (test) addCardIn(doc, makeCardNode(test), node.id);
  }
  const p = await createProject("discovery", c.title.slice(0, 80), c.products[0] ? { product: c.products[0] } : {}, doc);
  for (const s of sources.values()) await sourcesDb.link(s.id, p.id, true);
  for (const d of o.drafts ?? []) await decideDraft(topicId, d.id, "accepted").catch(() => {});
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
