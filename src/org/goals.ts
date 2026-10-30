import type { ContextFields, OrgGoal, Product } from "./context-md";

/**
 * The goals the organization and its products state (about.md, products/*.md), and which board
 * outcomes serve each (pure). A board's outcome names the goal it serves (`OstCard.serves`): a
 * goal no outcome serves is work nobody's doing, and an outcome that serves no stated goal is work
 * nobody asked for, or a goal nobody wrote down.
 */

export interface StatedGoal {
  goal: OrgGoal;
  /** Whose goal: a product's, or the whole organization's (null). */
  product: string | null;
  /** The first goal of its list leads. */
  lead: boolean;
}

/** What an outcome serves: a goal by its id, of a product or of the organization (null). */
export interface Serves {
  goal: string;
  product: string | null;
}

/** Every stated goal: the organization's first, then each product's. */
export function statedGoals(about: Pick<ContextFields, "goals">, products: Pick<Product, "id" | "goals">[]): StatedGoal[] {
  return [...about.goals.map((goal, i) => ({ goal, product: null, lead: i === 0 })), ...products.flatMap((p) => p.goals.map((goal, i) => ({ goal, product: p.id, lead: i === 0 })))];
}

/** The stated goal an outcome serves (undefined: none, or one no longer stated). */
export const goalServed = (serves: Serves | undefined, stated: StatedGoal[]) => (serves ? stated.find((g) => g.goal.id === serves.goal && g.product === serves.product) : undefined);

/** The goals a board's outcome can serve: its product's first, then the organization's. */
export const goalsFor = (product: string | null | undefined, stated: StatedGoal[]) => [...stated.filter((g) => product && g.product === product), ...stated.filter((g) => g.product === null)];
