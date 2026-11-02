import { heldBasis, isBasis } from "./basis";
import { newId } from "@/doc/factory";
import type { BriefAnswer, Doc } from "@/doc/schema";
import { isOstCard, treeRootOf } from "@/doc/board";
import type { DumpCardInput } from "@/ai/discovery";
import type { PlanQuestion } from "@/ai/plan";
import { answerText, sanitizeQuestions, toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { OTHER, initialFlow, resolvedAnswers, type Answer, type FlowState, type Question } from "@/ui/ai/questionFlow";
import { quoteFinder } from "./quotes";
import type { QuoteKind, SourceQuote, TextBlock } from "./sources";
import { allCards, childCards } from "./tree";
import type { OstKind, OstMetric } from "./types";
import type { Proposal } from "./proposals";
import { lookHead, lookLines, type FocusLook } from "@/goals/focus";

/*
 * A brain dump (pure): the builder's own thinking pasted onto the board as it comes (goals, needs,
 * ideas, numbers, what they've heard). Qalam AI says what it took from it, cuts it into pieces
 * with what each is to the tree, pushes back where the thinking won't hold up, asks before it
 * places anything, then proposes where every piece goes. Code keeps a piece only where it finds
 * the builder's words, and the words stay theirs: never a customer's.
 */

/** What a piece of a brain dump is to the tree. */
export const DUMP_ROLES = ["goal", "need", "idea", "test", "assumption", "metric", "evidence", "context", "question"] as const;
export type DumpRole = (typeof DUMP_ROLES)[number];

export const ROLE_LABEL: Record<DumpRole, string> = {
  goal: "Goal",
  need: "Need",
  idea: "Idea",
  test: "Test",
  assumption: "Assumption",
  metric: "Number",
  evidence: "Evidence",
  context: "Context",
  question: "Open question",
};

/** For Qalam AI: what each role holds. */
export const ROLE_HINT =
  "goal (a result the team wants: a business number or a change in what customers do) · need (a customer's need, pain or desire) · idea (a solution, feature or change they'd make) · test (a way to try an idea out) · assumption (something they believe has to be true) · metric (a number: where things are, where they want them) · evidence (something seen, measured or heard that backs or speaks against a belief) · context (who the product is for, where, how it works) · question (something they're unsure about)";

/** Where Qalam AI pushes back on the thinking. */
export const CHALLENGE_KINDS = ["solution-as-need", "business-goal", "second-hand", "conflict", "competing-goals", "unmeasured", "vague"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export const CHALLENGE_LABEL: Record<ChallengeKind, string> = {
  "solution-as-need": "Solution in disguise",
  "business-goal": "Business number, not a product outcome",
  "second-hand": "Heard second-hand",
  conflict: "Conflicts with the canvas",
  "competing-goals": "Competing goals",
  unmeasured: "No measure",
  vague: "Too vague to place",
};

/** For Qalam AI: when each kind of pushback applies. */
export const CHALLENGE_HINT =
  "solution-as-need (a feature written as if it were the customer's need) · business-goal (a business result such as revenue or orders given as the outcome, where a change in what customers do would move it) · second-hand (a claim about customers from someone else or a hunch, with no source) · conflict (it contradicts a card on the board, or another part of the dump) · competing-goals (several goals pull different ways and none is said to lead) · unmeasured (a goal with no way to tell it moved) · vague (too broad to place)";

/** Qalam AI pushing back on a piece of the dump. */
export interface DumpChallenge {
  id: string;
  kind: ChallengeKind;
  text: string;
  /** The piece it's about (a quote of the dump's source). */
  quoteId: string;
  /** The card on the board it's about. */
  cardId?: string;
}

/** What a placed brain dump amounted to, for the chat turn. */
export interface DumpCounts {
  added: number;
  attached: number;
  edited: number;
  notes: number;
}

/** How a brain dump is going, kept on its source (it survives a reload). */
export interface DumpSession {
  v: 1;
  /** reading → asking ⇄ analyzing → ready → placing → review → placed. */
  phase: "reading" | "asking" | "analyzing" | "ready" | "placing" | "review" | "placed" | "failed";
  /** The step that failed: Try again runs it again with what's kept. */
  failed?: { at: "reading" | "analyzing" | "placing"; error: string };
  /** What Qalam AI took from it, revised after each round of answers. */
  understanding: string;
  /** Pushback still open. */
  challenges: DumpChallenge[];
  /** Every round of questions so far; the last is the one being asked (or just answered). */
  buckets: PlanBucket[];
  /** The builder left the rest of the questions: placed with what's answered. */
  skipped?: boolean;
  /** The tree it was pasted beside (the card sits next to it). */
  anchor: string | null;
  /** Qalam AI's proposals still waiting on the board (a reload brings the review back). */
  proposals?: Proposal[];
  /** proposalKey()s the builder discarded: never proposed again. */
  dismissed?: string[];
  placed?: { at: number; counts: DumpCounts };
  turn?: { chatId: string; turnId: string };
  sample?: boolean;
  model?: string;
  /**
   * It answers the chat's "Help me find one": what they asked for, and the questions their answers
   * (the dump's text) are to; `goal`: the problem to focus on for a goal on the canvas (its card,
   * and its id in goals.md), placed only under it.
   */
  aim?: { find: "goal" | "problem"; asked: string[]; goal?: { card: string; id: string } };
  /** What Qalam AI looked up on the web while finding a goal's problem, each after the round it followed (-1: before the first). */
  looks?: DumpLook[];
  /** A file added for a card (its next steps' "Add a file for it"): read against that card, and placed only under it. */
  file?: DumpFile;
  /** The parts of its text that are their words, when the rest is Qalam AI's questions (a find's answers): pieces only from these. */
  within?: [number, number][];
  /** The file read as not bearing on its card: the kind of file that would help (in Qalam AI's words). */
  off?: { wanted: string };
}

/** A look on the web in a dump's conversation, after the round it followed (-1: before any). */
export type DumpLook = FocusLook & { after: number };

/** Looks on the web a goal's conversation makes after its opening one, at most. */
export const MAX_LOOKS = 2;

/** A file read for a card: its title, the card's id, and whether its words were cut to fit. */
export interface DumpFile {
  title: string;
  card: string;
  cut?: true;
}

/** The most text one brain dump takes (longer: add the rest as a source). */
export const DUMP_MAX_CHARS = 20_000;
/** Rounds of questions at most. */
export const MAX_DUMP_ROUNDS = 3;

/**
 * Pasted text that reads as someone's thinking, not a stray word, a link or data: a few sentences
 * or lines of prose. A paste on the board opens the brain dump with it only when this holds.
 */
export function looksLikeDump(text: string): boolean {
  const t = text.trim();
  if (t.length < 200 || /^[{[<]/.test(t)) return false;
  if (t.split(/\s+/).length < 25) return false;
  const breaks = t.match(/[.!?؟。]\s|\n/g)?.length ?? 0;
  return breaks >= 2;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).map(rec);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const isRole = (v: unknown): v is DumpRole => DUMP_ROLES.includes(v as DumpRole);
const isChallenge = (v: unknown): v is ChallengeKind => CHALLENGE_KINDS.includes(v as ChallengeKind);

// ---------------------------------------------------------------------------
// The board, as Qalam AI reads it beside a brain dump

/** A card as a brain dump's calls name it, and what code checks their answers against. */
export interface PlaceCard {
  /** The id the call gives it ("c3"). */
  ref: string;
  id: string;
  kind: OstKind;
  title: string;
  /** The card it hangs under, by its ref (null for a tree's root). */
  parentRef: string | null;
  /** Opportunities: how deep under their nearest outcome (1 = right under it). */
  depth: number;
  /** Outcomes: how many outcomes are above it (0 = a tree's root). */
  outcomeDepth: number;
  /** The tree it's in, by its root's id. */
  root: string;
  childTitles: string[];
  description: string;
  assumptions: string[];
  metric?: OstMetric;
  /** Screens projects were made for it (a merge never drops it). */
  designs: boolean;
}

/** "Weekly reorders per customer · 1.2 now → 1.5 orders by March": a metric in a line. */
export function metricText(m: OstMetric | undefined): string | null {
  if (!m?.name) return null;
  const now = m.current ?? m.baseline;
  const nums = [now !== null ? `${now} now` : "", m.target !== null ? `→ ${m.target}` : ""].filter(Boolean).join(" ");
  return [m.name, nums && `${nums}${m.unit ? ` ${m.unit}` : ""}`, m.timeframe].filter(Boolean).join(" · ");
}

/** The board for a brain dump's calls (refs c1…), and the cards as code checks the answers. */
export function outlineOf(doc: Doc, max = 400): { tree: DumpCardInput[]; cards: PlaceCard[] } {
  // A problem's page drawn faint on the space's canvas (`topic:…`) is on no board and holds nothing: never sent.
  const list = allCards(doc)
    .filter((c) => !c.id.startsWith("topic:"))
    .slice(0, max);
  const refOf = new Map(list.map((c, i) => [c.id, `c${i + 1}`]));
  /** How many cards of `kind` in a row, from `id` up (it included). */
  const run = (id: string | null, kind: OstKind) => {
    let n = 0;
    for (let p = id; p && isOstCard(doc.nodes[p]) && doc.nodes[p].meta.ost?.kind === kind; p = doc.nodes[p].parentId) n++;
    return n;
  };
  const cards: PlaceCard[] = list.map(({ id, card }) => {
    const parent = doc.nodes[id].parentId;
    const depth = card.kind === "opportunity" ? run(id, "opportunity") : 0;
    const outcomeDepth = card.kind === "outcome" ? run(parent, "outcome") : 0;
    return {
      ref: refOf.get(id)!,
      id,
      kind: card.kind,
      title: card.title,
      parentRef: parent ? (refOf.get(parent) ?? null) : null,
      depth,
      outcomeDepth,
      root: treeRootOf(doc, id) ?? id,
      childTitles: childCards(doc, id).map((c) => doc.nodes[c].meta.ost?.title ?? ""),
      description: card.description ?? "",
      assumptions: (card.assumptions ?? []).map((a) => a.text),
      ...(card.metric ? { metric: card.metric } : {}),
      designs: !!card.designs?.length,
    };
  });
  const tree = list.map(({ id, card }, i): DumpCardInput => {
    const backing = card.evidence.filter((e) => e.stance !== "against");
    return {
      id: cards[i].ref,
      parent: cards[i].parentRef,
      kind: card.kind,
      title: card.title.slice(0, 400),
      quotes: backing.filter((e) => e.kind === "quote").length,
      description: (card.description ?? "").slice(0, 400),
      metric: metricText(card.metric)?.slice(0, 200) ?? null,
      assumptions: (card.assumptions ?? []).slice(0, 8).map((a) => a.text.slice(0, 300)),
      words: backing.filter((e) => e.kind !== "quote").length,
      against: card.evidence.length - backing.length,
    };
  });
  return { tree, cards };
}

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A recorded answer with its "@<card title>" names swapped for the refs a call gives those cards (the sample). */
export function sampleRaw<T>(raw: T, cards: PlaceCard[]): T {
  const byTitle = new Map(cards.map((c) => [key(c.title), c.ref]));
  const swap = (v: unknown): unknown => {
    if (typeof v === "string") return v.startsWith("@") ? (byTitle.get(key(v.slice(1))) ?? v) : v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return swap(raw) as T;
}

// ---------------------------------------------------------------------------
// Read: what Qalam AI took from it, its pieces, its pushback, the first round of questions

export const READ_LIMITS = { fragments: 60, fragmentChars: 600, challenges: 8, challenge: 300, understanding: 800, wanted: 240 } as const;

export interface DumpRead {
  understanding: string;
  /** The pieces kept, in the dump's own words, in the order written. */
  fragments: SourceQuote[];
  challenges: DumpChallenge[];
  questions: PlanQuestion[];
  /** The id each piece kept was given, by the id the call named it with (f…). */
  refs: Record<string, string>;
  /** A file read for a card: false when nothing in it bears on the card (the wrong file), with the kind of file that would help. */
  bears: boolean;
  wanted: string;
}

const quoteKind = (role: DumpRole): QuoteKind => (role === "idea" || role === "test" ? "idea" : "need");

/** A piece's first few words, to name it in a sentence (the sentence brings its own full stop). */
const opening = (s: string, n = 8) => {
  const w = s.trim().split(/\s+/);
  const words = w.slice(0, n).join(" ").replace(/[.,;:!?،؛؟…]+$/u, "");
  return w.length > n ? `${words}…` : words;
};

/**
 * Qalam AI's words to the builder with the ids its call used read as what they name: a piece
 * ("f11") as its words, a card ("c3") as its title. One in brackets beside what it names goes.
 */
export function readable(v: unknown, words: (ref: string) => string | undefined): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\s*[([]\s*[fc]\d{1,3}(?:\s*[,/;]\s*[fc]\d{1,3})*\s*[)\]]/g, "")
    .replace(/\b[fc]\d{1,3}\b/g, (ref) => {
      const w = words(ref);
      return w ? `“${opening(w)}”` : ref;
    })
    .replace(/\s+([.,;:!?])/g, "$1");
}

/** Questions in words: the ids a call gave pieces and cards (f1, c6) read as what they name, in the question, its why and its options. */
function readableQuestions(qs: PlanQuestion[], names: (ref: string) => string | undefined): PlanQuestion[] {
  const say = (v: string) => readable(v, names);
  return qs.map((q) => ({ ...q, title: say(q.title), why: say(q.why), options: q.options.map((o) => ({ ...o, label: say(o.label), description: say(o.description) })) }));
}

/** What a call named, by the ids it used: the pieces' words and the cards' titles. */
const namesOf = (pieces: Iterable<[string, string]>, cards: PlaceCard[]) => {
  const m = new Map([...pieces, ...cards.map((c): [string, string] => [c.ref, c.title])]);
  return (ref: string) => m.get(ref);
};

/** Pushback, kept only where it's about a piece that was kept (and a card on the board, when it names one). */
function sanitizeChallenges(raw: unknown, pieceOf: (ref: string) => string | undefined, cards: PlaceCard[], names: (ref: string) => string | undefined): DumpChallenge[] {
  const byRef = new Map(cards.map((c) => [c.ref, c.id]));
  const seen = new Set<string>();
  const out: DumpChallenge[] = [];
  for (const c of items(raw)) {
    if (out.length >= READ_LIMITS.challenges) break;
    const quoteId = pieceOf(String(c.fragmentId));
    const text = clip(readable(c.text, names), READ_LIMITS.challenge);
    if (!isChallenge(c.kind) || !quoteId || !text || seen.has(`${c.kind}:${quoteId}`)) continue;
    seen.add(`${c.kind}:${quoteId}`);
    const cardId = typeof c.cardId === "string" ? byRef.get(c.cardId) : undefined;
    out.push({ id: newId(), kind: c.kind, text, quoteId, ...(cardId ? { cardId } : {}) });
  }
  return out;
}

/** What Qalam AI read in a brain dump, kept only where it holds: each piece found in the builder's words. */
export function sanitizeRead(raw: unknown, text: string, cards: PlaceCard[], now = Date.now(), within?: readonly [number, number][], file = false): DumpRead {
  const r = rec(raw);
  const find = quoteFinder(text);
  const kept = new Map<string, string>();
  const said = new Map<string, string>();
  const fragments: SourceQuote[] = [];
  for (const f of items(r.fragments)) {
    if (fragments.length >= READ_LIMITS.fragments || typeof f.quote !== "string") continue;
    const m = find(f.quote);
    if (!m || m.words.length > READ_LIMITS.fragmentChars) continue;
    // Only their words: a piece of a question Qalam AI asked isn't theirs.
    if (within && !within.some(([a, b]) => m.span[0] >= a && m.span[1] <= b)) continue;
    // Pieces never overlap: the first one written keeps the words.
    if (fragments.some((x) => x.span[0] < m.span[1] && m.span[0] < x.span[1])) continue;
    const role: DumpRole = isRole(f.role) ? f.role : "context";
    // A file's piece says what it rests on, as far as code can hold it; their thinking's words are theirs.
    const basis = file && isBasis(f.basis) ? heldBasis(f.basis, m.words) : undefined;
    const q: SourceQuote = { id: newId(), text: m.words, span: m.span, ...(m.parts.length > 1 ? { parts: m.parts } : {}), kind: quoteKind(role), ...(basis && basis !== "own" ? { basis } : {}), role, addedBy: "ai", at: now };
    const ref = clip(f.id, 24);
    if (ref && !kept.has(ref)) {
      kept.set(ref, q.id);
      said.set(ref, q.text);
    }
    fragments.push(q);
  }
  fragments.sort((a, b) => a.span[0] - b.span[0]);
  const names = namesOf(said, cards);
  return {
    understanding: clip(readable(r.understanding, names), READ_LIMITS.understanding),
    fragments,
    challenges: sanitizeChallenges(r.challenges, (ref) => kept.get(ref), cards, names),
    questions: readableQuestions(sanitizeQuestions(r.questions), names),
    refs: Object.fromEntries(kept),
    bears: r.bears !== false,
    wanted: clip(readable(r.wanted, names), READ_LIMITS.wanted),
  };
}

// ---------------------------------------------------------------------------
// Rounds of questions

/** The first round, ready to ask (none: nothing to ask). */
export const firstRound = (questions: PlanQuestion[]): PlanBucket[] => (questions.length ? [{ questions, form: initialFlow(questions.map(toQuestion)) }] : []);

/** The pieces as a call names them: f1… in the order written. */
export function fragmentRefs(quotes: SourceQuote[]): { ref: string; q: SourceQuote }[] {
  return [...quotes].sort((a, b) => a.span[0] - b.span[0]).map((q, i) => ({ ref: `f${i + 1}`, q }));
}

/** What rounds of questions keep on a session: a board's brain dump, or an organization's setup (src/org/setup.ts). */
export type Rounds = Pick<DumpSession, "understanding" | "challenges" | "buckets" | "skipped" | "failed"> & { phase: string };

/**
 * The builder is done with the current round: answered it (Qalam AI reads the answers next) or
 * left the rest to Qalam AI (it places what it has).
 */
export function closeDumpRound<S extends Rounds>(s: S, form: FlowState, how: "analyzing" | "skipped"): S {
  const last = s.buckets.length - 1;
  const buckets = s.buckets.map((b, i) => (i === last ? { ...b, form } : b));
  return { ...s, buckets, failed: undefined, ...(how === "skipped" ? { phase: "ready", skipped: true } : { phase: "analyzing" }) } as S;
}

export interface DumpFollowup {
  analysis: string;
  understanding: string;
  /** Pieces whose role the answers changed. */
  roles: { quoteId: string; role: DumpRole }[];
  challenges: DumpChallenge[];
  ready: boolean;
  questions: PlanQuestion[];
  /** What it wants looked up on the web before its next round ("": nothing). */
  look: string;
}

/** What Qalam AI made of a round of answers, checked: roles and pushback only on pieces that were sent. */
export function sanitizeDumpFollowup(raw: unknown, pieces: { ref: string; q: SourceQuote }[], cards: PlaceCard[]): DumpFollowup {
  const r = rec(raw);
  const byRef = new Map(pieces.map((p) => [p.ref, p.q.id]));
  const roles = new Map<string, DumpRole>();
  for (const x of items(r.roles)) {
    const quoteId = byRef.get(String(x.fragmentId));
    if (quoteId && isRole(x.role)) roles.set(quoteId, x.role);
  }
  const names = namesOf(pieces.map((p): [string, string] => [p.ref, p.q.text]), cards);
  const questions = readableQuestions(sanitizeQuestions(r.questions), names);
  return {
    analysis: clip(readable(r.analysis, names), 1200),
    understanding: clip(readable(r.understanding, names), READ_LIMITS.understanding),
    roles: [...roles].map(([quoteId, role]) => ({ quoteId, role })),
    challenges: sanitizeChallenges(r.challenges, (ref) => byRef.get(ref), cards, names),
    // Ready means no more questions; questions without a round to put them in mean ready too.
    ready: r.ready === true || !questions.length,
    questions,
    look: clip(readable(r.look, names), 200),
  };
}

/** What a round of answers changed: its reading kept with it, the reading revised, and the next round or ready. */
export function applyDumpFollowup<S extends Rounds>(s: S, f: DumpFollowup): S {
  const more = !f.ready && f.questions.length > 0 && s.buckets.length < MAX_DUMP_ROUNDS;
  const last = s.buckets.length - 1;
  const read = s.buckets.map((b, i) => (i === last ? { ...b, analysis: f.analysis || undefined } : b));
  return {
    ...s,
    understanding: f.understanding || s.understanding,
    challenges: f.challenges,
    failed: undefined,
    phase: more ? "asking" : "ready",
    buckets: more ? [...read, { questions: f.questions, form: initialFlow(f.questions.map(toQuestion)) }] : read,
  } as S;
}

/** The pieces with the roles the answers gave them. */
export const withRoles = (quotes: SourceQuote[], roles: DumpFollowup["roles"]): SourceQuote[] =>
  quotes.map((q) => {
    const role = roles.find((r) => r.quoteId === q.id)?.role;
    return role ? { ...q, role, kind: quoteKind(role) } : q;
  });

/** What the builder typed themselves (not an option Qalam AI wrote): the only answer words a card may rest on. */
function typed(q: Question, a: Answer): string {
  if (a.kind === "text") return a.text.trim();
  if (a.kind === "single" && a.value === OTHER) return a.other?.trim() ?? "";
  if (a.kind === "multi") return a.custom.join("; ");
  return "";
}

/** What they said to a question: the choice they picked (its label, never its description) or what they typed. */
function picked(q: Question, a: Answer): string {
  if (a.kind === "text") return a.text.trim();
  if (a.kind === "single" && q.kind === "single") return a.value === OTHER ? (a.other?.trim() ?? "") : (q.options.find((o) => o.value === a.value)?.label ?? "");
  if (a.kind === "multi" && q.kind === "multi") return [...q.groups.flatMap((g) => g.options.filter((o) => a.values.includes(o.value)).map((o) => o.label)), ...a.custom].join("; ");
  return "";
}

/** One answer of a round: its question, the answer in words, and the words the builder typed. */
export interface DumpAnswer {
  questionId: string;
  question: string;
  answer: string;
  words: string;
  /** What they said, in their words or the choice they picked (for the source's text). */
  said?: string;
}

/** Each round's answers (the round being asked included, once answered). */
export function roundAnswers(s: Pick<Rounds, "buckets">): DumpAnswer[][] {
  return s.buckets.map((b) => {
    const qs = b.questions.map(toQuestion);
    // A round counts once it was sent; one left half-way (Skip) counts for what was answered.
    const asked = b.form.submitted ? qs : qs.filter((q) => b.form.answers[q.id]);
    const answers = resolvedAnswers(qs, b.form.answers);
    return asked.map((q) => ({ questionId: q.id, question: q.title, answer: answerText(q, answers[q.id]).slice(0, 600), words: typed(q, answers[q.id]).slice(0, 600), said: picked(q, answers[q.id]).slice(0, 600) }));
  });
}

/**
 * A round's questions and their answers, added to the end of the dump's text so the source reads
 * on its own (what Qalam AI asked, under a heading, then each question and its answer); nothing is
 * added past what a dump takes. Its pieces stay where they were.
 */
export function withRound(text: string, blocks: readonly TextBlock[], answers: readonly DumpAnswer[], round: number): { text: string; blocks: TextBlock[] } {
  const said = answers.map((a) => ({ question: a.question, text: (a.said ?? a.answer).trim() })).filter((a) => a.text && a.text !== "No preference");
  if (!said.length) return { text, blocks: [...blocks] };
  const head = `Qalam AI asked, and you answered (round ${round}):`;
  let out = `${text.trimEnd()}\n\n`;
  const added: TextBlock[] = [{ kind: "h2", span: [out.length, out.length + head.length] }];
  out += head;
  for (const a of said) {
    const q = a.question.replace(/\s+/g, " ").trim();
    out += `\n\n${q}\n`;
    added.push({ kind: "h3", span: [out.length - q.length - 1, out.length - 1] });
    out += a.text;
  }
  if (out.length > DUMP_MAX_CHARS) return { text, blocks: [...blocks] };
  return { text: out, blocks: [...blocks, ...added] };
}

/** A look on the web goes onto the source's text after what's there, so it reads on its own: what was looked up, and what the pages say, each with where. */
export function withLook(text: string, blocks: readonly TextBlock[], look: Pick<FocusLook, "query" | "lines">): { text: string; blocks: TextBlock[] } {
  if (!look.lines.length) return { text, blocks: [...blocks] };
  const head = lookHead(look);
  const start = `${text.trimEnd()}\n\n`;
  const out = `${start}${head}\n${lookLines(look).join("\n")}`;
  if (out.length > DUMP_MAX_CHARS) return { text, blocks: [...blocks] };
  return { text: out, blocks: [...blocks, { kind: "h2", span: [start.length, start.length + head.length] }] };
}

/** The answers as the builder's own words for the Library (Product context), ids `dump:<source>:<question>`. */
export function briefFromDump(sourceId: string, s: DumpSession, now: number): BriefAnswer[] {
  return roundAnswers(s)
    .flat()
    .filter((a) => a.answer && a.answer !== "No preference")
    .map((a) => ({ id: `dump:${sourceId}:${a.questionId}`, topic: "other" as const, question: a.question.slice(0, 400), answer: a.answer.slice(0, 600), screenIds: [], at: now }));
}
