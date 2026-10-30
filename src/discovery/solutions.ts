import { wordsHold, withoutIds } from "@/goals/said";
import { checkWords, cleanLine, sameTopic, sameWords, SECTION_HEADING, type TopicSection } from "@/hub/topics";
import { quoteFinder } from "./quotes";
import { ASSUMPTION_CATEGORIES } from "./kinds";
import { newCard } from "./ops";
import type { Backing, QuoteRef } from "./proposals";
import type { AssumptionCategory, OstAssumption, OstCard, OstEvidence } from "./types";

/*
 * Drafting solutions for a problem (pure): Qalam AI reads the problem's page (its lines and the
 * words they rest on), the goals it bears on, what others report for them, what the product does
 * today, what's already on the board under it and the person's own ideas, and proposes a few ways
 * to solve it. Each comes with what has to be true for it to work (its riskiest assumptions) and
 * one test of the riskiest. Code keeps a draft only when it rests on the problem's own lines or
 * words, its quoted words and numbers are in what was sent, it isn't on the board already, and one
 * built on the person's idea is in their words. A test's pass line is never kept as fact: its
 * numbers are Qalam AI's suggestion, and only the person sets the bar.
 */

export const SOLUTION_LIMITS = { solutions: 4, enough: 2, assumptions: 4, lines: 16, pieces: 20, goals: 4, claims: 6, steps: 8, cards: 12, ideas: 8, title: 90, description: 420, assumption: 240, what: 160, how: 360, pass: 240, note: 480 } as const;

export interface SolutionsInput {
  problem: { title: string; topic: string | null };
  /** The problem page's lines (none: a card with no page; its own evidence is the pieces). */
  lines: { id: string; section: TopicSection; text: string; cites: string[] }[];
  /** The words its lines rest on (or a card's own evidence): customers' and the team's. */
  pieces: { ref: string; text: string; label: string; source: string | null; evidence: boolean }[];
  /** The goals it bears on, and how it moves each. */
  goals: { id: string; title: string; metric: string | null; how: string | null }[];
  /** What others report for those goals: never evidence, context for what's been tried. */
  claims: { id: string; who: string; what: string; quote: string }[];
  /** What the product does today, from its code. */
  steps: { ref: string; flow: string; title: string; events: string[] }[];
  /** What's on the board under the problem already. */
  cards: { title: string; kind: "solution" | "test" }[];
  /** The person's own ideas (a brain dump's ideas). */
  ideas: { ref: string; text: string; source: string | null; label: string }[];
}

type Line = SolutionsInput["lines"][number];
type Piece = SolutionsInput["pieces"][number];
type Idea = SolutionsInput["ideas"][number];

export interface SolutionsSent {
  text: string;
  lines: Map<string, Line>;
  pieces: Map<string, Piece>;
  goals: Map<string, SolutionsInput["goals"][number]>;
  claims: Map<string, SolutionsInput["claims"][number]>;
  steps: Map<string, SolutionsInput["steps"][number]>;
  ideas: Map<string, Idea>;
  cards: SolutionsInput["cards"];
  /** Every word it was sent: what a draft's quoted words and numbers must come from. */
  hay: string;
}

export interface DraftAssumption {
  id: string;
  category: AssumptionCategory;
  text: string;
  importance: 1 | 2 | 3;
}

export interface DraftTest {
  /** The assumption it tests (one of the draft's own). */
  assumption: string;
  /** What to try, as a test card's title. */
  what: string;
  /** How, in a sentence or two. */
  how: string;
  /** Qalam AI's pass line, numbers and all: a suggestion the person sets for themselves. */
  suggested: string | null;
}

export interface SolutionDraft {
  id: string;
  title: string;
  description: string;
  /** What it rests on, as the page and the organization name them. */
  cites: { lines: string[]; pieces: string[]; goals: string[]; claims: string[]; steps: string[] };
  /** The person's own idea it builds on (in their words). */
  idea: { ref: string; text: string; source: string | null } | null;
  assumptions: DraftAssumption[];
  test: DraftTest | null;
  at: number;
}

/** A problem's drafts and what was decided about them (hub/solutions/<topic>.json). */
export interface SolutionsFile {
  qalam: "solutions/1";
  topic: string;
  at: number;
  model?: string;
  note: string;
  drafts: SolutionDraft[];
  decided: Record<string, "accepted" | "discarded">;
}

/** A draft call's answer as code kept it, with where the words its drafts rest on live (by piece). */
export interface Drafted {
  topic: string | null;
  drafts: SolutionDraft[];
  note: string;
  quotes: Record<string, QuoteRef>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The material, each item with the id the call cites it by: the page's lines (l…) and the words
 * they rest on (q…), the goals (g…), what others report (c…), the product's steps (m…) and the
 * person's ideas (i…). Customers' words first.
 */
export function solutionsMaterial(o: SolutionsInput): SolutionsSent {
  const out: string[] = [`The problem: “${one(o.problem.title)}”`];
  const lines = new Map<string, Line>();
  if (o.lines.length) {
    out.push("", "What its page says (id · section · line):");
    const order: TopicSection[] = ["know", "believe", "against", "open"];
    for (const l of [...o.lines].sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section)).slice(0, SOLUTION_LIMITS.lines)) {
      const id = `l${lines.size + 1}`;
      lines.set(id, l);
      out.push(`- ${id} · ${SECTION_HEADING[l.section]} · ${one(l.text)}`);
    }
  }
  const pieces = new Map<string, Piece>();
  const cited = [...o.pieces.filter((p) => p.evidence), ...o.pieces.filter((p) => !p.evidence)].slice(0, SOLUTION_LIMITS.pieces);
  out.push("", "The words it rests on (id · whose · where · words):");
  for (const p of cited) {
    const id = `q${pieces.size + 1}`;
    pieces.set(id, p);
    out.push(`- ${id} · ${p.evidence ? "customers" : "the team"} · ${one(p.label)} · “${one(p.text)}”`);
  }
  if (!pieces.size) out.push("(no words yet: it rests on what the team believes)");

  const goals = new Map<string, SolutionsInput["goals"][number]>();
  if (o.goals.length) {
    out.push("", "The goals it bears on (id · goal · its number · how the problem moves it):");
    for (const g of o.goals.slice(0, SOLUTION_LIMITS.goals)) {
      const id = `g${goals.size + 1}`;
      goals.set(id, g);
      out.push(`- ${id} · ${one(g.title)} · ${g.metric ? one(g.metric) : "no number yet"}${g.how ? ` · ${one(g.how)}` : ""}`);
    }
  }
  const claims = new Map<string, SolutionsInput["claims"][number]>();
  if (o.claims.length) {
    out.push("", "What others report for those goals (id · who · what · their words). It's context, never evidence about these customers:");
    for (const c of o.claims.slice(0, SOLUTION_LIMITS.claims)) {
      const id = `c${claims.size + 1}`;
      claims.set(id, c);
      out.push(`- ${id} · ${one(c.who)} · ${one(c.what)} · “${one(c.quote)}”`);
    }
  }
  const steps = new Map<string, SolutionsInput["steps"][number]>();
  if (o.steps.length) {
    out.push("", "What the product does today, from its code (id · flow · step · events it sends):");
    for (const s of o.steps.slice(0, SOLUTION_LIMITS.steps)) {
      const id = `m${steps.size + 1}`;
      steps.set(id, s);
      out.push(`- ${id} · ${one(s.flow)} · ${one(s.title)}${s.events.length ? ` · ${s.events.slice(0, 4).join(", ")}` : ""}`);
    }
  }
  const ideas = new Map<string, Idea>();
  if (o.ideas.length) {
    out.push("", "The person's own ideas (id · their words). Build on one in its own words when it fits:");
    for (const i of o.ideas.slice(0, SOLUTION_LIMITS.ideas)) {
      const id = `i${ideas.size + 1}`;
      ideas.set(id, i);
      out.push(`- ${id} · “${one(i.text)}”`);
    }
  }
  const cards = o.cards.slice(0, SOLUTION_LIMITS.cards);
  if (cards.length) out.push("", "On the board under it already (don't propose these again):", ...cards.map((c) => `- ${c.kind === "solution" ? "Solution" : "Test"}: ${one(c.title)}`));
  const text = out.join("\n");
  // What words and numbers may come from: the material without its ids ("q5" isn't a 5 anyone said).
  return { text, lines, pieces, goals, claims, steps, ideas, cards, hay: text.replace(/(^|\s)[lqgcmi]\d+ ·/gm, "$1") };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : []);
/** A number outside quotes, or a quote whole (its numbers are the quote's). */
const OWN_NUMBER = /(“[^”]*”)|\d+(?:[.,]\d+)*/g;

/**
 * What a drafted line may say, as code keeps it: its ids read as what they stand for, its quoted
 * words and numbers found in what was sent. A test is a plan: its own numbers (how many people,
 * what counts as a pass) are Qalam AI's suggestion, and wording it puts in quotes that nobody said
 * is wording it proposes (‘…’), never someone's words. Null: it says what wasn't sent.
 */
export function draftWords(hay: string, name: (ref: string) => string | undefined, letters: string) {
  const find = quoteFinder(hay);
  return (v: unknown, max: number, plan = false): string | null => {
    let text = withoutIds(v, name, letters);
    if (plan) text = text.replace(/“([^”]+)”/g, (all, said: string) => (find(said.trim(), Math.min(8, said.trim().length)) ? all : `‘${said}’`));
    // Its own numbers aren't checked; a quote's are, as part of the quote.
    const masked = plan ? text.replace(OWN_NUMBER, (_n, quote?: string) => quote ?? "#") : text;
    return checkWords(masked, [], hay, max) ? cleanLine(text) : null;
  };
}

/**
 * What code keeps of the answer: at most so many drafts it can stand behind, none on the board
 * already, each with its assumptions and a test of one of them. `dropped` hears what was left out
 * and why (for the call's trace).
 */
export function sanitizeSolutions(raw: unknown, m: SolutionsSent, o: { now: number; id: () => string }, dropped?: (why: string, item: unknown) => void): { drafts: SolutionDraft[]; note: string } {
  const drafts: SolutionDraft[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  // An id in what it wrote reads as what it stands for: a goal's title, a step's, whose words; lines and quotes go.
  const name = (ref: string) => m.goals.get(ref)?.title ?? m.steps.get(ref)?.title ?? m.claims.get(ref)?.who;
  const words = draftWords(m.hay, name, "lqgcmi");
  for (const x of Array.isArray(rec(raw).solutions) ? (rec(raw).solutions as unknown[]) : []) {
    if (drafts.length >= SOLUTION_LIMITS.solutions) {
      drop("over the limit", x);
      continue;
    }
    const s = rec(x);
    const title = words(s.title, SOLUTION_LIMITS.title);
    const description = words(s.description, SOLUTION_LIMITS.description);
    if (!title || !description) {
      drop("its words or numbers aren't in what was sent", x);
      continue;
    }
    const refs = strs(s.cites);
    const lines = refs.filter((r) => m.lines.has(r));
    const own = refs.filter((r) => m.pieces.has(r));
    if (!lines.length && !own.length) {
      drop("it rests on nothing the problem says", x);
      continue;
    }
    if (m.cards.some((c) => sameTopic(c.title, title)) || drafts.some((d) => sameTopic(d.title, title))) {
      drop("on the board already, or proposed twice", x);
      continue;
    }
    // Their idea, only where the draft is in their words.
    const ideaRef = typeof s.idea === "string" ? s.idea.trim() : "";
    const theirs = m.ideas.get(ideaRef);
    const idea = theirs && wordsHold(title, theirs.text) ? { ref: theirs.ref, text: theirs.text, source: theirs.source } : null;
    if (theirs && !idea) drop("an idea of theirs not in their words: kept as Qalam AI's", x);

    const assumptions: DraftAssumption[] = [];
    const kept = new Map<number, string>();
    (Array.isArray(s.assumptions) ? s.assumptions.map(rec) : []).forEach((a, i) => {
      if (assumptions.length >= SOLUTION_LIMITS.assumptions) return;
      const category = ASSUMPTION_CATEGORIES.find((c) => c === a.category);
      const text = words(a.text, SOLUTION_LIMITS.assumption);
      if (!category || !text || assumptions.some((y) => sameWords(y.text) === sameWords(text))) return;
      const importance = a.importance === "1" ? 1 : a.importance === "2" ? 2 : 3;
      const id = o.id();
      kept.set(i + 1, id);
      assumptions.push({ id, category, text, importance });
    });
    if (!assumptions.length) {
      drop("no assumption it can stand behind", x);
      continue;
    }

    const t = rec(s.test);
    const what = words(t.what, SOLUTION_LIMITS.what, true);
    const how = words(t.how, SOLUTION_LIMITS.how, true);
    const pass = words(t.pass, SOLUTION_LIMITS.pass, true);
    // The one it names, if kept; else the riskiest.
    const riskiest = [...assumptions].sort((a, b) => b.importance - a.importance)[0];
    const named = kept.get(Number(typeof t.assumption === "string" ? t.assumption : NaN));
    const test: DraftTest | null = what && how ? { assumption: named ?? riskiest.id, what, how, suggested: pass } : null;
    if (!test) drop("its test's words or numbers aren't in what was sent: kept without one", x);

    // The words it rests on: those it cites, then those behind the lines it answers.
    const sentRefs = new Set([...m.pieces.values()].map((p) => p.ref));
    const pieces = [...new Set([...own.map((r) => m.pieces.get(r)!.ref), ...lines.flatMap((r) => m.lines.get(r)!.cites.filter((c) => sentRefs.has(c)))])];
    drafts.push({
      id: o.id(),
      title,
      description,
      cites: {
        lines: lines.map((r) => m.lines.get(r)!.id),
        pieces,
        goals: refs.filter((r) => m.goals.has(r)).map((r) => m.goals.get(r)!.id),
        claims: refs.filter((r) => m.claims.has(r)).map((r) => m.claims.get(r)!.id),
        steps: refs.filter((r) => m.steps.has(r)).map((r) => m.steps.get(r)!.ref),
      },
      idea,
      assumptions,
      test,
      at: o.now,
    });
  }
  const said = withoutIds(rec(raw).note, name, "lqgcmi");
  const note = (said && checkWords(said, [], m.hay, SOLUTION_LIMITS.note) ? cleanLine(said) : "").trim();
  const short = drafts.length < SOLUTION_LIMITS.enough ? (drafts.length ? "Qalam AI found only one way it could stand behind." : "Qalam AI found no way it could stand behind.") : "";
  return { drafts, note: [note, short].filter(Boolean).join(" ") };
}

// ---------------------------------------------------------------------------
// A draft as cards

/**
 * The words a draft rests on, as the board attaches them: the problem's quotes (by where they live)
 * and the person's idea (their own words).
 */
export function draftBacking(d: SolutionDraft, quoteOf: (pieceRef: string) => QuoteRef | null, now: number, newId: () => string): Backing {
  const quotes: QuoteRef[] = [];
  for (const ref of d.cites.pieces) {
    const q = quoteOf(ref);
    if (q && !quotes.some((x) => x.sourceId === q.sourceId && x.quoteId === q.quoteId)) quotes.push(q);
  }
  const ideaQuote = d.idea ? quoteOf(d.idea.ref) : null;
  if (ideaQuote && !quotes.some((x) => x.quoteId === ideaQuote.quoteId)) quotes.push(ideaQuote);
  const words: OstEvidence[] = d.idea && !ideaQuote ? [{ id: newId(), kind: "dump", text: d.idea.text, ...(d.idea.source ? { sourceId: d.idea.source } : {}), addedBy: "ai", at: now }] : [];
  return { quotes, words };
}

/** A draft's solution card (with its assumptions), and its test card when it has one. */
export function draftCards(d: SolutionDraft): { solution: OstCard; test: OstCard | null } {
  const assumptions: OstAssumption[] = d.assumptions.map((a) => ({ id: a.id, category: a.category, text: a.text, importance: a.importance, addedBy: "ai" }));
  // Their idea is theirs: the card says who drafted it.
  const solution = newCard("solution", { title: d.title, description: d.description, createdBy: d.idea ? "user" : "ai", assumptions });
  const test = d.test ? newCard("test", { title: d.test.what, createdBy: "ai", test: { assumptionIds: [d.test.assumption], method: d.test.how, ...(d.test.suggested ? { suggested: { criterion: d.test.suggested } } : {}) } }) : null;
  return { solution, test };
}
