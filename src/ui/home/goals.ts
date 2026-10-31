import type { GoalsNow } from "@/goals/client";
import { childrenOf, rootsOf } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import { inSpace, type Space } from "../frame/spaces";

const SHOWN = 6;

/**
 * The goals a space's panel groups Needs a look under: this person's in it, else the North Star
 * and the goals right under it; in a product's space, the North Star and the product's goals that
 * feed no other of its own.
 */
export function homeGoals(t: GoalsNow, space: Space = null): { goals: Goal[]; mine: boolean } {
  const mine = t.goals.filter((g) => t.mine.includes(g.id) && (inSpace(g.product, space) || g.id === t.north));
  if (mine.length) return { goals: mine.slice(0, SHOWN), mine: true };
  const north = t.goals.find((g) => g.id === t.north);
  const own = new Set(t.goals.filter((g) => space && g.product === space).map((g) => g.id));
  const near = space ? t.goals.filter((g) => own.has(g.id) && (!g.parent || !own.has(g.parent))) : north ? childrenOf(t, north.id) : rootsOf(t);
  return { goals: [...(north ? [north] : []), ...near.filter((g) => g !== north)].slice(0, SHOWN), mine: false };
}
