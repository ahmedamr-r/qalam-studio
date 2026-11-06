import type { FocusLook } from "@/goals/focus";
import { toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { REVIEW, answerWords, initialFlow, resolvedAnswers, type Answer, type FlowState } from "@/ui/ai/questionFlow";
import type { AskAnswer, AskQuestion, AskRound, AskTurn, AskingState, ChoiceProposal, FoundLine, Lookup, SettledPoint, TermProposal } from "./types";

/*
 * The interview's moves (pure). Each turn of Qalam AI's adds what's still open: the questions that
 * can be asked now become a round; one that waits on another of the same turn, or on a lookup still
 * running, is held, and the next turn asks it again with what settled in hand. Lookups start as soon
 * as they're asked for and run while the person answers; only the turn after them waits. There's no
 * limit on rounds: it ends when a turn leaves nothing open, or brings nothing new (code drops any
 * question asked before, so it can't circle), or the person says to stop asking.
 */

const flowOf = (qs: readonly AskQuestion[]): FlowState => initialFlow(qs.map(toQuestion));
const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A start with code's own questions as its first round (none: Qalam AI's first turn asks). */
export function emptyAsking(seeds: readonly AskQuestion[] = []): AskingState {
  const qs = seeds.map((q) => ({ ...q, by: "code" as const }));
  return { v: 1, rounds: qs.length ? [{ questions: qs, form: flowOf(qs) }] : [], turns: 0, held: [], lookups: [], understood: [], terms: [], choices: [] };
}

/** A round of code's own, added now (what's off about what was settled, a check-in). */
export const withCodeRound = (s: AskingState, qs: readonly AskQuestion[]): AskingState => (qs.length ? { ...s, end: undefined, confirmed: undefined, rounds: [...s.rounds, { questions: qs.map((q) => ({ ...q, by: "code" as const })), form: flowOf(qs) }] } : s);

/** The round being asked: the last one, until it's sent. */
export function currentRound(s: AskingState): AskRound | null {
  const r = s.rounds.at(-1);
  return r && !r.form.submitted && !r.said ? r : null;
}

/** Every answer so far, round by round. A question left (skipped, or untouched when the round went) is `left`; a round they stopped half-way counts for what it has. */
export function answersOf(s: Pick<AskingState, "rounds">): AskAnswer[] {
  return s.rounds.flatMap((r, round) => {
    if (r.said)
      return r.questions.map((q): AskAnswer => {
        const t = (r.said?.[q.id] ?? "").trim();
        return { id: q.id, round, question: q.title, text: t, typed: t, how: t ? "own" : "left" };
      });
    const qs = r.questions.map(toQuestion);
    const sent = r.form.submitted;
    const answers = sent ? resolvedAnswers(qs, r.form.answers) : r.form.answers;
    return qs.flatMap((q): AskAnswer[] => (sent || r.form.answers[q.id] ? [{ id: q.id, round, question: q.title, ...answerWords(q, answers[q.id]) }] : []));
  });
}

/** Their own words in the answers: what a term or a choice's reason must come from. Never a pick. */
export const theirWords = (s: Pick<AskingState, "rounds">): string =>
  answersOf(s)
    .filter((a) => a.how === "own")
    .map((a) => a.text)
    .join("\n");

const running = (l: Lookup) => l.state === "running";
const forTurns = (l: Lookup) => l.waits !== "draft";

/** The lookups the next turn waits for. */
export const waitedOn = (s: AskingState): Lookup[] => s.lookups.filter((l) => running(l) && forTurns(l) && (l.waits as number) <= s.turns);

export type AskNext = "ask" | "offer" | "wait" | "turn" | "end";

/** What comes next: a round in the box, a lookup put to them, a lookup to wait for, Qalam AI's turn, or the end. */
export function nextAfter(s: AskingState): AskNext {
  if (s.end) return "end";
  if (currentRound(s)) return "ask";
  if (s.offer) return "offer";
  if (waitedOn(s).length) return "wait";
  return "turn";
}

/** Before a turn: what its lookups found so far is read by it. A lookup that lands while the turn runs isn't, so the next turn reads it. */
export const markRead = (s: AskingState): AskingState => ({ ...s, lookups: s.lookups.map((l) => (l.state !== "running" && l.read === undefined && forTurns(l) ? { ...l, read: s.turns + 1 } : l)) });

function withTerms(had: readonly TermProposal[], add: AskTurn["terms"], id: (p: string) => string): TermProposal[] {
  const out = [...had];
  for (const t of add) if (!out.some((x) => key(x.term) === key(t.term))) out.push({ id: id("t"), term: t.term, means: t.means, avoid: [...t.avoid] });
  return out;
}

function withChoices(had: readonly ChoiceProposal[], add: AskTurn["choices"], id: (p: string) => string): ChoiceProposal[] {
  const out = [...had];
  for (const c of add) if (!out.some((x) => key(x.choice) === key(c.choice))) out.push({ id: id("d"), choice: c.choice, why: c.why, instead: c.instead });
  return out;
}

/**
 * A turn of Qalam AI's taken in. Its lookups start now and the next turn waits for them; what it asks
 * now is a round, what waits on something still open is held. After two turns in a row that only
 * looked things up, a web lookup is put to the person instead of run. It ends when nothing is asked,
 * held, looked up or waiting to be read.
 */
export function applyTurn(s: AskingState, t: AskTurn, o: { now: number; id: (prefix: string) => string }): AskingState {
  const turn = s.turns + 1;
  const quiet = s.quiet ?? 0;
  const web = t.lookups.filter((l) => l.kind === "web");
  const offerIt = !t.questions.length && quiet >= 2 && web.length > 0;
  const started: Lookup[] = t.lookups.filter((l) => !(offerIt && l.kind === "web")).map((l) => ({ id: l.id, kind: l.kind, query: l.query, waits: turn, state: "running", at: o.now }));
  const lookups = [...s.lookups, ...started];
  const busy = new Set(lookups.filter(running).map((l) => l.id));
  const here = new Set(t.questions.map((q) => q.id));
  const waits = (q: AskQuestion) => (q.after ?? []).some((a) => here.has(a) || busy.has(a));
  let ask = t.questions.filter((q) => !waits(q));
  let held = t.questions.filter(waits);
  // Held with nothing running and nothing asked now, nothing would ever settle them: they're asked now.
  if (!ask.length && held.length && !lookups.some((l) => running(l) && forTurns(l))) {
    ask = held;
    held = [];
  }
  const next: AskingState = {
    ...s,
    turns: turn,
    lookups,
    held,
    understood: t.understood.length ? t.understood : s.understood,
    terms: withTerms(s.terms, t.terms, o.id),
    choices: withChoices(s.choices, t.choices, o.id),
    quiet: ask.length ? 0 : started.length || offerIt ? quiet + 1 : quiet,
    rounds: ask.length ? [...s.rounds, { questions: ask, form: flowOf(ask) }] : s.rounds,
  };
  delete next.askFirst;
  delete next.offer;
  if (offerIt) next.offer = { id: web[0].id, query: web[0].query };
  const pending = lookups.some((l) => running(l) && forTurns(l));
  const unread = lookups.some((l) => l.state === "done" && l.read === undefined && forTurns(l));
  if (!ask.length && !held.length && !started.length && !offerIt && !pending && !unread) next.end = { by: t.done ? "done" : "nothing-new", at: o.now };
  return next;
}

/** A round's answers as they're being given (kept so a reload finds them). */
export function saveRound(s: AskingState, form: FlowState): AskingState {
  const i = s.rounds.length - 1;
  return i < 0 ? s : { ...s, rounds: s.rounds.map((r, k) => (k === i ? { ...r, form } : r)) };
}

/** A round sent: its answers stand. */
export const closeRound = (s: AskingState, form: FlowState): AskingState => saveRound(s, { ...form, submitted: true, current: REVIEW });

/** "Use Qalam AI's picks": every question they haven't answered that has a recommendation takes it, marked as Qalam AI's pick. The rest stay as they left them. */
export function takePicks(qs: readonly AskQuestion[], form: FlowState): FlowState {
  const answers = { ...form.answers };
  for (const raw of qs) {
    const q = toQuestion(raw);
    if (answerWords(q, answers[q.id]).how !== "left") continue;
    const rec = raw.recommended.filter((v) => raw.options.some((x) => x.value === v));
    if (!rec.length) continue;
    const pick: Answer | null = q.kind === "single" ? { kind: "single", value: rec[0], pick: true } : q.kind === "multi" ? { kind: "multi", values: rec, custom: [], pick: true } : null;
    if (pick) answers[q.id] = pick;
  }
  return { ...form, answers };
}

/** A lookup came back, failed or was stopped. */
export function lookupLanded(s: AskingState, id: string, r: { lines?: FoundLine[]; look?: FocusLook; error?: string; stopped?: boolean }): AskingState {
  return { ...s, lookups: s.lookups.map((l) => (l.id !== id || !running(l) ? l : { ...l, state: r.stopped ? "stopped" : r.error ? "failed" : "done", ...(r.lines ? { lines: r.lines } : {}), ...(r.look ? { look: r.look } : {}), ...(r.error ? { error: r.error } : {}) })) };
}

/** A lookup they or code started, outside a turn (an opening look; one they said yes to). */
export const startLookup = (s: AskingState, l: Pick<Lookup, "id" | "kind" | "query" | "waits">, now: number): AskingState => ({ ...s, offer: s.offer?.id === l.id ? undefined : s.offer, quiet: s.offer?.id === l.id ? 0 : s.quiet, lookups: [...s.lookups.filter((x) => x.id !== l.id), { ...l, state: "running", at: now }] });

/** They'd rather be asked than have it looked up: the next turn asks, or ends. */
export const askInstead = (s: AskingState): AskingState => ({ ...s, offer: undefined, quiet: 0, askFirst: true });

/** "Stop asking": what's answered stands, what's running for the turns stops, and it ends. */
export function endNow(s: AskingState, now: number): AskingState {
  const cur = currentRound(s);
  const closed = cur ? closeRound(s, cur.form) : s;
  return { ...closed, offer: undefined, end: { by: "stopped", at: now }, lookups: closed.lookups.map((l) => (running(l) && forTurns(l) ? { ...l, state: "stopped" } : l)) };
}

/** Running lookups found stopped after a reload: nothing runs them any more. */
export const loaded = (s: AskingState): AskingState => (s.lookups.some(running) ? { ...s, lookups: s.lookups.map((l) => (running(l) ? { ...l, state: "stopped" } : l)) } : s);

/** "Something's off" about what was settled: a round of code's asks what, and the next turn reads it. */
export const offPoint = (s: AskingState): AskingState =>
  withCodeRound(s, [{ id: `off-${s.rounds.length + 1}`, title: "What's off?", why: "Say what's wrong or missing, and I'll ask about what that changes.", multi: false, options: [], recommended: [], allowOther: false }]);

export const decideTerm = (s: AskingState, id: string, keep: boolean): AskingState => ({ ...s, terms: s.terms.map((t) => (t.id === id ? { ...t, state: keep ? "kept" : "left" } : t)) });
export const decideChoice = (s: AskingState, id: string, keep: boolean): AskingState => ({ ...s, choices: s.choices.map((c) => (c.id === id ? { ...c, state: keep ? "kept" : "left" } : c)) });

/** They saw what was settled and said go. */
export const confirmed = (s: AskingState, now: number): AskingState => ({ ...s, confirmed: now });

/** What was settled, for the card before generating: the points, Qalam AI's picks they agreed to, the words and decisions offered, and what's left open. */
export function settledOf(s: AskingState): { asked: boolean; points: SettledPoint[]; picks: AskAnswer[]; terms: TermProposal[]; choices: ChoiceProposal[]; left: string[] } {
  const answers = answersOf(s);
  return {
    asked: s.rounds.length > 0,
    points: s.understood,
    picks: answers.filter((a) => a.how === "pick"),
    terms: s.terms.filter((t) => t.state !== "left"),
    choices: s.choices.filter((c) => c.state !== "left"),
    left: [...answers.filter((a) => a.how === "left").map((a) => a.question), ...s.held.map((q) => q.title)],
  };
}

/** It ended with something asked, and they haven't said go yet: What we settled waits for them. */
export const awaitsConfirm = (s: AskingState): boolean => !!s.end && s.rounds.length > 0 && !s.confirmed;

/** What every web lookup found, as a look: what a draft reads as others' words. */
export const looksOf = (s: AskingState): (FocusLook & { after: number })[] =>
  s.lookups.flatMap((l) => (l.kind === "web" && l.state === "done" && l.look ? [{ ...l.look, after: typeof l.waits === "number" ? l.waits - 2 : -1 }] : []));

/** What every project lookup found: the pieces a draft may rest on. */
export const foundOf = (s: AskingState): FoundLine[] => s.lookups.flatMap((l) => (l.kind === "project" && l.state === "done" ? (l.lines ?? []) : []));

// ---------------------------------------------------------------------------
// Kept before: rounds as buckets (a brain dump's, the questions before a draft) or a plan's rounds in words

/** Rounds kept as buckets, as an interview: Qalam AI took a turn for each. */
export function fromBuckets(buckets: readonly PlanBucket[]): AskingState {
  return { v: 1, rounds: buckets.map((b) => ({ questions: b.questions, form: b.form, ...(b.analysis ? { analysis: b.analysis } : {}) })), turns: buckets.length, held: [], lookups: [], understood: [], terms: [], choices: [] };
}

/** A plan's rounds from before (answers kept as words) and its looks, as an interview. */
export function fromPlanRounds(rounds: readonly { questions: AskQuestion[]; answers?: Record<string, string> }[], looks: readonly (FocusLook & { after: number })[]): AskingState {
  const s: AskingState = { v: 1, rounds: rounds.map((r) => ({ questions: r.questions, form: { ...flowOf(r.questions), submitted: !!r.answers }, ...(r.answers ? { said: { ...r.answers } } : {}) })), turns: rounds.length, held: [], lookups: [], understood: [], terms: [], choices: [] };
  s.lookups = looks.map((l, i) => ({ id: `l${i}`, kind: "web", query: l.query, waits: l.after + 2, state: "done", look: { at: l.at, query: l.query, lines: l.lines, pages: l.pages, ...(l.noWeb ? { noWeb: true as const } : {}) }, read: l.after + 2, at: l.at }));
  return s;
}
