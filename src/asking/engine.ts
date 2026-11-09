import type { FocusLook } from "@/goals/focus";
import { gateOf } from "@/memory/gate";
import type { AskedFlow } from "@/memory/types";
import { toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { REVIEW, answerWords, initialFlow, knownAnswer, resolvedAnswers, type Answer, type FlowState } from "@/ui/ai/questionFlow";
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

/** What a turn waits for: a lookup it asked for, never a scan (nothing waits on one) or a look for the draft. */
const turnBound = (l: Lookup) => typeof l.waits === "number";

/** The lookups the next turn waits for. */
export const waitedOn = (s: AskingState): Lookup[] => s.lookups.filter((l) => running(l) && turnBound(l) && (l.waits as number) <= s.turns);

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
 * A question asked again, answered with what they said before instead (src/memory/gate.ts): their own
 * answer to the same question, given lately, as the question's form takes it. Qalam AI's pick stays its
 * pick and a don't-know a don't-know. None: it's asked, with what was said shown under it.
 */
function fromMemory(q: AskQuestion, now: number): { q: AskQuestion; a: Answer } | null {
  const k = gateOf(q, now);
  if (!k) return null;
  const a: Answer | null = k.how === "unknown" ? { kind: "skipped", unknown: true } : knownAnswer(toQuestion(q), k);
  return a ? { q: { ...q, known: [k] }, a } : null;
}

/**
 * A turn of Qalam AI's taken in. Its lookups start now and the next turn waits for them; what it asks
 * now is a round, what waits on something still open is held, and what they answered lately is a round
 * of what they said, not asked. After two turns in a row that only looked things up, a web lookup is put
 * to the person instead of run. It ends when nothing is asked, held, looked up or waiting to be read; a
 * turn whose questions were all answered before goes on to another unless it was done.
 */
export function applyTurn(s: AskingState, t: AskTurn, o: { now: number; id: (prefix: string) => string; cap?: number; openFirst?: boolean }): AskingState {
  const turn = s.turns + 1;
  const quiet = s.quiet ?? 0;
  const known = t.questions.flatMap((q) => fromMemory(q, o.now) ?? []);
  const fresh = t.questions.filter((q) => !known.some((k) => k.q.id === q.id));
  const web = t.lookups.filter((l) => l.kind === "web");
  const offerIt = !t.questions.length && quiet >= 2 && web.length > 0;
  // A look in their tools needs their picks before anything comes of it: put to them, never run by a turn.
  const tools = offerIt ? [] : t.lookups.filter((l) => l.kind === "tools");
  // A scan takes minutes: offered beside the rounds, once a conversation, and never run by a turn.
  const scan = s.scan ? undefined : t.lookups.find((l) => l.kind === "scan");
  const started: Lookup[] = t.lookups.filter((l) => l.kind !== "tools" && l.kind !== "scan" && !(offerIt && l.kind === "web")).map((l) => ({ id: l.id, kind: l.kind, query: l.query, ...(l.why ? { why: l.why } : {}), waits: turn, state: "running", at: o.now }));
  const lookups = [...s.lookups, ...started];
  // What waits on the look put to them waits with it.
  const busy = new Set([...lookups.filter(running).map((l) => l.id), ...tools.slice(0, 1).map((l) => l.id)]);
  // What was answered from memory is settled now: nothing waits on it.
  const here = new Set(fresh.map((q) => q.id));
  const waits = (q: AskQuestion) => (q.after ?? []).some((a) => here.has(a) || busy.has(a));
  let ask = fresh.filter((q) => !waits(q));
  let held = fresh.filter(waits);
  // Held with nothing running, nothing put to them and nothing asked now, nothing would ever settle them: they're asked now.
  if (!ask.length && held.length && !tools.length && !lookups.some((l) => running(l) && forTurns(l))) {
    ask = held;
    held = [];
  }
  // For someone new: open questions first, and only a few at a time. The rest wait for a later round,
  // where the next turn asks them or drops them; nothing they'd wait on, so nothing is lost.
  if (o.openFirst) ask = [...ask.filter((q) => !q.options.length), ...ask.filter((q) => q.options.length)];
  if (o.cap && ask.length > o.cap) {
    held = [...held, ...ask.slice(o.cap).map((q) => ({ ...q, later: true as const, after: [] }))];
    ask = ask.slice(0, o.cap);
  }
  // Before a round that follows answers: what's settled so far and what's still open.
  const answered = s.rounds.some((r) => r.form.submitted || !!r.said);
  const so = (t.understood.length ? t.understood : s.understood).map((p) => p.text);
  const open = t.open ?? [];
  const reflect = answered && ask.length && (so.length || open.length) ? { so, open } : null;
  const explained = [...new Set([...(s.explained ?? []), ...ask.flatMap((q) => (q.explain ? [q.explain.term.toLowerCase()] : []))])];
  const next: AskingState = {
    ...s,
    turns: turn,
    lookups,
    held,
    understood: t.understood.length ? t.understood : s.understood,
    ...(t.open ? { open: t.open } : {}),
    ...(explained.length ? { explained } : {}),
    ...(scan ? { scan: { id: scan.id, query: scan.query, ...(scan.why ? { why: scan.why } : {}) } } : {}),
    terms: withTerms(s.terms, t.terms, o.id),
    choices: withChoices(s.choices, t.choices, o.id),
    quiet: ask.length || known.length ? 0 : started.length || offerIt || tools.length ? quiet + 1 : quiet,
    // What they said before goes first, as a round already answered; then what's asked now.
    rounds: [...s.rounds, ...(known.length ? [memoryRound(known)] : []), ...(ask.length ? [{ questions: ask, form: flowOf(ask), ...(reflect ? { reflect } : {}) }] : [])],
  };
  delete next.askFirst;
  delete next.offer;
  if (offerIt) next.offer = { id: web[0].id, query: web[0].query, ...(web[0].why ? { why: web[0].why } : {}) };
  else if (tools.length) next.offer = { id: tools[0].id, query: tools[0].query, kind: "tools", ...(tools[0].why ? { why: tools[0].why } : {}) };
  const pending = lookups.some((l) => running(l) && turnBound(l));
  const unread = lookups.some((l) => l.state === "done" && l.read === undefined && forTurns(l));
  if (!ask.length && !held.length && !started.length && !offerIt && !tools.length && !pending && !unread && (t.done || !known.length)) next.end = { by: t.done ? "done" : "nothing-new", at: o.now };
  return next;
}

/** The questions answered from what they said before, as a round already sent. */
function memoryRound(known: readonly { q: AskQuestion; a: Answer }[]): AskRound {
  const questions = known.map((k) => k.q);
  return { questions, form: { ...flowOf(questions), answers: Object.fromEntries(known.map((k) => [k.q.id, k.a])), submitted: true, current: REVIEW }, from: "memory" };
}

/**
 * The round being asked taken back while nobody has touched it (Explain more, Skip the basics): the next
 * turn asks again, so a word it explained there is explained again.
 */
export function dropCurrentRound(s: AskingState): AskingState {
  const r = currentRound(s);
  if (!r || Object.keys(r.form.answers).length) return s;
  const gone = new Set(r.questions.flatMap((q) => (q.explain ? [q.explain.term.toLowerCase()] : [])));
  return { ...s, rounds: s.rounds.slice(0, -1), ...(s.explained ? { explained: s.explained.filter((t) => !gone.has(t)) } : {}) };
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
export const startLookup = (s: AskingState, l: Pick<Lookup, "id" | "kind" | "query" | "waits" | "why">, now: number): AskingState => ({ ...s, offer: s.offer?.id === l.id ? undefined : s.offer, quiet: s.offer?.id === l.id ? 0 : s.quiet, lookups: [...s.lookups.filter((x) => x.id !== l.id), { ...l, state: "running", at: now }] });

/** They'd rather be asked than have it looked up: the next turn asks, or ends. */
export const askInstead = (s: AskingState): AskingState => ({ ...s, offer: undefined, quiet: 0, askFirst: true });

/** "Stop asking": what's answered stands, what's running for the turns stops, and it ends. */
export function endNow(s: AskingState, now: number): AskingState {
  const cur = currentRound(s);
  const closed = cur ? closeRound(s, cur.form) : s;
  // A scan they said yes to goes on: it's its own job in the chat, and its problems are theirs either way.
  return { ...closed, offer: undefined, end: { by: "stopped", at: now }, lookups: closed.lookups.map((l) => (running(l) && turnBound(l) ? { ...l, state: "stopped" } : l)) };
}

/** A scan reads on in the core, its job in the chat following it: the window finds it again after a reload. */
const stale = (l: Lookup) => running(l) && l.kind !== "scan";

/** Running lookups found stopped after a reload: nothing runs them any more. */
export const loaded = (s: AskingState): AskingState => (s.lookups.some(stale) ? { ...s, lookups: s.lookups.map((l) => (stale(l) ? { ...l, state: "stopped" } : l)) } : s);

/**
 * Reading what people say online, as they answered the offer: yes starts it as a lookup nothing waits on
 * (its job runs it, src/ui/space/chat/store.ts), and the next turn after it lands reads what it found;
 * not now leaves it. Either way it's never offered again in this conversation.
 */
export function scanSaid(s: AskingState, yes: boolean, now: number): AskingState {
  if (!s.scan || s.scan.said) return s;
  const scan = { ...s.scan, said: yes ? ("yes" as const) : ("no" as const) };
  if (!yes) return { ...s, scan };
  return { ...s, scan, lookups: [...s.lookups.filter((l) => l.id !== scan.id), { id: scan.id, kind: "scan", query: scan.query, ...(scan.why ? { why: scan.why } : {}), waits: "later", state: "running", at: now }] };
}

/** "Something's off" about what was settled: a round of code's asks what, and the next turn reads it. */
export const offPoint = (s: AskingState): AskingState =>
  withCodeRound(s, [{ id: `off-${s.rounds.length + 1}`, title: "What's off?", why: "Say what's wrong or missing, and I'll ask about what that changes.", multi: false, options: [], recommended: [], allowOther: false }]);

export const decideTerm = (s: AskingState, id: string, keep: boolean): AskingState => ({ ...s, terms: s.terms.map((t) => (t.id === id ? { ...t, state: keep ? "kept" : "left" } : t)) });
export const decideChoice = (s: AskingState, id: string, keep: boolean): AskingState => ({ ...s, choices: s.choices.map((c) => (c.id === id ? { ...c, state: keep ? "kept" : "left" } : c)) });

/** They saw what was settled and said go. */
export const confirmed = (s: AskingState, now: number): AskingState => ({ ...s, confirmed: now });

/** An answer taken from what they said before: where and when they said it. */
export type KnewAnswer = AskAnswer & { flow: AskedFlow; at: number };

/**
 * What was settled, for the card before generating: the points, Qalam AI's picks they agreed to, the
 * words and decisions offered, what's left open, and what it knew from what they said before (`knew`),
 * so nothing is generated on an earlier answer they haven't seen.
 */
export function settledOf(s: AskingState): { asked: boolean; points: SettledPoint[]; picks: AskAnswer[]; terms: TermProposal[]; choices: ChoiceProposal[]; left: string[]; unknown: string[]; knew: KnewAnswer[] } {
  const all = answersOf(s);
  const before = (a: AskAnswer) => s.rounds[a.round]?.from === "memory";
  const answers = all.filter((a) => !before(a));
  return {
    asked: s.rounds.length > 0,
    points: s.understood,
    picks: answers.filter((a) => a.how === "pick"),
    terms: s.terms.filter((t) => t.state !== "left"),
    choices: s.choices.filter((c) => c.state !== "left"),
    left: [...answers.filter((a) => a.how === "left").map((a) => a.question), ...s.held.map((q) => q.title)],
    // What they said they don't know: open too, and not a question to ask them again.
    unknown: answers.filter((a) => a.how === "unknown").map((a) => a.question),
    knew: all.filter(before).map((a) => {
      const k = s.rounds[a.round].questions.find((q) => q.id === a.id)?.known?.[0];
      return { ...a, flow: k?.flow ?? "plan", at: k?.at ?? 0 };
    }),
  };
}

/** It ended with something asked, and they haven't said go yet: What we settled waits for them. */
export const awaitsConfirm = (s: AskingState): boolean => !!s.end && s.rounds.length > 0 && !s.confirmed;

/** What every web lookup found, as a look: what a draft reads as others' words. */
export const looksOf = (s: AskingState): (FocusLook & { after: number })[] =>
  s.lookups.flatMap((l) => (l.kind === "web" && l.state === "done" && l.look ? [{ ...l.look, after: typeof l.waits === "number" ? l.waits - 2 : -1 }] : []));

/** What every project lookup found, and people online's quotes looked up before a draft: the pieces a draft may rest on. */
export const foundOf = (s: AskingState): FoundLine[] => s.lookups.flatMap((l) => (l.kind !== "web" && l.state === "done" ? (l.lines ?? []) : []));

/** The lookups only the generation waits on, still running (a look in the background before a draft). */
export const forDraft = (s: AskingState): Lookup[] => s.lookups.filter((l) => running(l) && !forTurns(l));

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
