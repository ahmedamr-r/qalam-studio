import { withoutIds } from "@/goals/said";
import { holdWords, sameTopic, sameWords } from "@/hub/topics";
import { termFor } from "@/terms/edit";
import type { Terms } from "@/terms/types";
import { sanitizeAsked, sanitizeQuestions } from "@/ui/ai/plan";
import { DONT_KNOW_STREAK } from "./dontknow";
import type { AskQuestion, AskTurn, AskWho, Lookup, LookupKind, SettledPoint } from "./types";

/*
 * A turn of Qalam AI's, as code keeps it (pure). Nothing asked before is asked again (by id or by its
 * words), so with no limit on rounds it still can't circle; what a question waits on must be a question
 * or a lookup there is, and a loop of waiting is broken. Lookups only of the kinds this flow can run,
 * one web lookup at a time and never the same one twice. What it takes as settled holds to what it was
 * sent; a term only one of their own words, defined in their words, never how it's built; a decision
 * only when it's hard to undo, surprising later and a real trade-off, its reason in their words.
 */

export interface TurnCheck {
  who: AskWho;
  /** Every question asked so far: never asked again. */
  asked: readonly { id: string; title: string }[];
  /** Questions held last turn until what they wait on settles: asked again then, under their own id, never dropped as asked already. */
  held?: readonly { id: string; title: string }[];
  /** How many answers in a row said they don't know: from DONT_KNOW_STREAK on, a question for a fact (one a tool could answer) waits. */
  streak?: number;
  /** What was recalled for the turn (m1…, src/memory/recall.ts): a settled point may rest on it. */
  memory?: readonly string[];
  /** Lookups so far: never the same twice. */
  lookups: readonly Pick<Lookup, "id" | "kind" | "query">[];
  /** Their own words: what they asked and what they typed, never a pick. A term must be one of them. */
  said: string;
  /** Everything the turn was sent, ids out: where words and numbers may come from. */
  hay: string;
  /** The project's words: a term there already, or one taken off, isn't proposed. */
  terms?: Terms;
  /** Proposed in this conversation already. */
  proposed?: readonly string[];
  /** The kinds of lookup this flow runs. */
  kinds: readonly LookupKind[];
  /** Decisions are offered (the Decisions lab switch). */
  decisions?: boolean;
  /** A flow's own say over each question (null: left out). */
  tweak?: (q: AskQuestion) => AskQuestion | null;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");
const ids = (v: unknown) => list(v).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 12);
/** The call's own ids out of words people read. */
const clean = (s: string) => one(withoutIds(s, () => undefined, "qlfwapckm"));
/** A whole word or phrase of theirs. */
const inWords = (hay: string, words: string) => {
  const w = sameWords(words);
  return !!w && ` ${sameWords(hay)} `.includes(` ${w} `);
};
/** How a thing is built, not what it is: never in the project's words. */
const BUILT = /\b(api|endpoint|database|table|column|schema|json|field|button|screen|backend|frontend|server|repo)\b/i;

export const ASK_LIMITS = { query: 200, point: 200, points: 12, term: 60, means: 240, avoid: 6, why: 240, choice: 160 } as const;

/**
 * A turn's questions as code keeps them, for any flow that asks (the interview's own turns, a brain
 * dump's follow-up): each as the questionnaire can ask it, never one asked before (by id or by its
 * words), an id of its own, and what it waits on only where that's a question or a lookup there is,
 * any loop of waiting broken. `readable`: a flow's own say over its words (a dump names its pieces).
 */
export function keepQuestions(
  raw: readonly unknown[],
  c: Pick<TurnCheck, "who" | "asked" | "held" | "lookups" | "tweak" | "streak"> & { taken?: Set<string>; lookupIds?: ReadonlyMap<string, string>; readable?: (q: AskQuestion) => AskQuestion },
  dropped?: (why: string, item: unknown) => void,
): { questions: AskQuestion[]; questionIds: Map<string, string> } {
  const drop = (why: string, item: unknown) => void dropped?.(why, item);
  const taken = c.taken ?? new Set([...c.asked.map((a) => a.id), ...c.lookups.map((l) => l.id)]);
  const questionIds = new Map<string, string>();
  const questions: AskQuestion[] = [];
  const asked = [...c.asked];
  // Held last turn: asked again now that it can be, keeping its id; each one once.
  const held = [...(c.held ?? [])];
  for (const item of raw) {
    const x = rec(item);
    const kept = (c.who === "designer" ? sanitizeQuestions([item], { max: 1 }) : sanitizeAsked([item], { max: 1 }))[0];
    if (!kept) {
      drop("not a question the questionnaire can ask", item);
      continue;
    }
    const named = c.readable ? c.readable(kept) : kept;
    const q: AskQuestion = { ...named, title: clean(named.title), why: clean(named.why), options: named.options.map((o) => ({ ...o, label: clean(o.label), description: clean(o.description) })) };
    if (!q.title || q.options.some((o) => !o.label)) {
      drop("its words were only ids", item);
      continue;
    }
    if (asked.some((a) => (a.id === q.id ? sameTopic(a.title, q.title) || sameWords(a.title) === sameWords(q.title) : sameTopic(a.title, q.title)))) {
      drop("asked already", item);
      continue;
    }
    // Several don't-knows in a row: a fact (one their numbers or docs would hold) waits; what they can decide doesn't.
    if ((c.streak ?? 0) >= DONT_KNOW_STREAK && q.tool) {
      drop("they've said they don't know several things in a row: facts wait", item);
      continue;
    }
    const again = held.findIndex((h) => h.id === q.id || sameTopic(h.title, q.title));
    let id = again >= 0 ? held[again].id : q.id;
    if (again >= 0) held.splice(again, 1);
    else while (taken.has(id)) id = `${q.id}-${taken.size + 1}`;
    taken.add(id);
    questionIds.set(str(x.id, 40), id);
    questionIds.set(q.id, id);
    const tweaked = c.tweak ? c.tweak({ ...q, id }) : { ...q, id };
    if (!tweaked) {
      drop("this flow leaves it out", item);
      continue;
    }
    questions.push({ ...tweaked, ...(ids(x.after).length ? { after: ids(x.after) } : {}) });
    asked.push({ id, title: q.title });
  }

  // What each waits on: a question of this turn, one asked before, or a lookup; any loop broken.
  const known = new Set([...c.asked.map((a) => a.id), ...c.lookups.map((l) => l.id)]);
  for (const q of questions) {
    const after = (q.after ?? []).map((a) => questionIds.get(a) ?? c.lookupIds?.get(a) ?? (known.has(a) ? a : "")).filter((a) => a && a !== q.id);
    if (after.length) q.after = [...new Set(after)];
    else delete q.after;
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  const loops = (from: string, seen: Set<string>): boolean => (byId.get(from)?.after ?? []).some((a) => seen.has(a) || (byId.has(a) && loops(a, new Set([...seen, a]))));
  for (const q of questions) {
    if (!q.after || !loops(q.id, new Set([q.id]))) continue;
    const left = q.after.filter((a) => !byId.has(a));
    if (left.length) q.after = left;
    else delete q.after;
  }
  return { questions, questionIds };
}

/** A turn's questions split as the engine asks them: now, or held until what they wait on (another question of the turn) settles. */
export function frontierOf(questions: readonly AskQuestion[]): { ask: AskQuestion[]; held: AskQuestion[] } {
  const here = new Set(questions.map((q) => q.id));
  const waits = (q: AskQuestion) => (q.after ?? []).some((a) => here.has(a));
  const ask = questions.filter((q) => !waits(q));
  const held = questions.filter(waits);
  return ask.length ? { ask, held } : { ask: [...held], held: [] };
}

export function sanitizeTurn(raw: unknown, c: TurnCheck, dropped?: (why: string, item: unknown) => void): AskTurn {
  const r = rec(raw);
  const drop = (why: string, item: unknown) => void dropped?.(why, item);
  const taken = new Set([...c.asked.map((a) => a.id), ...c.lookups.map((l) => l.id)]);

  // Lookups first: a question may wait on one asked for in the same turn.
  const lookupIds = new Map<string, string>();
  const lookups: AskTurn["lookups"] = [];
  for (const item of list(r.lookups)) {
    const x = rec(item);
    const kind = c.kinds.find((k) => k === x.kind);
    const query = str(x.query, ASK_LIMITS.query);
    const raw = str(x.id, 24);
    if (!kind || !query) {
      drop(!kind ? "a lookup this flow can't run" : "a lookup with nothing to look up", item);
      continue;
    }
    if ([...c.lookups, ...lookups].some((l) => l.kind === kind && (sameWords(l.query) === sameWords(query) || sameTopic(l.query, query)))) {
      drop("looked up already", item);
      continue;
    }
    if (kind === "web" && lookups.some((l) => l.kind === "web")) {
      drop("one web lookup at a time", item);
      continue;
    }
    let id = /^[a-z][\w-]{0,23}$/i.test(raw) ? raw : `l${taken.size + 1}`;
    while (taken.has(id)) id = `l${taken.size + 1}-${lookups.length + 1}`;
    taken.add(id);
    if (raw) lookupIds.set(raw, id);
    lookups.push({ id, kind, query });
  }

  const { questions, questionIds } = keepQuestions(list(r.questions), { ...c, taken, lookupIds }, dropped);
  const known = new Set([...c.asked.map((a) => a.id), ...c.lookups.map((l) => l.id)]);

  // What it takes as settled: its own words, held to what it was sent.
  const hay = `${c.hay}\n${c.said}`;
  const understood: SettledPoint[] = [];
  for (const item of list(r.understood).slice(0, ASK_LIMITS.points)) {
    const x = rec(item);
    const text = holdWords(clean(str(x.text, 400)), hay, { max: ASK_LIMITS.point, shape: "prose" }).text;
    if (text.split(" ").length < 2) {
      drop("a settled point with nothing left once what wasn't sent is out", item);
      continue;
    }
    const from = ids(x.from).filter((a) => known.has(a) || questionIds.has(a) || a === "said" || !!c.memory?.includes(a));
    understood.push({ text, ...(from.length ? { from } : {}) });
  }

  // A term: one of their own words, said in their words, not one the project has or took off.
  const terms: AskTurn["terms"] = [];
  for (const item of c.terms ? list(r.terms) : []) {
    const x = rec(item);
    const term = str(x.term, ASK_LIMITS.term).replace(/^["“']+|["”']+$/g, "");
    const means = holdWords(clean(str(x.means, 600)), hay, { max: ASK_LIMITS.means, shape: "prose" }).text;
    const sentences = means.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    const why = !term || !inWords(c.said, term) ? "a term that isn't one of their own words" : !means || sentences > 2 ? "a meaning that isn't a sentence or two of what was said" : BUILT.test(means) ? "how it's built, not what it is" : termFor(c.terms!, term) || c.terms!.gone.includes(term.toLowerCase()) || [...(c.proposed ?? []), ...terms.map((t) => t.term)].some((p) => p.toLowerCase() === term.toLowerCase()) ? "a term the project has, took off, or was offered already" : "";
    if (why) {
      drop(why, item);
      continue;
    }
    const avoid = ids(x.avoid).map((a) => one(a).slice(0, 40)).filter((a) => a.toLowerCase() !== term.toLowerCase() && inWords(hay, a)).slice(0, ASK_LIMITS.avoid);
    terms.push({ term, means, avoid });
  }

  // A decision: only the three tests passed, its reason in their own words.
  const choices: AskTurn["choices"] = [];
  for (const item of c.decisions ? list(r.choices) : []) {
    const x = rec(item);
    const choice = holdWords(clean(str(x.choice, 400)), hay, { max: ASK_LIMITS.choice, shape: "prose" }).text;
    const why = holdWords(clean(str(x.why, 600)), c.said, { max: ASK_LIMITS.why, shape: "prose" }).text;
    const instead = holdWords(clean(str(x.instead, 400)), hay, { max: ASK_LIMITS.choice, shape: "prose" }).text;
    if (x.hard_to_undo !== true || x.surprising !== true || x.trade_off !== true) {
      drop("not hard to undo, surprising and a real trade-off all at once", item);
      continue;
    }
    if (!choice || !instead || why.split(" ").length < 3) {
      drop("its reason isn't in their words, or nothing was weighed against it", item);
      continue;
    }
    choices.push({ choice, why, instead });
  }

  return { questions, lookups, done: r.done === true, understood, terms, choices };
}
