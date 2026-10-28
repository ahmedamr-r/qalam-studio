import type { Goal, GoalPatch, GoalTree } from "./types";

/*
 * Reading and changing the goal tree (pure). Every change returns a new tree in the file's order:
 * the North Star and everything under it first, then the other goals, each followed by the goals
 * under it. Nothing here writes; the store does.
 */

export const goalById = (t: GoalTree, id: string | null | undefined): Goal | undefined => (id ? t.goals.find((g) => g.id === id) : undefined);

/** The goals right under a goal (null: the top-level ones), in the file's order. */
export const childrenOf = (t: GoalTree, id: string | null): Goal[] => t.goals.filter((g) => g.parent === id);

/** The top-level goals: the North Star first, then the goals not under it. */
export function rootsOf(t: GoalTree): Goal[] {
  const roots = childrenOf(t, null);
  const north = roots.find((g) => g.id === t.north);
  return north ? [north, ...roots.filter((g) => g !== north)] : roots;
}

/** A goal and the goals above it, up to its root (a cycle, which the file can't hold, stops it). */
export function chainOf(t: GoalTree, id: string): Goal[] {
  const out: Goal[] = [];
  const seen = new Set<string>();
  for (let g = goalById(t, id); g && !seen.has(g.id); g = goalById(t, g.parent)) {
    seen.add(g.id);
    out.push(g);
  }
  return out;
}

/** Everything under a goal, at any depth. */
export function underOf(t: GoalTree, id: string): Goal[] {
  const out: Goal[] = [];
  const walk = (p: string) => {
    for (const g of childrenOf(t, p)) {
      if (out.includes(g)) continue;
      out.push(g);
      walk(g.id);
    }
  };
  walk(id);
  return out;
}

/** Whether the goal sits in the North Star's tree. */
export const underNorth = (t: GoalTree, id: string) => !!t.north && chainOf(t, id).some((g) => g.id === t.north);

/** The goal a board's outcome card works on. */
export const goalOfCard = (t: GoalTree, board: string, card: string) => t.goals.find((g) => g.on?.board === board && g.on.card === card);

/** A board's goals, by the outcome card each is on. */
export function goalsOfBoard(t: GoalTree, board: string): Map<string, Goal> {
  const out = new Map<string, Goal>();
  for (const g of t.goals) if (g.on?.board === board) out.set(g.on.card, g);
  return out;
}

/**
 * The tree in the file's order: each goal followed by the goals under it, the North Star's tree
 * first. A goal whose parent is gone moves to the top level; one caught in a cycle too.
 */
export function ordered(t: GoalTree): GoalTree {
  const ids = new Set(t.goals.map((g) => g.id));
  const fixed = t.goals.map((g) => (g.parent && (!ids.has(g.parent) || g.parent === g.id) ? { ...g, parent: null } : g));
  // Break cycles: walking up from each goal, a goal seen twice loses its parent.
  const byId = new Map(fixed.map((g) => [g.id, g]));
  for (const g of fixed) {
    const seen = new Set<string>([g.id]);
    for (let p = byId.get(g.id)?.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p)) {
        byId.set(p, { ...byId.get(p)!, parent: null });
        break;
      }
      seen.add(p);
    }
  }
  const all = fixed.map((g) => byId.get(g.id)!);
  const north = t.north && byId.has(t.north) ? t.north : null;
  const kids = new Map<string | null, Goal[]>();
  for (const g of all) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g]);
  const out: Goal[] = [];
  const walk = (g: Goal) => {
    out.push(g);
    for (const k of kids.get(g.id) ?? []) walk(k);
  };
  const roots = kids.get(null) ?? [];
  const northGoal = roots.find((g) => g.id === north);
  if (northGoal) walk(northGoal);
  for (const g of roots) if (g !== northGoal) walk(g);
  // A North Star that isn't at the top level is just a goal.
  return { ...t, goals: out, north: northGoal ? north : null };
}

/** Add a goal: under its parent, after the goals already there. */
export function addGoal(t: GoalTree, g: Goal): GoalTree {
  return ordered({ ...t, goals: [...t.goals, g] });
}

/** Change one goal. A parent that would put it under itself is refused (the tree stays as it was). */
export function patchGoal(t: GoalTree, id: string, patch: GoalPatch): GoalTree {
  const g = goalById(t, id);
  if (!g) return t;
  if (patch.parent && (patch.parent === id || underOf(t, id).some((x) => x.id === patch.parent))) return t;
  const next: Goal = { ...g };
  for (const [k, v] of Object.entries(patch) as [keyof GoalPatch, unknown][]) {
    if (v === undefined) continue;
    if (v === null && (k === "on" || k === "metric" || k === "lever" || k === "feeds")) delete (next as Partial<Goal>)[k];
    else (next as unknown as Record<string, unknown>)[k] = v;
  }
  return ordered({ ...t, goals: t.goals.map((x) => (x.id === id ? next : x)) });
}

/** Take a goal out of the tree. The goals under it move up to its parent. */
export function removeGoal(t: GoalTree, id: string): GoalTree {
  const g = goalById(t, id);
  if (!g) return t;
  return ordered({
    ...t,
    north: t.north === id ? null : t.north,
    goals: t.goals.filter((x) => x.id !== id).map((x) => (x.parent === id ? { ...x, parent: g.parent } : x)),
  });
}

/** Make a top-level goal the North Star (the one there before becomes one of the other goals). */
export function setNorth(t: GoalTree, id: string | null): GoalTree {
  if (id && goalById(t, id)?.parent) return t;
  return ordered({ ...t, north: id });
}
