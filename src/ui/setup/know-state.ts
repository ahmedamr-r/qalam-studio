import type { ShapedGoal } from "@/goals/outline";
import type { FlowState, Question } from "../ai/questionFlow";

/*
 * "I know our goals" as state (pure): what they wrote, what Qalam AI read from each line, the
 * questions about a number that's missing a part, and the tree they add. Kept for this tab
 * (sessionStorage), so a reload comes back to it; ./know.ts runs it.
 */

export type KnowPhase = "write" | "asking" | "review" | "added";

export interface KnowState {
  phase: KnowPhase;
  /** The goals as they wrote them, one a line, indented under the goal each feeds. */
  text: string;
  /** Sent to Qalam AI: it shows as their message, and the composer is free again. */
  sent: boolean;
  goals: ShapedGoal[];
  questions: Question[];
  form: FlowState | null;
  /** What happened to the questions. */
  answered: "answered" | "skipped" | null;
  /** How many goals were added. */
  added: number;
  error: string | null;
}

export const emptyKnow = (): KnowState => ({ phase: "write", text: "", sent: false, goals: [], questions: [], form: null, answered: null, added: 0, error: null });

const key = (org: string) => `qalam:know:${org}`;
const MAX_QUESTIONS = 8;

/** The state kept for this organization in this tab, if any. */
export function readKnow(storage: Pick<Storage, "getItem"> | null, org: string): KnowState | null {
  try {
    const raw = storage?.getItem(key(org));
    if (!raw) return null;
    const k = JSON.parse(raw) as Partial<KnowState>;
    if (!k || typeof k.text !== "string" || !["write", "asking", "review", "added"].includes(k.phase as string)) return null;
    return { ...emptyKnow(), ...k, error: null };
  } catch {
    return null;
  }
}

export function writeKnow(storage: Pick<Storage, "setItem" | "removeItem"> | null, org: string, k: KnowState) {
  try {
    if (!k.text && k.phase === "write") storage?.removeItem(key(org));
    else storage?.setItem(key(org), JSON.stringify({ ...k, error: null }));
  } catch {
    /* no storage: it lasts for this page */
  }
}

/** One short question for each goal whose number is missing a part, about just that part. */
export function missingQuestions(goals: ShapedGoal[]): Question[] {
  return goals
    .filter((g) => g.missing.some((m) => m !== "when"))
    .slice(0, MAX_QUESTIONS)
    .map((g): Question => {
      const name = g.metric?.name;
      // No number at all: by when is unsaid too.
      const when = g.missing.includes("when") || g.missing.includes("number");
      const title = g.missing.includes("number")
        ? `“${g.title}”: which number shows it moving?`
        : g.missing.includes("today") && g.missing.includes("target")
          ? `“${name}”: where is it today, and where should it get to${when ? " by when" : ""}?`
          : g.missing.includes("today")
            ? `“${name}”: where is it today?`
            : `“${name}”: where should it get to${when ? ", and by when" : ""}?`;
      return { kind: "text", id: g.ref, title, why: "Qalam AI takes a number only as you write it.", placeholder: "Weekly reorders: 1.2 now, 1.5 by March", maxLength: 600, optional: true };
    });
}
