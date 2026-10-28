import type { Doc } from "@/doc/schema";
import type { OstCard, OstMetric, OutcomeStage } from "@/discovery/types";
import { sameTopic, sameWords } from "@/hub/topics";
import { outcomeGoalId } from "./migrate";
import type { Goal, GoalTree } from "./types";

/*
 * A board's outcome cards and the goals they work on (pure). goals.md holds the truth; each card
 * keeps a copy of its goal's words, number and stage, to paint and lay out. While the board is
 * open the two are brought together: whichever changed since they last agreed passes its change to
 * the other. Both changed: the goal wins, since the board's change was made on an older copy.
 */

export interface GoalCopy {
  title: string;
  metric?: OstMetric;
  stage: OutcomeStage;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : x));

export const copyOfGoal = (g: Goal): GoalCopy => ({ title: g.title, ...(g.metric ? { metric: g.metric } : {}), stage: g.status });
export const copyOfCard = (c: OstCard): GoalCopy => ({ title: c.title.replace(/\s+/g, " ").trim(), ...(c.metric ? { metric: c.metric } : {}), stage: (c.stage as OutcomeStage) ?? "active" });
export const sameCopy = (a: GoalCopy | undefined, b: GoalCopy | undefined) => !!a && !!b && stable(a) === stable(b);

type Node = { parentId?: string | null; meta?: { ost?: OstCard } };

export interface OutcomeAt {
  card: string;
  ost: OstCard;
  /** The outcome card it sits under on the board (a sub-outcome). */
  parent: string | null;
}

/** A board's outcome cards, each with the outcome above it. */
export function outcomesOf(doc: Doc): OutcomeAt[] {
  const nodes = doc.nodes as unknown as Record<string, Node>;
  const out: OutcomeAt[] = [];
  for (const [id, n] of Object.entries(nodes)) {
    const c = n.meta?.ost;
    if (c?.kind !== "outcome") continue;
    let p = n.parentId ?? null;
    while (p && nodes[p]?.meta?.ost?.kind !== "outcome") p = nodes[p]?.parentId ?? null;
    out.push({ card: id, ost: c, parent: p });
  }
  return out;
}

export interface Reconciled {
  /** Cards to bring up to their goal (card id → the goal's copy). */
  toCard: Map<string, GoalCopy>;
  /** Goals to bring up to their card (goal id → the card's copy). */
  toGoal: Map<string, GoalCopy>;
  /** Outcome cards with no goal yet that a goal already names in the same words: link them (goal id → card id). */
  link: Map<string, string>;
  /** Outcome cards with no goal yet: the goal each gets (its id is fixed, so two windows make one). */
  create: Goal[];
  /** Goals whose card is gone from the board. */
  unlink: string[];
  /** Each linked card's copy as it will be once these are done. */
  synced: Map<string, GoalCopy>;
}

/**
 * What to change so a board's cards and goals agree. `synced` is each card's copy as they last
 * agreed (none on opening: the goal's copy wins). An outcome card with no title isn't a goal yet.
 */
export function reconcile(x: { board: string; product: string | null; doc: Doc; goals: GoalTree; synced: ReadonlyMap<string, GoalCopy>; now: number }): Reconciled {
  const out: Reconciled = { toCard: new Map(), toGoal: new Map(), link: new Map(), create: [], unlink: [], synced: new Map() };
  const byCard = new Map<string, Goal>();
  for (const g of x.goals.goals) if (g.on?.board === x.board) byCard.set(g.on.card, g);
  const outcomes = outcomesOf(x.doc);
  const here = new Set(outcomes.map((o) => o.card));
  for (const [card, g] of byCard) if (!here.has(card)) out.unlink.push(g.id);
  const known = new Set(x.goals.goals.map((g) => g.id));
  // Goals no board works on, which a card here may be (the product's own goal, written as words).
  const free = x.goals.goals.filter((g) => !g.on && (g.product === x.product || g.product === null));
  for (const o of outcomes) {
    const card = copyOfCard(o.ost);
    const g = byCard.get(o.card);
    if (!g) {
      if (!card.title) continue;
      const twin = free.find((f) => !out.link.has(f.id) && sameWords(f.title) === sameWords(card.title)) ?? free.find((f) => !out.link.has(f.id) && sameTopic(f.title, card.title));
      if (twin) {
        out.link.set(twin.id, o.card);
        byCard.set(o.card, twin);
        out.toCard.set(o.card, copyOfGoal({ ...twin, metric: twin.metric ?? card.metric }));
        out.synced.set(o.card, copyOfGoal({ ...twin, metric: twin.metric ?? card.metric }));
        if (!twin.metric && card.metric) out.toGoal.set(twin.id, { ...copyOfGoal(twin), metric: card.metric });
        continue;
      }
      const id = outcomeGoalId(x.board, o.card);
      if (known.has(id)) continue; // made already, linked elsewhere since: leave it
      const parent = o.parent ? (byCard.get(o.parent)?.id ?? null) : null;
      out.create.push({ id, title: card.title, parent, product: x.product, ...(card.metric ? { metric: card.metric } : {}), status: card.stage, on: { board: x.board, card: o.card }, cites: [], by: "person", at: x.now });
      out.synced.set(o.card, card);
      continue;
    }
    const goal = copyOfGoal(g);
    const last = x.synced.get(o.card);
    if (sameCopy(card, goal)) out.synced.set(o.card, goal);
    else if (last && sameCopy(goal, last) && card.title) {
      // Only the card changed since they agreed: the board's edit goes to the goal.
      out.toGoal.set(g.id, card);
      out.synced.set(o.card, card);
    } else {
      out.toCard.set(o.card, goal);
      out.synced.set(o.card, goal);
    }
  }
  return out;
}

/** Bring a card's copy up to its goal (in a document mutation). */
export function applyCopy(c: OstCard, copy: Partial<GoalCopy>) {
  if ("title" in copy && copy.title !== undefined) c.title = copy.title;
  if ("metric" in copy) {
    if (copy.metric) c.metric = copy.metric;
    else delete c.metric;
  }
  if ("stage" in copy && copy.stage) c.stage = copy.stage;
}

/**
 * What changed on the goal's side since the card and the goal last agreed: the fields undo and
 * redo should keep (an undo takes back the board's own change, never one made elsewhere). Nothing
 * agreed yet: whatever the goal says differently from the card.
 */
export function goalSide(last: GoalCopy | undefined, goal: GoalCopy, card: GoalCopy): Partial<GoalCopy> {
  const from = last ?? card;
  const out: Partial<GoalCopy> = {};
  if (goal.title !== from.title) out.title = goal.title;
  if (stable(goal.metric ?? null) !== stable(from.metric ?? null)) out.metric = goal.metric;
  if (goal.stage !== from.stage) out.stage = goal.stage;
  return out;
}
