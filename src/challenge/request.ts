import type { Doc } from "@/doc/schema";
import type { Proposal } from "@/discovery/proposals";
import type { SpaceThing } from "@/space/compose";
import { planOutline } from "@/space/plan";
import type { CheckCard, CheckItem, CheckRequest } from "./types";

/*
 * What the window sends to have a round of proposals checked (pure): the canvas as plan mode reads it,
 * with each goal's id and whether nothing measured or said backs a card, and the proposals that add
 * a goal, a problem or a solution, each under a card on the canvas or another proposal. Tests,
 * quotes attached, rewordings and moves aren't checked.
 */

export interface RequestInput {
  key: string;
  asked: string;
  product: string | null;
  doc: Doc;
  things: ReadonlyMap<string, SpaceThing>;
  proposals: readonly Proposal[];
  /** Whether nothing measured or said backs a card on the canvas. */
  unbacked: (cardId: string) => boolean;
  /** Whether nothing measured or said backs a proposed card, its backing counted as it would land. */
  unbackedProposal: (p: Extract<Proposal, { kind: "card" }>) => boolean;
}

export function checkRequest(o: RequestInput): CheckRequest {
  const outline: CheckCard[] = planOutline(o.doc, o.things).map((c) => {
    const t = o.things.get(c.id);
    const goal = t?.type === "goal" ? t.goal : undefined;
    return { id: c.id, kind: c.kind, title: c.title, parent: c.parent, ...(c.topic ? { topic: c.topic } : {}), ...(c.kind === "outcome" && goal ? { goal } : {}), ...(c.kind !== "outcome" && !c.faint && o.unbacked(c.id) ? { assumed: true as const } : {}) };
  });
  // A proposal under a card another proposal adds hangs under that proposal.
  const byCard = new Map(o.proposals.flatMap((p) => (p.kind === "card" ? [[p.cardId, p.id] as const] : [])));
  const parentOf = (id: string | null) => (id ? (byCard.get(id) ?? id) : null);
  const items: CheckItem[] = o.proposals.flatMap((p): CheckItem[] => {
    if (p.kind === "goal") return [{ id: p.id, kind: "outcome", title: p.card.title, parent: p.parentId, goal: p.goal }];
    if (p.kind !== "card") return [];
    const c = p.card;
    const kind = c.kind;
    if (kind === "test") return [];
    const t = p.replaces ? o.things.get(p.replaces) : undefined;
    return [
      {
        id: p.id,
        kind,
        title: c.title,
        ...(c.description ? { description: c.description } : {}),
        ...(c.how ? { how: c.how } : {}),
        ...(c.assumptions?.length ? { assumptions: c.assumptions.map((a) => a.text) } : {}),
        parent: parentOf(p.parentId),
        ...(t?.type === "problem" ? { topic: t.topic } : {}),
        ...(kind !== "outcome" && o.unbackedProposal(p) ? { assumed: true as const } : {}),
      },
    ];
  });
  return { origin: o.key, asked: o.asked, product: o.product, outline, items };
}
