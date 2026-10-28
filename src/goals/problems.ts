import type { RankedNeed } from "@/hub/needs";
import { goalAndUnder, type Bearing, type Bears } from "./bearings";
import { goalById } from "./tree";
import type { GoalTree } from "./types";

/*
 * The problems behind a goal (pure): the need pages linked to it or to a goal under it, the ones
 * that bear directly on its number first, then by the customer evidence behind them (sources, then
 * quotes, then newest), as every need is ranked. No score: each mark is something to open.
 */

export interface GoalProblem extends RankedNeed {
  bears: Bears;
  /** How solving it moves the number, in one line (Qalam AI's, checked, or a person's). */
  how: string;
  by: Bearing["by"];
  /** The goal under this one it bears on (none: this goal itself). */
  via: string | null;
  /** On a board that works on this goal, or on a goal under it. */
  onBoard: boolean;
}

export function rankForGoal(goalId: string, o: { tree: GoalTree; links: Bearing[]; needs: RankedNeed[] }): GoalProblem[] {
  const scope = goalAndUnder(o.tree, goalId);
  const boards = new Set(scope.flatMap((id) => goalById(o.tree, id)?.on?.board ?? []));
  // A problem linked to this goal and to a goal under it shows once: as this goal's, the direct link first.
  const rank = (b: Bearing) => (b.goal === goalId ? 0 : 2) + (b.bears === "direct" ? 0 : 1);
  const best = new Map<string, Bearing>();
  for (const b of o.links) {
    if (!scope.includes(b.goal)) continue;
    const cur = best.get(b.need);
    if (!cur || rank(b) < rank(cur)) best.set(b.need, b);
  }
  const needs = new Map(o.needs.map((n) => [n.topic, n]));
  return [...best.values()]
    .flatMap((b): GoalProblem[] => {
      const n = needs.get(b.need);
      return n ? [{ ...n, bears: b.bears, how: b.how, by: b.by, via: b.goal === goalId ? null : b.goal, onBoard: n.boards.some((x) => boards.has(x.board)) }] : [];
    })
    .sort((a, b) => (a.bears === b.bears ? 0 : a.bears === "direct" ? -1 : 1) || b.sources - a.sources || b.quotes - a.quotes || b.newest - a.newest || a.title.localeCompare(b.title));
}

/** The goals a problem bears on, the direct ones first. */
export const goalsOfNeed = (need: string, links: Bearing[]) => links.filter((b) => b.need === need).sort((a, b) => (a.bears === b.bears ? 0 : a.bears === "direct" ? -1 : 1));
