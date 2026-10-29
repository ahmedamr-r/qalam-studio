import { create } from "zustand";
import { readOutline, withoutGoal } from "@/goals/outline";
import { initialFlow, resolvedAnswers, type FlowState } from "../ai/questionFlow";
import { emptyKnow, missingQuestions, readKnow, writeKnow, type KnowState } from "./know-state";
import { addShapedGoals, shapeGoals } from "./setup";

/*
 * "I know our goals", run (./know-state.ts is the state): they write their goals down as they say
 * them, Qalam AI reads each line's number, code asks only for what's missing, and the tree they
 * keep is added in their words. Kept for this tab, so a reload comes back to it.
 */

export const useKnow = create<KnowState & { org: string | null }>(() => ({ ...emptyKnow(), org: null }));

const storage = () => (typeof window === "undefined" ? null : window.sessionStorage);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stopped = (e: unknown) => (e as Error).name === "AbortError";

function set(patch: Partial<KnowState>) {
  useKnow.setState(patch);
  const { org, ...k } = useKnow.getState();
  if (org) writeKnow(storage(), org, k);
}

/** This organization's goals as they were left in this tab. */
export function openKnow(org: string) {
  useKnow.setState({ ...(readKnow(storage(), org) ?? emptyKnow()), org });
}

/** Qalam AI reads what they wrote: each line's number, and code asks for the parts that are missing. */
export async function readKnown(text: string) {
  const outline = readOutline(text);
  if (!outline.length) return;
  set({ text, sent: true, error: null });
  try {
    const goals = await shapeGoals(outline, new Map());
    const questions = missingQuestions(goals);
    set({ goals, questions, form: questions.length ? initialFlow(questions) : null, phase: questions.length ? "asking" : "review", answered: null });
  } catch (e) {
    // Stopped or failed: what they wrote goes back in the composer.
    set({ sent: false, error: stopped(e) ? null : message(e) });
  }
}

let saving: ReturnType<typeof setTimeout> | undefined;
/** The answers as they're given (kept, so a reload doesn't lose them). */
export function saveKnownForm(form: FlowState) {
  clearTimeout(saving);
  saving = setTimeout(() => set({ form }), 300);
}

/** They answered: Qalam AI reads the goals again with what they said about each number. */
export async function answerKnown(form: FlowState) {
  clearTimeout(saving);
  const { questions, goals, text } = useKnow.getState();
  const all = resolvedAnswers(questions, form.answers);
  const answers = new Map(
    questions.flatMap((q): [string, string][] => {
      const a = all[q.id];
      return a?.kind === "text" && a.text.trim() ? [[q.id, a.text.trim()]] : [];
    }),
  );
  set({ form, error: null });
  if (!answers.size) return set({ phase: "review", answered: "skipped" });
  try {
    // The goals as they are now: one taken off stays off.
    const kept = new Set(goals.map((g) => g.ref));
    const again = await shapeGoals(readOutline(text), answers);
    set({ goals: again.filter((g) => kept.has(g.ref)), phase: "review", answered: "answered" });
  } catch (e) {
    set({ error: stopped(e) ? null : message(e) });
  }
}

export function skipKnown() {
  clearTimeout(saving);
  set({ phase: "review", answered: "skipped", error: null });
}

/** Leave a goal out: the ones under it move up to the goal it fed. */
export function dropKnown(ref: string) {
  set({ goals: withoutGoal(useKnow.getState().goals, ref) });
}

/** Back to writing: what they wrote goes back in the composer. */
export function editKnown() {
  set({ phase: "write", sent: false, goals: [], questions: [], form: null, answered: null, error: null });
}

/** Add the tree in their words. */
export async function addKnown(): Promise<boolean> {
  const { goals } = useKnow.getState();
  if (!goals.length) return false;
  set({ error: null });
  try {
    await addShapedGoals(goals);
    set({ phase: "added", added: goals.length });
    return true;
  } catch (e) {
    set({ error: `Couldn't add them: ${message(e)}` });
    return false;
  }
}
