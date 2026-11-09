/**
 * A questionnaire in the AI chat, as data: questions, answers and where the designer is. Pure, so
 * a turn can keep its state in the chat (it survives a reload) and the rules are unit-tested.
 *
 * The caller rebuilds the questions from the answers on every render, so a question that depends
 * on an earlier answer (dependsOn) simply appears or disappears; only answers are stored.
 */

import { saysDontKnow } from "@/asking/dontknow";
import type { ToolAsk } from "@/connectors/suggest";
import type { KnownAnswer } from "@/memory/known";

export interface QOption {
  value: string;
  label: string;
  description?: string;
  /** A short fact shown beside the label, e.g. "×4". */
  badge?: string;
}

interface QBase {
  id: string;
  title: string;
  /** Why it's asked, or what changes with the answer. */
  why?: string;
  /** Can be skipped. */
  optional?: boolean;
  /** Can be answered "I don't know": a question about their own work, where not knowing is an answer of its own. */
  dontKnow?: boolean;
  /** Single choice: the option Qalam AI would pick (pre-selected). */
  recommended?: string;
  /** Single choice: the option Qalam AI would pick, marked and not picked: what they haven't chosen isn't what they said. */
  suggested?: string;
  /** "ai" = Qalam AI wrote the question from what it saw. */
  source?: "ai" | "studio";
  /** Questions whose answers this one is built from: changing them clears this answer. */
  dependsOn?: string[];
  /** A tool that could answer it better than memory: the card offers to connect it and fetch from it. */
  tool?: ToolAsk;
  /** What was said before to a question like it (src/memory/known.ts): shown under it, with Use it. */
  known?: KnownAnswer[];
  /** An example of a useful answer, shown under it for someone new to this; never filled in. */
  example?: string;
  /** A word the question uses, said plainly, the first time it's used. */
  explain?: { term: string; plain: string };
}

export interface SingleQuestion extends QBase {
  kind: "single";
  options: QOption[];
  /** Offer a free-text answer too. */
  other?: { label: string; placeholder?: string };
  default?: string;
}

export interface MultiGroup {
  id: string;
  label: string;
  hint?: string;
  options: QOption[];
  /** Most picks in this group (custom names included). */
  max?: number;
  /** Let the designer add names of their own to this group (one group per question). */
  custom?: { placeholder: string };
}

export interface MultiQuestion extends Omit<QBase, "suggested"> {
  kind: "multi";
  groups: MultiGroup[];
  /** The options Qalam AI would pick, marked and not picked. */
  suggested?: string[];
  /** Fewest picks overall (custom names included). */
  min?: number;
  default?: { values: string[]; custom?: string[] };
}

export interface TextQuestion extends QBase {
  kind: "text";
  placeholder?: string;
  maxLength?: number;
  default?: string;
}

/** Asking to see a screen or a step: screenshots dropped, pasted or picked under it (each kept as an asset as it lands), with words if they like. */
export interface ShotsQuestion extends QBase {
  kind: "shots";
  placeholder?: string;
  maxLength?: number;
  /** Most screenshots one answer takes. */
  max?: number;
  default?: string;
}

export type Question = SingleQuestion | MultiQuestion | TextQuestion | ShotsQuestion;

/** Most screenshots one answer takes: more can go in another answer. */
export const SHOTS_MAX = 6;

/** A screenshot given as an answer: the asset it's kept as ("asset:<hash>") and its name (the file's, or "Screenshot 2"). */
export interface AnswerShot {
  asset: string;
  title: string;
}

/** `pick`: Qalam AI's recommendation, taken with one press for the whole round, and not changed since. */
export type Answer =
  | { kind: "single"; value: string; other?: string; pick?: true }
  | { kind: "multi"; values: string[]; custom: string[]; pick?: true }
  | { kind: "text"; text: string }
  /** Screenshots in the order given, and what they typed beside them: only the typed words are theirs to quote. */
  | { kind: "shots"; shots: AnswerShot[]; text: string }
  /** Left, or (`unknown`) "I don't know": nothing they said, so nothing to quote. */
  | { kind: "skipped"; unknown?: true };
export type Answers = Record<string, Answer>;

/** The value of a single-choice answer typed as "Other…". */
export const OTHER = "__other";
export const REVIEW = "review";

export interface FlowState {
  /** A question id, or "review". */
  current: string;
  answers: Answers;
  /** Questions the designer has been shown, in order. */
  visited: string[];
  /** Came from the review step through Edit: Next returns there. */
  editing: boolean;
  submitted: boolean;
}

export type FlowAction =
  | { type: "answer"; id: string; answer: Answer }
  | { type: "next" }
  | { type: "back" }
  | { type: "skip" }
  /** "I don't know": on, like Skip, but it says so. */
  | { type: "unknown" }
  | { type: "edit"; id: string }
  | { type: "submit" }
  | { type: "reopen" };

export interface FlowResult {
  state: FlowState;
  /** Why the step can't move on. */
  error?: string;
  /** All answered: hand the answers over. */
  done?: boolean;
}

export function initialFlow(qs: Question[], review = true): FlowState {
  const first = qs[0]?.id ?? (review ? REVIEW : "");
  return { current: first, answers: {}, visited: first && first !== REVIEW ? [first] : [], editing: false, submitted: false };
}

/** The stored answer, else the question's default, else its recommendation, else empty. */
export function answerOf(q: Question, answers: Answers): Answer {
  const a = answers[q.id];
  if (a && (a.kind === q.kind || a.kind === "skipped")) return a;
  switch (q.kind) {
    case "single":
      return { kind: "single", value: q.default ?? q.recommended ?? "" };
    case "multi":
      return { kind: "multi", values: [...(q.default?.values ?? [])], custom: [...(q.default?.custom ?? [])] };
    case "text":
      return { kind: "text", text: q.default ?? "" };
    case "shots":
      return { kind: "shots", shots: [], text: q.default ?? "" };
  }
}

const groupCount = (g: MultiGroup, a: { values: string[]; custom: string[] }) => a.values.filter((v) => g.options.some((o) => o.value === v)).length + (g.custom ? a.custom.length : 0);

export function validate(q: Question, a: Answer): string | null {
  if (a.kind === "skipped") return q.optional || (a.unknown && q.dontKnow) ? null : "Answer this one to go on.";
  if (a.kind === "single" && q.kind === "single") {
    if (!a.value) return q.optional ? null : "Pick an answer.";
    if (a.value === OTHER) return a.other?.trim() ? null : "Type your answer.";
    return q.options.some((o) => o.value === a.value) ? null : "Pick an answer.";
  }
  if (a.kind === "multi" && q.kind === "multi") {
    const total = a.values.length + a.custom.length;
    if (q.min && total < q.min) return q.min === 1 ? "Pick at least one." : `Pick at least ${q.min}.`;
    for (const g of q.groups) if (g.max !== undefined && groupCount(g, a) > g.max) return `Up to ${g.max} in “${g.label}”.`;
    return null;
  }
  if (a.kind === "text" && q.kind === "text") return a.text.trim() || q.optional ? null : "Type an answer.";
  if (a.kind === "shots" && q.kind === "shots") {
    if (q.max !== undefined && a.shots.length > q.max) return `Up to ${q.max} screenshots in one answer.`;
    return a.shots.length || a.text.trim() || q.optional ? null : "Add a screenshot, or say it in words.";
  }
  return "Answer this one to go on.";
}

/** The current question if it's still asked; else the nearest earlier one the designer saw. */
export function currentOf(s: FlowState, qs: Question[]): string {
  if (s.current === REVIEW || qs.some((q) => q.id === s.current)) return s.current;
  for (let i = s.visited.length - 1; i >= 0; i--) if (qs.some((q) => q.id === s.visited[i])) return s.visited[i];
  return qs[0]?.id ?? REVIEW;
}

/** 1-based step and the number of steps (the review counts as one). */
export function position(s: FlowState, qs: Question[], review = true): { index: number; total: number } {
  const cur = currentOf(s, qs);
  const total = qs.length + (review ? 1 : 0);
  return { index: cur === REVIEW ? total : qs.findIndex((q) => q.id === cur) + 1, total };
}

const same = (a: Answer, b: Answer) => JSON.stringify(a) === JSON.stringify(b);

/** Answers of questions that depend on `id`, dropped (and their dependents, in turn). */
function clearDependents(answers: Answers, visited: string[], id: string, qs: Question[]): { answers: Answers; visited: string[] } {
  const drop = new Set<string>();
  const walk = (from: string) => {
    for (const q of qs) if (q.dependsOn?.includes(from) && !drop.has(q.id)) (drop.add(q.id), walk(q.id));
  };
  walk(id);
  if (!drop.size) return { answers, visited };
  return { answers: Object.fromEntries(Object.entries(answers).filter(([k]) => !drop.has(k))), visited: visited.filter((v) => !drop.has(v)) };
}

function setAnswer(s: FlowState, q: Question, a: Answer, qs: Question[]): FlowState {
  const before = answerOf(q, s.answers);
  const answers = { ...s.answers, [q.id]: a };
  if (same(before, a)) return { ...s, answers };
  return { ...s, ...clearDependents(answers, s.visited, q.id, qs) };
}

/** Where Next goes from `cur`. */
function after(s: FlowState, cur: string, qs: Question[], review: boolean): { current: string; editing: boolean } | "done" {
  const i = qs.findIndex((q) => q.id === cur);
  if (s.editing) {
    // From the review: first a question that just appeared (never seen), else back to the review.
    const fresh = qs.slice(i + 1).find((q) => !s.visited.includes(q.id));
    if (fresh) return { current: fresh.id, editing: true };
    return review ? { current: REVIEW, editing: false } : "done";
  }
  const next = qs[i + 1];
  if (next) return { current: next.id, editing: false };
  return review ? { current: REVIEW, editing: false } : "done";
}

function move(s: FlowState, cur: string, qs: Question[], review: boolean): FlowResult {
  const to = after(s, cur, qs, review);
  if (to === "done") return submit(s, qs);
  const visited = to.current === REVIEW || s.visited.includes(to.current) ? s.visited : [...s.visited, to.current];
  return { state: { ...s, current: to.current, editing: to.editing, visited } };
}

function submit(s: FlowState, qs: Question[]): FlowResult {
  for (const q of qs) {
    const err = validate(q, answerOf(q, s.answers));
    if (err) return { state: { ...s, current: q.id, editing: false, visited: s.visited.includes(q.id) ? s.visited : [...s.visited, q.id] }, error: err };
  }
  return { state: { ...s, answers: resolvedAnswers(qs, s.answers), current: REVIEW, editing: false, submitted: true }, done: true };
}

export function reduceFlow(s: FlowState, action: FlowAction, qs: Question[], review = true): FlowResult {
  if (s.submitted && action.type !== "reopen") return { state: s };
  const cur = currentOf(s, qs);
  const q = qs.find((x) => x.id === cur);
  switch (action.type) {
    case "answer": {
      const target = qs.find((x) => x.id === action.id);
      return { state: target ? setAnswer(s, target, action.answer, qs) : s };
    }
    case "next": {
      if (!q) return cur === REVIEW ? submit(s, qs) : { state: s };
      const a = answerOf(q, s.answers);
      const err = validate(q, a);
      if (err) return { state: { ...s, current: cur }, error: err };
      // What was shown is what was answered: keep the default or recommendation as the answer.
      return move({ ...s, answers: { ...s.answers, [q.id]: a } }, cur, qs, review);
    }
    case "skip": {
      if (!q?.optional) return { state: s };
      return move(setAnswer(s, q, { kind: "skipped" }, qs), cur, qs, review);
    }
    case "unknown": {
      if (!q?.dontKnow) return { state: s };
      return move(setAnswer(s, q, { kind: "skipped", unknown: true }, qs), cur, qs, review);
    }
    case "back": {
      const i = cur === REVIEW ? qs.length : qs.findIndex((x) => x.id === cur);
      const prev = qs[i - 1];
      return { state: prev ? { ...s, current: prev.id, editing: false } : { ...s, current: cur } };
    }
    case "edit":
      return qs.some((x) => x.id === action.id) ? { state: { ...s, current: action.id, editing: review } } : { state: s };
    case "submit":
      return submit(s, qs);
    case "reopen":
      return { state: { ...s, submitted: false, editing: false, current: review ? REVIEW : (qs[qs.length - 1]?.id ?? REVIEW) } };
  }
}

/** Every question's answer, defaults filled in; questions no longer asked are left out. */
export function resolvedAnswers(qs: Question[], answers: Answers): Answers {
  return Object.fromEntries(qs.map((q) => [q.id, answerOf(q, answers)]));
}

/** The option key `n` (1–9) picks; the one after the last is "Other…". */
export function optionAt(q: Question, n: number): string | null {
  if (q.kind !== "single") return null;
  if (n >= 1 && n <= q.options.length) return q.options[n - 1].value;
  if (q.other && n === q.options.length + 1) return OTHER;
  return null;
}

/** How an answer was given: their own pick or words, Qalam AI's pick they agreed to with one press, "I don't know" (pressed, typed or picked), or left unanswered. */
export type AnswerHow = "own" | "pick" | "left" | "unknown";

/**
 * An answer as the model reads it and as it's kept: every label it picked (never a description), nothing
 * cut, what they typed apart from what they picked, and how it was given. A skipped, untouched or empty
 * answer is left. Words they typed make it theirs even beside a pick. An answer that says they don't
 * know (the control, or words or a choice saying it, `saysDontKnow`) is that: its words are kept to
 * read, never as words of theirs a card may quote.
 */
export function answerWords(q: Question, a: Answer | undefined): { text: string; typed: string; how: AnswerHow; shots?: AnswerShot[] } {
  const left = { text: "", typed: "", how: "left" as const };
  const unknown = (text: string) => ({ text, typed: "", how: "unknown" as const });
  if (!a) return left;
  if (a.kind === "skipped") return a.unknown ? unknown("") : left;
  if (a.kind === "text") {
    const t = a.text.trim();
    return !t ? left : saysDontKnow(t) ? unknown(t) : { text: t, typed: t, how: "own" };
  }
  // Screenshots are what they showed, apart from their words: what's printed on a screen is never words of theirs.
  if (a.kind === "shots") {
    const t = a.text.trim();
    if (!a.shots.length) return !t ? left : saysDontKnow(t) ? unknown(t) : { text: t, typed: t, how: "own" };
    return { text: t, typed: t, how: "own", shots: a.shots.map((s) => ({ asset: s.asset, title: s.title })) };
  }
  if (a.kind === "single" && q.kind === "single") {
    if (a.value === OTHER) {
      const t = a.other?.trim() ?? "";
      return !t ? left : saysDontKnow(t) ? unknown(t) : { text: t, typed: t, how: "own" };
    }
    const label = q.options.find((o) => o.value === a.value)?.label ?? "";
    if (!label) return left;
    // Qalam AI's pick stays its pick, whatever it says.
    return !a.pick && saysDontKnow(label) ? unknown(label) : { text: label, typed: "", how: a.pick ? "pick" : "own" };
  }
  if (a.kind === "multi" && q.kind === "multi") {
    const labels = q.groups.flatMap((g) => g.options.filter((o) => a.values.includes(o.value)).map((o) => o.label));
    const custom = a.custom.map((c) => c.trim()).filter(Boolean);
    if (!labels.length && !custom.length) return left;
    const all = [...labels, ...custom];
    if (!a.pick && all.every(saysDontKnow)) return unknown(all.join("; "));
    return { text: all.join("; "), typed: custom.join("; "), how: a.pick && !custom.length ? "pick" : "own" };
  }
  return left;
}

/** An answer in a few words, for the review step and the chat. Never for the model: a long multi answer is cut ("+N more"); use answerWords. */
export function summarize(q: Question, a: Answer): string {
  if (a.kind === "skipped") return a.unknown ? "Don't know" : "Skipped";
  if (a.kind === "single" && q.kind === "single") {
    if (a.value === OTHER) return a.other?.trim() || "—";
    return q.options.find((o) => o.value === a.value)?.label ?? "—";
  }
  if (a.kind === "multi" && q.kind === "multi") {
    const labels = [...q.groups.flatMap((g) => g.options.filter((o) => a.values.includes(o.value)).map((o) => o.label)), ...a.custom];
    if (!labels.length) return "None";
    return labels.length > 4 ? `${labels.slice(0, 4).join(", ")} +${labels.length - 4} more` : labels.join(", ");
  }
  if (a.kind === "text") return a.text.trim() || "—";
  if (a.kind === "shots") return [a.shots.length ? (a.shots.length === 1 ? "1 screenshot" : `${a.shots.length} screenshots`) : "", a.text.trim()].filter(Boolean).join(" · ") || "—";
  return "—";
}

// ---------------------------------------------------------------------------
// Editing a multiple-choice answer

type Multi = { kind: "multi"; values: string[]; custom: string[] };

export function toggleValue(a: Multi, value: string, on: boolean): Multi {
  const values = on ? (a.values.includes(value) ? a.values : [...a.values, value]) : a.values.filter((v) => v !== value);
  return { ...a, values };
}

/** Every option of a group on (All) or off (None). */
export function setGroup(a: Multi, g: MultiGroup, on: boolean): Multi {
  const ids = g.options.map((o) => o.value);
  const rest = a.values.filter((v) => !ids.includes(v));
  if (!on) return { ...a, values: rest, custom: g.custom ? [] : a.custom };
  const room = g.max === undefined ? ids.length : Math.max(0, g.max - (g.custom ? a.custom.length : 0));
  return { ...a, values: [...rest, ...ids.slice(0, room)] };
}

/** Longest answer typed in, as an option of its own or as Other: room for a sentence with its numbers. */
export const CUSTOM_MAX = 200;

export function addCustom(a: Multi, name: string): Multi {
  const n = name.trim().replace(/\s+/g, " ").slice(0, CUSTOM_MAX);
  if (!n || a.custom.some((c) => c.toLowerCase() === n.toLowerCase())) return a;
  return { ...a, custom: [...a.custom, n] };
}

/** The answer with a line a tool brought added to it, however the question takes words; the person can still change it. */
export function fillAnswer(q: Question, a: Answer, line: string): Answer {
  const add = (had: string | undefined, max: number) => [had?.trim(), line].filter(Boolean).join("\n").slice(0, max);
  if (q.kind === "text") return { kind: "text", text: add(a.kind === "text" ? a.text : "", q.maxLength ?? Infinity) };
  if (q.kind === "shots") return { kind: "shots", shots: a.kind === "shots" ? a.shots : [], text: add(a.kind === "shots" ? a.text : "", q.maxLength ?? Infinity) };
  if (q.kind === "single") return { kind: "single", value: OTHER, other: add(a.kind === "single" && a.value === OTHER ? a.other : "", 1200) };
  const multi: Multi = a.kind === "multi" ? a : { kind: "multi", values: [], custom: [] };
  return { ...multi, custom: [...multi.custom, line.slice(0, 1200)] };
}

/**
 * What was said before, used for this question (src/memory/known.ts): the choice it names where there is
 * one, else the words, where the question takes words. None: it can't be this question's answer (a pick
 * its options don't hold, words a choice-only question can't take, a don't-know).
 */
export function knownAnswer(q: Question, k: { text: string; how: AnswerHow }): Answer | null {
  const text = k.text.trim();
  if (!text || k.how === "unknown" || k.how === "left") return null;
  // Qalam AI's pick stays its pick: only where this question's own options hold it, never as words.
  const pick = k.how === "pick";
  if (q.kind === "single") {
    const o = q.options.find((x) => x.label === text);
    if (o) return { kind: "single", value: o.value, ...(pick ? { pick: true as const } : {}) };
    return pick || !q.other ? null : { kind: "single", value: OTHER, other: text.slice(0, 1200) };
  }
  if (q.kind === "multi") {
    const said = text.split(/;\s*/).filter(Boolean);
    const options = q.groups.flatMap((g) => g.options);
    const values = options.filter((o) => said.includes(o.label)).map((o) => o.value);
    const custom = said.filter((l) => !options.some((o) => o.label === l)).map((l) => l.slice(0, 1200));
    if (pick) return values.length && !custom.length ? { kind: "multi", values, custom: [], pick: true } : null;
    if (custom.length && !q.groups.some((g) => g.custom)) return null;
    return { kind: "multi", values, custom };
  }
  // Words said before can answer it in words; the screenshots are shown again from what's kept, never from memory.
  if (q.kind === "shots") return pick ? null : { kind: "shots", shots: [], text: text.slice(0, q.maxLength ?? 1200) };
  return pick ? null : { kind: "text", text: text.slice(0, q.maxLength ?? 1200) };
}

/** Screenshots added to an answer, after what it has, each once, up to the most it takes. */
export function addAnswerShots(a: Answer, add: readonly AnswerShot[], max = SHOTS_MAX): Extract<Answer, { kind: "shots" }> {
  const had = a.kind === "shots" ? a : { kind: "shots" as const, shots: [], text: a.kind === "text" ? a.text : "" };
  const shots = [...had.shots];
  for (const s of add) if (!shots.some((x) => x.asset === s.asset) && shots.length < max) shots.push(s);
  return { ...had, shots };
}

/** A screenshot taken off an answer. */
export const removeShot = (a: Extract<Answer, { kind: "shots" }>, asset: string): Extract<Answer, { kind: "shots" }> => ({ ...a, shots: a.shots.filter((s) => s.asset !== asset) });

export function removeCustom(a: Multi, name: string): Multi {
  return { ...a, custom: a.custom.filter((c) => c !== name) };
}
