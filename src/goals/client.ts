import { create } from "zustand";
import type { Decision } from "@/decisions/model";
import { orgFetch, orgJson } from "@/org/client";
import type { Me } from "@/org/you";
import type { NewGoal } from "./shape";
import { emptyGoals, type Goal, type GoalPatch, type GoalsAt, type GoalTree } from "./types";

/*
 * The organization's goals in this window (goals.md through /api/org/:org/goals), loaded when it
 * opens and kept current as they change elsewhere. A change made here comes back with the tree as
 * it is after it, so this window never waits for its own change to be announced.
 */

export interface GoalsNow extends GoalTree {
  version: string | null;
  /** The goals that are this computer's person's. */
  mine: string[];
  /** This computer's person's position here (null: not asked yet). */
  me: Me | null;
  loaded: boolean;
}

export const useGoals = create<GoalsNow>(() => ({ ...emptyGoals(), version: null, mine: [], me: null, loaded: false }));

const take = (at: GoalsAt) => useGoals.setState({ goals: at.goals, north: at.north, notes: at.notes, version: at.version, loaded: true });

export async function loadGoals() {
  const at = await orgJson<GoalsAt & { mine: string[]; me?: Me | null }>("/goals");
  take(at);
  useGoals.setState({ mine: at.mine ?? [], me: at.me ?? null });
}

export const goalsNow = (): GoalTree => {
  const { goals, north, notes } = useGoals.getState();
  return { goals, north, ...(notes ? { notes } : {}) };
};

export async function createGoal(g: NewGoal): Promise<Goal> {
  const r = await orgJson<{ goal: Goal; goals: GoalsAt }>("/goals", { method: "POST", json: g });
  take(r.goals);
  return r.goal;
}

/** Change a goal. What it decided comes back (a big one asks why where it was made). */
export async function changeGoal(id: string, patch: GoalPatch, o: { by?: Decision["by"]; keepalive?: boolean } = {}): Promise<{ goal: Goal; decisions: Decision[] }> {
  const r = await orgJson<{ goal: Goal; goals: GoalsAt; decisions: Decision[] }>(`/goals/${encodeURIComponent(id)}`, { method: "PATCH", json: { patch, by: o.by ?? "you" }, keepalive: o.keepalive });
  take(r.goals);
  return { goal: r.goal, decisions: r.decisions };
}

export async function removeGoal(id: string): Promise<void> {
  const r = await orgJson<{ goals: GoalsAt }>(`/goals/${encodeURIComponent(id)}`, { method: "DELETE" });
  take(r.goals);
}

export async function setNorth(id: string | null): Promise<void> {
  const r = await orgJson<{ goals: GoalsAt }>("/goals-north", { method: "PUT", json: { id } });
  take(r.goals);
}

export async function setMine(ids: string[]): Promise<void> {
  useGoals.setState({ mine: ids });
  await orgFetch("/goals-mine", { method: "PUT", json: { ids } });
}

/** Their position here, kept on this computer. */
export async function setMe(me: Me): Promise<void> {
  const r = await orgJson<{ me: Me | null }>("/me", { method: "PUT", json: me });
  useGoals.setState({ me: r.me });
}

/** The words of a place's goals (the organization's: null), for what setup reads. */
export const goalWords = (product: string | null) => useGoals.getState().goals.filter((g) => g.product === product).map((g) => g.title);
