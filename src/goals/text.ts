import { metricLine } from "./goals-md";
import { chainOf, childrenOf, goalById, rootsOf } from "./tree";
import type { Goal, GoalTree } from "./types";

/*
 * The goals as Qalam AI is told about them (pure): each under the goal it feeds, with its product
 * and number. For a board, its goals and every goal above them up to the North Star, and the goals
 * right under them; for a product, the product's goals the same way; else the whole tree.
 */

export interface GoalsTextOptions {
  /** The product in view: its goals, the goals they feed, and the North Star. */
  product?: string | null;
  /** A board's goals: theirs first, marked. */
  goals?: string[];
  productName?: (id: string) => string | undefined;
  /** Headed this way (default "Goals"). */
  label?: string;
}

export function goalsText(t: GoalTree, o: GoalsTextOptions = {}): string {
  if (!t.goals.length) return "";
  const focus = new Set(o.goals ?? []);
  let keep: Set<string> | null = null;
  if (focus.size || o.product) {
    keep = new Set<string>();
    const seeds = t.goals.filter((g) => focus.has(g.id) || (!focus.size && o.product && g.product === o.product));
    for (const s of seeds) {
      for (const g of chainOf(t, s.id)) keep.add(g.id);
      for (const c of childrenOf(t, s.id)) keep.add(c.id);
    }
    if (t.north) keep.add(t.north);
    if (!seeds.length && !t.north) return "";
  }
  const line = (g: Goal, depth: number): string[] => {
    if (keep && !keep.has(g.id)) return childrenOf(t, g.id).flatMap((c) => line(c, depth));
    const bits = [
      g.id === t.north ? `North Star: ${g.title}` : g.title,
      g.product ? `(${o.productName?.(g.product) ?? "a product"})` : null,
      g.metric ? `· ${g.metric.name ? `${g.metric.name}: ` : ""}${metricLine(g.metric)}` : null,
      g.status !== "active" ? `· ${g.status}` : null,
      focus.has(g.id) ? "· this board's goal" : null,
    ].filter(Boolean);
    return [`${"  ".repeat(depth)}- ${bits.join(" ")}`, ...childrenOf(t, g.id).flatMap((c) => line(c, depth + 1))];
  };
  const body = rootsOf(t).flatMap((g) => line(g, 0));
  if (!body.length) return "";
  const unplaced = rootsOf(t).some((g) => g.id !== t.north && (!keep || keep.has(g.id)));
  return `${o.label ?? "Goals"} (each under the goal it feeds${unplaced ? "; a top-level goal other than the North Star doesn't feed one yet" : ""}):\n${body.join("\n")}`;
}

/** One goal's words and number, for a line in a prompt or a list. */
export function goalLine(t: GoalTree, id: string): string {
  const g = goalById(t, id);
  if (!g) return "";
  return g.metric ? `${g.title} (${metricLine(g.metric)})` : g.title;
}
