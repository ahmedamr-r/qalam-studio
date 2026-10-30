import { create } from "zustand";
import { feedback } from "@/commands/feedback";
import { isOstCard } from "@/doc/board";
import { newId } from "@/doc/factory";
import { studio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import type { Proposal } from "@/discovery/proposals";
import { draftBacking, draftCards, type Drafted, type SolutionDraft } from "@/discovery/solutions";
import { sameTopic } from "@/hub/topics";
import { draftSolutions, solutionsOf } from "@/org/solutions";
import { topicsDb } from "@/org/topics";
import { glideToLayer, onCanvasReady } from "./canvas";
import { startReview } from "./review";
import { visitSources } from "./sources";

/*
 * Drafting solutions for a problem on a board (src/discovery/solutions.ts): the problem's card asks
 * (with its page, when it has one), and what Qalam AI drafted comes back as proposals under it to
 * review like any other: each solution with its riskiest assumptions, its test under it. A page's
 * drafts kept from before open the same way (?solutions=<page>).
 */

/** The card being drafted for, and what's happening. */
export const useDrafting = create<{ card: string | null; label: string | null }>(() => ({ card: null, label: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The problem's page, by its card's words (a page's card is named after it). */
async function pageOf(title: string): Promise<string | null> {
  const list = await topicsDb.list().catch(() => []);
  return list.find((t) => t.kind === "need" && sameTopic(t.title, title))?.id ?? null;
}

/** Drafts as proposals under the problem's card: each solution with its assumptions, its test under it. */
export function draftProposals(drafts: SolutionDraft[], quotes: Drafted["quotes"], problemId: string, now = Date.now()): Proposal[] {
  const out: Proposal[] = [];
  for (const d of drafts) {
    const { solution, test } = draftCards(d);
    const solutionId = newId();
    out.push({ id: `sol:${d.id}`, kind: "card", cardId: solutionId, parentId: problemId, card: solution, backing: draftBacking(d, (ref) => quotes[ref] ?? null, now, newId), why: d.description });
    if (test && d.test) out.push({ id: `test:${d.id}`, kind: "card", cardId: newId(), parentId: solutionId, card: test, backing: { quotes: [], words: [] }, why: d.test.how });
  }
  return out;
}

async function review(drafts: SolutionDraft[], quotes: Drafted["quotes"], topic: string | null, problemId: string): Promise<boolean> {
  // The words they rest on are in the organization's sources: shown here until accepted.
  await visitSources(Object.values(quotes).map((q) => q.sourceId));
  const proposals = draftProposals(drafts, quotes, problemId);
  return proposals.length > 0 && startReview({ kind: "solutions", topic }, proposals);
}

/** Qalam AI drafts solutions for a problem's card; they come back as proposals under it. */
export async function draftSolutionsFor(cardId: string): Promise<void> {
  if (useDrafting.getState().card) return;
  const doc = studio().doc;
  const node = doc.nodes[cardId];
  const card = cardOf(doc, cardId);
  if (!isOstCard(node) || card?.kind !== "opportunity") return;
  useDrafting.setState({ card: cardId, label: "Reading what the problem rests on" });
  try {
    const topic = await pageOf(card.title);
    const children = node.children.flatMap((id) => {
      const c = cardOf(doc, id);
      return c && (c.kind === "solution" || c.kind === "test") ? [{ title: c.title, kind: c.kind }] : [];
    });
    const evidence = card.evidence.filter((e) => e.stance !== "against").map((e) => ({ text: e.text, kind: e.kind, ...(e.piece ? { piece: e.piece } : {}), ...(e.sourceId ? { sourceId: e.sourceId } : {}), ...(e.sourceTitle ? { sourceTitle: e.sourceTitle } : {}) }));
    const d = await draftSolutions({ topic, card: { title: card.title, evidence, children } }, (label) => useDrafting.setState({ label }));
    if (!(await review(d.drafts, d.quotes, d.topic, cardId))) return void feedback(d.note || "Qalam AI found no way it could stand behind.", { id: "discovery.solutions" });
    if (d.note) feedback(d.note, { id: "discovery.solutions" });
  } catch (e) {
    feedback(`Qalam AI couldn't draft solutions: ${message(e)}`, { kind: "error", id: "discovery.solutions" });
  } finally {
    useDrafting.setState({ card: null, label: null });
  }
}

/** Opened from a problem's page (?solutions=<page>): the drafts kept there, not decided yet, under its card here. */
export async function draftsFromUrl(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const topic = params.get("solutions");
  if (!topic) return;
  params.delete("solutions");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  const [kept, page] = await Promise.all([solutionsOf(topic).catch(() => null), topicsDb.get(topic).catch(() => null)]);
  if (!kept || !page) return;
  const doc = studio().doc;
  const card = Object.values(doc.nodes).find((n) => isOstCard(n) && n.meta.ost?.kind === "opportunity" && sameTopic(n.meta.ost.title, page.topic.title));
  if (!card) return void feedback("This board doesn't have the problem: add it, then draft solutions on its card.", { id: "discovery.solutions" });
  const open = kept.drafts.filter((d) => !kept.decided[d.id]);
  studio().select([card.id]);
  onCanvasReady((canvas) => glideToLayer(canvas, card.id));
  if (open.length) await review(open, kept.quotes, topic, card.id);
}
