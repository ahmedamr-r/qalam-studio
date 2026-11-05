import { isOstCard } from "@/doc/board";
import type { Doc } from "@/doc/schema";
import { sameTopic } from "@/hub/topics";
import type { LaneEdge } from "./lane";
import { nearestProblem, outcomeOf } from "./tree";
import type { OstCard, OstHelp, OstHelpTarget } from "./types";

/*
 * What a solution helps besides the problem it hangs under (pure): a card has one parent, so the
 * others are links on the solution, drawn as faint dashed wires. A link names its problem by the card,
 * or by its page when the problem is only a page on the canvas, and by its title; which card that is
 * is worked out when it's read, so a page turning into a card (Work on it, or anything else) needs
 * nothing done to it. The goals a solution reaches are worked out from the wires. A link a person took
 * off stays as `off`, so Qalam AI never proposes it again.
 */

/** The card a problem's page is drawn as on this canvas (`cardForPage` on a space's canvas; none on a board). */
export type PageCard = (topic: string) => string | undefined;

const noPages: PageCard = () => undefined;

const isProblem = (doc: Doc, id: string) => {
  const n = doc.nodes[id];
  return isOstCard(n) && n.meta.ost.kind === "opportunity";
};

/** Which card a link is to, as the canvas is now: the card, the page's faint card, else a problem of the same name. */
export function helpsTarget(to: OstHelpTarget, doc: Doc, pageCard: PageCard = noPages): string | null {
  if (to.card && isProblem(doc, to.card)) return to.card;
  const page = to.topic ? pageCard(to.topic) : undefined;
  if (page && isProblem(doc, page)) return page;
  for (const n of Object.values(doc.nodes)) if (isOstCard(n) && n.meta.ost.kind === "opportunity" && sameTopic(n.meta.ost.title, to.title)) return n.id;
  return null;
}

/** Two links to the same problem: by its card or page, else its name. */
export function sameHelp(a: OstHelpTarget, b: OstHelpTarget): boolean {
  if (a.card && b.card) return a.card === b.card;
  if (a.topic && b.topic) return a.topic === b.topic;
  return sameTopic(a.title, b.title);
}

/** The links that are on: taken off they stay, only to be remembered. */
export const activeHelps = (card: Pick<OstCard, "helps">): OstHelp[] => (card.helps ?? []).filter((h) => !h.off);

/** A link added, or put back if a person took it off. A link Qalam AI adds never puts back one a person took off. */
export function withHelp(card: Pick<OstCard, "helps">, to: OstHelpTarget, by: OstHelp["by"], at: number): OstHelp[] | null {
  const list = card.helps ?? [];
  const had = list.find((h) => sameHelp(h.to, to));
  if (had && (!had.off || by === "ai")) return null;
  return [...list.filter((h) => h !== had), { to, by, at }];
}

/** A link taken off. It's remembered: Qalam AI doesn't propose it again. */
export const withoutHelp = (card: Pick<OstCard, "helps">, to: OstHelpTarget, at: number): OstHelp[] => (card.helps ?? []).map((h) => (sameHelp(h.to, to) ? { ...h, off: true as const, at } : h));

/** The problems a solution helps besides the one above it, as cards on the canvas, each once. */
export function helpedCards(doc: Doc, id: string, pageCard: PageCard = noPages): string[] {
  const n = doc.nodes[id];
  if (!isOstCard(n)) return [];
  const own = nearestProblem(doc, id);
  const out = activeHelps(n.meta.ost).flatMap((h) => helpsTarget(h.to, doc, pageCard) ?? []);
  return [...new Set(out)].filter((t) => t !== own && t !== id);
}

/** The goals a solution reaches: the one above it, and the one above each problem it helps. */
export function goalsReached(doc: Doc, id: string, pageCard: PageCard = noPages): string[] {
  return [...new Set([id, ...helpedCards(doc, id, pageCard)].flatMap((c) => outcomeOf(doc, c) ?? []))];
}

/** The wires: from each visible solution up to each problem it helps (a card's hidden in a folded branch, its wires go with it). */
export function helpEdges(doc: Doc, pageCard: PageCard = noPages): LaneEdge[] {
  const out: LaneEdge[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (!isOstCard(n) || n.meta.ost.kind !== "solution" || !n.visible || !n.meta.ost.helps?.length) continue;
    for (const to of helpedCards(doc, n.id, pageCard)) if (doc.nodes[to]?.visible) out.push({ id: `helps:${n.id}>${to}`, from: n.id, to, quotes: [], kind: "helps" });
  }
  return out;
}

/** The problems on the canvas a solution could help, by name, as a link would name them. */
export function helpChoices(doc: Doc, id: string, topicOf: (card: string) => string | undefined = () => undefined, pageCard: PageCard = noPages): { card: string; to: OstHelpTarget }[] {
  const own = nearestProblem(doc, id);
  const on = new Set(helpedCards(doc, id, pageCard));
  return Object.values(doc.nodes).flatMap((n) => {
    if (!isOstCard(n) || n.meta.ost.kind !== "opportunity" || n.id === own || on.has(n.id)) return [];
    const topic = topicOf(n.id);
    return [{ card: n.id, to: topic ? { topic, title: n.meta.ost.title } : { card: n.id, title: n.meta.ost.title } }];
  });
}
