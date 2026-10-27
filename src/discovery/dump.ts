import { newId } from "@/doc/factory";
import type { BriefAnswer, Doc } from "@/doc/schema";
import { isOstCard, treeRootOf } from "@/doc/board";
import type { DumpCardInput } from "@/ai/discovery";
import type { PlanQuestion } from "@/ai/plan";
import { answerText, sanitizeQuestions, toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { OTHER, initialFlow, resolvedAnswers, type Answer, type FlowState, type Question } from "@/ui/ai/questionFlow";
import { quoteFinder } from "./quotes";
import type { QuoteKind, SourceQuote } from "./sources";
import { allCards, childCards } from "./tree";
import type { OstKind, OstMetric } from "./types";
import type { Proposal } from "./proposals";

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
  conflict: "Conflicts with the board",
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
  const list = allCards(doc).slice(0, max);
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

export const READ_LIMITS = { fragments: 60, fragmentChars: 600, challenges: 8, challenge: 300, understanding: 800 } as const;

export interface DumpRead {
  understanding: string;
  /** The pieces kept, in the dump's own words, in the order written. */
  fragments: SourceQuote[];
  challenges: DumpChallenge[];
  questions: PlanQuestion[];
}

const quoteKind = (role: DumpRole): QuoteKind => (role === "idea" || role === "test" ? "idea" : "need");

/** Pushback, kept only where it's about a piece that was kept (and a card on the board, when it names one). */
function sanitizeChallenges(raw: unknown, pieceOf: (ref: string) => string | undefined, cards: PlaceCard[]): DumpChallenge[] {
  const byRef = new Map(cards.map((c) => [c.ref, c.id]));
  const seen = new Set<string>();
  const out: DumpChallenge[] = [];
  for (const c of items(raw)) {
    if (out.length >= READ_LIMITS.challenges) break;
    const quoteId = pieceOf(String(c.fragmentId));
    const text = clip(c.text, READ_LIMITS.challenge);
    if (!isChallenge(c.kind) || !quoteId || !text || seen.has(`${c.kind}:${quoteId}`)) continue;
    seen.add(`${c.kind}:${quoteId}`);
    const cardId = typeof c.cardId === "string" ? byRef.get(c.cardId) : undefined;
    out.push({ id: newId(), kind: c.kind, text, quoteId, ...(cardId ? { cardId } : {}) });
  }
  return out;
}

/** What Qalam AI read in a brain dump, kept only where it holds: each piece found in the builder's words. */
export function sanitizeRead(raw: unknown, text: string, cards: PlaceCard[], now = Date.now()): DumpRead {
  const r = rec(raw);
  const find = quoteFinder(text);
  const kept = new Map<string, string>();
  const fragments: SourceQuote[] = [];
  for (const f of items(r.fragments)) {
    if (fragments.length >= READ_LIMITS.fragments || typeof f.quote !== "string") continue;
    const m = find(f.quote);
    if (!m || m.words.length > READ_LIMITS.fragmentChars) continue;
    // Pieces never overlap: the first one written keeps the words.
    if (fragments.some((x) => x.span[0] < m.span[1] && m.span[0] < x.span[1])) continue;
    const role: DumpRole = isRole(f.role) ? f.role : "context";
    const q: SourceQuote = { id: newId(), text: m.words, span: m.span, ...(m.parts.length > 1 ? { parts: m.parts } : {}), kind: quoteKind(role), role, addedBy: "ai", at: now };
    const ref = clip(f.id, 24);
    if (ref && !kept.has(ref)) kept.set(ref, q.id);
    fragments.push(q);
  }
  fragments.sort((a, b) => a.span[0] - b.span[0]);
  return {
    understanding: clip(r.understanding, READ_LIMITS.understanding),
    fragments,
    challenges: sanitizeChallenges(r.challenges, (ref) => kept.get(ref), cards),
    questions: sanitizeQuestions(r.questions),
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

/**
 * The builder is done with the current round: answered it (Qalam AI reads the answers next) or
 * left the rest to Qalam AI (it places what it has).
 */
export function closeDumpRound(s: DumpSession, form: FlowState, how: "analyzing" | "skipped"): DumpSession {
  const last = s.buckets.length - 1;
  const buckets = s.buckets.map((b, i) => (i === last ? { ...b, form } : b));
  return { ...s, buckets, failed: undefined, ...(how === "skipped" ? { phase: "ready", skipped: true } : { phase: "analyzing" }) };
}

export interface DumpFollowup {
  analysis: string;
  understanding: string;
  /** Pieces whose role the answers changed. */
  roles: { quoteId: string; role: DumpRole }[];
  challenges: DumpChallenge[];
  ready: boolean;
  questions: PlanQuestion[];
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
  const questions = sanitizeQuestions(r.questions);
  return {
    analysis: clip(r.analysis, 1200),
    understanding: clip(r.understanding, READ_LIMITS.understanding),
    roles: [...roles].map(([quoteId, role]) => ({ quoteId, role })),
    challenges: sanitizeChallenges(r.challenges, (ref) => byRef.get(ref), cards),
    // Ready means no more questions; questions without a round to put them in mean ready too.
    ready: r.ready === true || !questions.length,
    questions,
  };
}

/** What a round of answers changed: its reading kept with it, the reading revised, and the next round or ready. */
export function applyDumpFollowup(s: DumpSession, f: DumpFollowup): DumpSession {
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
  };
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

/** One answer of a round: its question, the answer in words, and the words the builder typed. */
export interface DumpAnswer {
  questionId: string;
  question: string;
  answer: string;
  words: string;
}

/** Each round's answers (the round being asked included, once answered). */
export function roundAnswers(s: DumpSession): DumpAnswer[][] {
  return s.buckets.map((b) => {
    const qs = b.questions.map(toQuestion);
    // A round counts once it was sent; one left half-way (Skip) counts for what was answered.
    const asked = b.form.submitted ? qs : qs.filter((q) => b.form.answers[q.id]);
    const answers = resolvedAnswers(qs, b.form.answers);
    return asked.map((q) => ({ questionId: q.id, question: q.title, answer: answerText(q, answers[q.id]).slice(0, 600), words: typed(q, answers[q.id]).slice(0, 600) }));
  });
}

/** The answers as the builder's own words for the Library (Product context), ids `dump:<source>:<question>`. */
export function briefFromDump(sourceId: string, s: DumpSession, now: number): BriefAnswer[] {
  return roundAnswers(s)
    .flat()
    .filter((a) => a.answer && a.answer !== "No preference")
    .map((a) => ({ id: `dump:${sourceId}:${a.questionId}`, topic: "other" as const, question: a.question.slice(0, 400), answer: a.answer.slice(0, 600), screenIds: [], at: now }));
}
