import type { OstMetric, OutcomeStage } from "@/discovery/types";
import { sameTopic, sameWords } from "@/hub/topics";
import { factHash } from "@/knowledge/refs";
import { GOALS_INTRO } from "./goals-md";
import { ordered } from "./tree";
import type { Goal, GoalTree } from "./types";

/*
 * The goal tree from what an organization said about its goals before goals.md (pure): the
 * About's goals, each product's, and the outcome cards on its boards. Two computers moving the
 * same folder get the same file: ids and times come from what's there, never from the clock.
 */

/** The goal an outcome card works on, before any board was opened since goals.md. */
export const outcomeGoalId = (board: string, card: string) => `g-${board}-${card}`.slice(0, 64);
/** A goal written as words only (the About's, a product's). */
export const textGoalId = (text: string) => `g-${factHash(sameWords(text))}`;

export interface BoardOutcome {
  card: string;
  title: string;
  metric?: OstMetric;
  stage: OutcomeStage;
  /** The outcome card it sits under on its board (a sub-outcome). */
  parent: string | null;
  /** The pieces its evidence is (hub:quote:…). */
  pieces: string[];
}

export interface BoardOutcomes {
  board: string;
  product: string | null;
  createdAt: number;
  /** In the board's own order. */
  outcomes: BoardOutcome[];
}

export interface MigrationInput {
  /** The About's goals, as written: the first is the North Star. */
  about: string[];
  products: { id: string; goals: string[] }[];
  boards: BoardOutcomes[];
  /** When the organization was made: the time words written before goals.md are said to be from. */
  at: number;
}

export function migrateGoals(x: MigrationInput): GoalTree {
  const goals: Goal[] = [];
  const ids = new Set<string>();
  const text = (line: string, product: string | null): Goal | null => {
    const title = line.replace(/\s+/g, " ").trim();
    if (!title) return null;
    const id = textGoalId(product ? `${product}:${title}` : title);
    if (ids.has(id)) return null;
    ids.add(id);
    const g: Goal = { id, title, parent: null, product, status: "active", cites: [], by: "person", at: x.at };
    goals.push(g);
    return g;
  };
  const about = x.about.map((l) => text(l, null)).filter((g): g is Goal => !!g);
  for (const p of [...x.products].sort((a, b) => a.id.localeCompare(b.id))) for (const l of p.goals) text(l, p.id);
  const north = about[0]?.id ?? null;

  // Each outcome card becomes its goal: the goal already written in the same words when there is
  // one (the product's own, or the organization's), or a goal of its own.
  const linked = new Set<string>();
  for (const b of [...x.boards].sort((a, c) => a.createdAt - c.createdAt || a.board.localeCompare(c.board))) {
    const byCard = new Map<string, string>();
    for (const o of b.outcomes) {
      const words = o.title.replace(/\s+/g, " ").trim();
      if (!words) continue;
      const candidates = goals.filter((g) => !g.on && !linked.has(g.id) && (g.product === b.product || g.product === null));
      const twin = candidates.find((g) => sameWords(g.title) === sameWords(words)) ?? candidates.find((g) => sameTopic(g.title, words));
      const parent = o.parent ? (byCard.get(o.parent) ?? null) : null;
      if (twin) {
        linked.add(twin.id);
        Object.assign(twin, {
          title: words,
          product: twin.product ?? b.product,
          status: o.stage,
          on: { board: b.board, card: o.card },
          ...(o.metric ? { metric: o.metric } : {}),
          cites: [...new Set([...twin.cites, ...o.pieces])],
          ...(parent && twin.id !== north ? { parent } : {}),
        });
        byCard.set(o.card, twin.id);
        continue;
      }
      const id = outcomeGoalId(b.board, o.card);
      if (ids.has(id)) continue;
      ids.add(id);
      goals.push({ id, title: words, parent, product: b.product, ...(o.metric ? { metric: o.metric } : {}), status: o.stage, on: { board: b.board, card: o.card }, cites: [...new Set(o.pieces)], by: "person", at: b.createdAt });
      byCard.set(o.card, id);
    }
  }
  return ordered({ goals, north, notes: GOALS_INTRO });
}
