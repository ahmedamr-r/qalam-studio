import { callAI } from "@/ai/client";
import type { Breakdown, GoalWork } from "@/goals/breakdown";
import type { Goal, GoalLever } from "@/goals/types";
import { orgJson, orgPath } from "./client";
import type { DraftWords } from "./solutions";

/*
 * A goal's work, from the window (server/org/goals.ts, server/org/outside.ts): the problems behind
 * it linked, the goals under it proposed and each one decided, what others aim for looked up, and
 * the goal's work file as it's kept. Its page and the canvas's next steps both ask through here.
 */

/** What linking problems to a goal came to. */
export interface Linked {
  /** Links made or changed. */
  added: number;
  /** Links Qalam AI stands behind now (new or kept). */
  kept: number;
  /** Its earlier links it took back. */
  removed: number;
  /** What kind of problem would move the goal that no page holds yet. */
  none: string;
}

const at = (goal: string, rest = "") => `/goals/${encodeURIComponent(goal)}${rest}`;

/** A long piece of work in the core, with what it's doing as it goes. */
async function run<T>(path: string, body: unknown, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<T> {
  const { data } = await callAI<T>(await orgPath(path), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

/** Find problems: the problem pages that bear on the goal and the goals under it, linked. */
export const findProblems = (goal: string, onActivity?: (label: string) => void, signal?: AbortSignal) => run<Linked>(at(goal, "/problems"), {}, onActivity, signal);

/** Break it down: the goals under it Qalam AI proposes (with the person's answers, when they were asked), kept on the goal until each is decided. */
export const breakDown = (goal: string, o: { levers: GoalLever[] } & DraftWords, onActivity?: (label: string) => void, signal?: AbortSignal) => run<{ parts: number; none: string; breakdown: Breakdown }>(at(goal, "/breakdown"), o, onActivity, signal);

/** A proposed goal under it taken (it goes in goals.md under the goal) or left. */
export const decidePart = (goal: string, part: string, accept: boolean) => orgJson<{ goal: Goal | null }>(at(goal, `/breakdown/${encodeURIComponent(part)}`), { method: "POST", json: { accept } });

/** What others aim for, looked up on the web and checked on each page. */
export const lookOutside = (goal: string, onActivity?: (label: string) => void, signal?: AbortSignal) => run<{ kept: number; read: number; error?: string }>(at(goal, "/outside"), {}, onActivity, signal);

/** The goal's work file as it's kept: what others report, the goals proposed under it, its funnel. */
export const goalWork = (goal: string) => orgJson<GoalWork>(at(goal, "/work"));
