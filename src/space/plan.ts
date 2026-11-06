import type { PlanQuestion } from "@/ai/plan";
import { hostOf } from "@/ai/research-shared";
import { isOstCard } from "@/doc/board";
import type { Doc } from "@/doc/schema";
import type { Basis } from "@/discovery/basis";
import { ASSUMPTION_CATEGORIES } from "@/discovery/kinds";
import { newCard } from "@/discovery/ops";
import type { Proposal, QuoteRef } from "@/discovery/proposals";
import { cameFrom, draftWords, whose } from "@/discovery/solutions";
import { SOLUTION_TYPES, type AssumptionCategory, type Came, type OstAssumption, type OstCard, type OstEvidence, type OstHelpTarget, type SolutionType } from "@/discovery/types";
import type { FocusLook } from "@/goals/focus";
import { withoutIds } from "@/goals/said";
import { holdWords, sameTopic, valuesIn } from "@/hub/topics";
import { sanitizeAsked } from "@/ui/ai/plan";
import type { SpaceThing } from "./compose";

/*
 * Working something out as a plan, in the canvas's chat (src/ui/space/chat/; pure): someone asks what
 * to build, what to do about a goal, what comes next. Qalam AI reads the canvas, looks on the web,
 * asks what would change its answer, looks again where the answers call for it, then proposes cards
 * for the canvas: goals, problems and solutions of any type, a New product with its modules, and the
 * other problems each solution helps. Evidence is better when there is some, but none is asked for:
 * a card resting on nothing says where it came from. What's checked is what a card shows: a quote or a
 * number that isn't in what was sent comes out, and ids only count when they were sent. It adds and
 * links, never deletes or rewords: nothing lands until it's accepted.
 */

export const PLAN_LIMITS = { rounds: 3, looks: 2, query: 200, said: 4000, outline: 80, words: 40, pieces: 30, goals: 3, problems: 6, solutionsPer: 3, modules: 8, cards: 24, assumptions: 3, title: 100, description: 420, why: 240, how: 120, assumption: 240, what: 120, testHow: 360, pass: 240, doubt: 240, metric: 80 } as const;

/** A card on the canvas as a plan is told about it. `topic`: a problem's page; `faint`: only a page so far. */
export interface OutlineCard {
  id: string;
  kind: "outcome" | "opportunity" | "solution";
  title: string;
  parent: string | null;
  topic?: string;
  faint?: boolean;
  type?: SolutionType;
  metric?: string;
}

/** A look, with the round it came after (-1: before the first). */
export type PlanLook = FocusLook & { after: number };

/** A round of questions, once answered with what they said (by question id). */
export interface PlanRound {
  questions: PlanQuestion[];
  answers?: Record<string, string>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string").map((x) => x.trim());
const word = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The cards on the canvas, goals and problems first, as a plan is told about them. A test is left out: nothing hangs under one. */
export function planOutline(doc: Doc, things: ReadonlyMap<string, SpaceThing>): OutlineCard[] {
  const out: OutlineCard[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (!isOstCard(n)) continue;
    const c = n.meta.ost;
    if (c.kind === "test") continue;
    const t = things.get(n.id);
    const metric = c.kind === "outcome" && c.metric ? [c.metric.name, c.metric.target !== null ? `target ${c.metric.target}${c.metric.unit ? ` ${c.metric.unit}` : ""}` : ""].filter(Boolean).join(": ") : "";
    out.push({ id: n.id, kind: c.kind, title: c.title, parent: n.parentId ?? null, ...(t?.type === "problem" ? { topic: t.topic, faint: true } : {}), ...(c.solutionType ? { type: c.solutionType } : {}), ...(metric ? { metric } : {}) });
  }
  const order = { outcome: 0, opportunity: 1, solution: 2 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, PLAN_LIMITS.outline);
}

const KIND_WORD = { outcome: "Goal", opportunity: "Problem", solution: "Solution" } as const;

/** What they've said: each answer with its question, skipped ones left out. */
export function answersOf(rounds: readonly PlanRound[]): { question: string; answer: string }[] {
  return rounds.flatMap((r) => r.questions.flatMap((q) => {
    const answer = (r.answers?.[q.id] ?? "").trim();
    return answer ? [{ question: one(q.title), answer }] : [];
  }));
}

/** What was asked and left: they don't know, or won't say. Nothing can be assumed from it, and it isn't asked again. */
export function leftOf(rounds: readonly PlanRound[]): string[] {
  return rounds.flatMap((r) => (r.answers ? r.questions.filter((q) => !(r.answers?.[q.id] ?? "").trim()).map((q) => one(q.title)) : []));
}

const leftLines = (rounds: readonly PlanRound[]) => {
  const left = leftOf(rounds);
  return left.length ? ["", "Asked and left unanswered, so you don't know these. Don't assume an answer:", ...left.map((q) => `- ${q}`)] : [];
};

const canvasLines = (outline: readonly OutlineCard[], ref: (id: string) => string | undefined) =>
  outline.map((c) => {
    const parent = c.parent ? ref(c.parent) : null;
    return `- ${ref(c.id)} · ${KIND_WORD[c.kind]} · “${one(c.title)}”${c.metric ? ` · ${one(c.metric)}` : ""}${c.type ? ` · ${c.type}` : ""}${parent ? ` · under ${parent}` : ""}${c.faint ? " · only a page so far" : ""}`;
  });

const lookLines = (looks: readonly PlanLook[]) => looks.flatMap((l) => l.lines.map((x) => `- ${one(x.text)}${x.url ? ` (${hostOf(x.url)})` : ""}`));

/** What the research step is asked: what people do about this, whichever way, or (`query`) what their answers called for. */
export function planTask(o: { org: string; about: string; said: string; query?: string; answers?: readonly { question: string; answer: string }[]; outline: readonly OutlineCard[] }): string {
  const titles = (k: OutlineCard["kind"]) => o.outline.filter((c) => c.kind === k).map((c) => `“${one(c.title)}”`).slice(0, 12).join(", ");
  return [
    `${o.org}${o.about.trim() ? `: ${one(o.about).slice(0, 600)}` : ""}`,
    `They asked: “${one(o.said).slice(0, 800)}”`,
    ...(titles("outcome") ? [`Their goals: ${titles("outcome")}.`] : []),
    ...(titles("opportunity") ? [`The problems they're looking at: ${titles("opportunity")}.`] : []),
    ...(o.answers?.length ? [`What they told us: ${o.answers.map((a) => `${a.question} ${a.answer}`).join(" · ").slice(0, 800)}`] : []),
    o.query?.trim() ? `Look up: ${one(o.query).slice(0, PLAN_LIMITS.query)}.` : "What do people do about problems like these? Look across the ways of solving them: changes to a product, new features, products made for it, messages and campaigns (SMS, push, email, social media), and services or doing it by hand. Which tools do they use, and what does it take?",
  ].join("\n");
}

/** What deciding the next step reads: what they asked, the canvas, what was read and what they've said so far. */
export function planNextMaterial(o: { org: string; about?: string; said: string; outline: readonly OutlineCard[]; rounds: readonly PlanRound[]; looks: readonly PlanLook[]; company?: string }): string {
  const ids = new Map(o.outline.map((c, i) => [c.id, `c${i + 1}`]));
  const answers = answersOf(o.rounds);
  const lines = lookLines(o.looks);
  return [
    `What they asked: “${one(o.said)}”`,
    "",
    `The company or project: “${o.org}”${o.about?.trim() ? `. ${one(o.about)}` : ""}`,
    ...(o.company?.trim() ? [o.company.trim()] : []),
    "",
    "What's on their canvas:",
    ...(o.outline.length ? canvasLines(o.outline, (id) => ids.get(id)) : ["(nothing yet)"]),
    "",
    "What was read on the web (others' words):",
    ...(lines.length ? lines : ["(nothing)"]),
    "",
    answers.length ? "What they've told you:" : "They haven't told you anything yet.",
    ...answers.map((a) => `- ${a.question} ${a.answer}`),
    ...leftLines(o.rounds),
    "",
    `Rounds of questions so far: ${o.rounds.length} of at most ${PLAN_LIMITS.rounds}. Looks at the web after the first: ${o.looks.filter((l) => l.after >= 0).length} of at most ${PLAN_LIMITS.looks}.`,
  ].join("\n");
}

/** How a question is taken, as code keeps a small call's answer: a plan only when it says so. */
export const sanitizeRoute = (raw: unknown): "ask" | "plan" => (rec(raw).route === "plan" ? "plan" : "ask");

export type PlanNext = { action: "ask"; questions: PlanQuestion[] } | { action: "look"; query: string } | { action: "ready" };

/** Code's own questions: what most changes what's worth proposing. Each is open, and can be skipped. */
export function planRound(): PlanQuestion[] {
  const open = (id: string, title: string, why: string): PlanQuestion => ({ id, title, why, multi: false, options: [], recommended: [], allowOther: false });
  return [open("who", "Who would use it or pay for it first?", "Everything proposed is for them."), open("exists", "What exists already, and what can you build or run yourself?", "A message or a service may do before any software."), open("reach", "How do you reach those people today?", "So what's proposed can actually reach them.")];
}

/**
 * What code keeps of the next step: a look only while looks are left, never twice running; questions
 * only while rounds are left, their choices always open to their own words. With nothing to go by on
 * a first round, code's own questions are asked; else it's ready.
 */
export function sanitizeNext(raw: unknown, o: { rounds: readonly PlanRound[]; looks: readonly PlanLook[] }): PlanNext {
  const r = rec(raw);
  const looked = o.looks.filter((l) => l.after >= 0);
  const justLooked = o.looks.at(-1)?.after === o.rounds.length - 1 && o.rounds.length > 0;
  const noWeb = o.looks.some((l) => l.noWeb);
  const query = one(word(r.look)).slice(0, PLAN_LIMITS.query);
  if (r.action === "look" && query && !noWeb && !justLooked && looked.length < PLAN_LIMITS.looks) return { action: "look", query };
  if (o.rounds.length >= PLAN_LIMITS.rounds) return { action: "ready" };
  const questions = sanitizeAsked(r.questions).slice(0, 3).map((q) => ({ ...q, allowOther: true }));
  if (r.action === "ask" && questions.length) return { action: "ask", questions };
  return !o.rounds.length && r.action !== "ready" ? { action: "ask", questions: planRound() } : { action: "ready" };
}

// ---------------------------------------------------------------------------
// Proposing

/** A piece of words near the problems. */
export interface PlanPiece {
  ref: string;
  text: string;
  label: string;
  source: string | null;
  evidence: boolean;
  online?: boolean;
  basis?: Basis;
  /** The problem it's behind, by the canvas card's id. */
  card: string;
}

export interface PlanSent {
  text: string;
  /** Every word it was sent, its ids taken out: what quotes and numbers must come from. */
  hay: string;
  cards: Map<string, OutlineCard>;
  pieces: Map<string, PlanPiece>;
  answers: Map<string, { question: string; answer: string }>;
  read: Map<string, { text: string; url?: string; title?: string; quote?: string }>;
}

/** What proposing reads: what they asked and answered, the canvas, the words behind its problems, and what was read on the web. Each has its id. */
export function planMaterial(o: { org: string; about?: string; said: string; outline: readonly OutlineCard[]; rounds: readonly PlanRound[]; looks: readonly PlanLook[]; pieces: readonly PlanPiece[]; company?: string }): PlanSent {
  const cards = new Map<string, OutlineCard>();
  const ids = new Map<string, string>();
  o.outline.slice(0, PLAN_LIMITS.outline).forEach((c, i) => {
    cards.set(`c${i + 1}`, c);
    ids.set(c.id, `c${i + 1}`);
  });
  const answers = new Map(answersOf(o.rounds).map((a, i) => [`a${i + 1}`, a]));
  const pieces = new Map<string, PlanPiece>();
  const ordered = [...o.pieces.filter((p) => p.evidence), ...o.pieces.filter((p) => !p.evidence)].filter((p) => ids.has(p.card)).slice(0, PLAN_LIMITS.pieces);
  ordered.forEach((p, i) => pieces.set(`q${i + 1}`, p));
  const read = new Map(o.looks.flatMap((l) => l.lines).map((l, i) => [`w${i + 1}`, { text: l.text, ...(l.url ? { url: l.url } : {}), ...(l.title ? { title: l.title } : {}), ...(l.quote ? { quote: l.quote } : {}) }]));
  const body = [
    `What they asked: “${one(o.said)}”`,
    "",
    `The company or project: “${o.org}”${o.about?.trim() ? `. ${one(o.about)}` : ""}`,
    "",
    "What they told you (id · question · their answer):",
    ...(answers.size ? [...answers].map(([id, a]) => `- ${id} · ${a.question} · “${one(a.answer)}”`) : ["(nothing: they skipped the questions)"]),
    "",
    "The canvas now (id · what · words · where):",
    ...(cards.size ? canvasLines([...cards.values()], (id) => ids.get(id)) : ["(nothing yet)"]),
    "",
    "The words behind the problems (id · whose · where · words · the problem):",
    ...(pieces.size ? [...pieces].map(([id, p]) => `- ${id} · ${whose(p)} · ${one(p.label)} · “${one(p.text)}” · ${ids.get(p.card)}`) : ["(no words yet)"]),
    "",
    "What was read on the web (id · the line · the page). Others' words, never evidence about these customers:",
    ...(read.size ? [...read].map(([id, l]) => `- ${id} · ${one(l.text)}${l.quote ? ` “${one(l.quote)}”` : ""}${l.url ? ` · ${hostOf(l.url)}` : ""}`) : ["(nothing)"]),
  ].join("\n");
  const left = leftLines(o.rounds).join("\n");
  const text = [body, left.trim(), o.company?.trim()].filter(Boolean).join("\n\n");
  // What words and numbers may come from: the material without its ids.
  return { text, hay: body.replace(/(^|\s)[acqw]\d+ ·/gm, "$1"), cards, pieces, answers, read };
}

/** A card a plan proposes, as code kept it. */
export interface PlanCard {
  /** Its id in this draft. */
  ref: string;
  kind: "outcome" | "opportunity" | "solution";
  /** On the canvas (`card`), or another card of this draft (`ref`). Null: on its own, a goal or a problem. */
  under: { card: string } | { ref: string } | null;
  title: string;
  description: string;
  why: string;
  type?: SolutionType;
  how?: string;
  /** A module nobody asked for that its product can't run without. */
  needed?: true;
  came?: Came;
  metric?: { name: string; target: number | null };
  /** The pieces it rests on (refs). */
  quotes: string[];
  /** Their answers it rests on. */
  answers: { question: string; answer: string }[];
  /** What was read online that it draws on. */
  read: { text: string; url?: string; title?: string }[];
  /** The other problems it helps: on the canvas, or in this draft (`ref`). */
  helps: (OstHelpTarget | { ref: string; title: string })[];
  assumptions: { id: string; category: AssumptionCategory; text: string; importance: 1 | 2 | 3 }[];
  test?: { assumption: string; what: string; how: string; suggested: string | null };
}

export interface PlanDraft {
  cards: PlanCard[];
  /** The card to start with: the strongest signal so far. */
  start: string | null;
  /** What it doubts most, in a line. */
  doubt: string;
  /** Where each piece lives. */
  quotes: Record<string, QuoteRef>;
}

/**
 * What code keeps of the answer. Nothing has to back a card: one resting on nothing says where it came
 * from. A quote or number that isn't in what was sent comes out; a title with nothing left drops the
 * card and what hangs under it. Ids count only as they were sent. A goal or a problem the canvas has
 * already isn't proposed again: what hangs under it hangs on the one there. A solution goes under a
 * problem, a module only under a New product (one proposed here becomes one when something hangs
 * under it), and "needed" only on a module.
 */
export function sanitizePlan(raw: unknown, m: PlanSent, o: { id: () => string }, dropped?: (why: string, item: unknown) => void): PlanDraft {
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  const name = (ref: string) => m.cards.get(ref)?.title;
  // Some models put a whole line in quote marks: it's the line, not someone's words.
  const unwrapped = (v: unknown) => withoutIds(v, name, "acqwn").replace(/^\s*['‘]([^'‘’]*(?:['‘’][^'‘’]+)*?)['’]\s*$/u, "$1");
  const held = (v: unknown, max: number, shape: "title" | "prose", x: unknown) => {
    const h = holdWords(unwrapped(v), m.hay, { max, shape });
    if (h.cut.length) drop(`words or numbers that aren't in what was sent came out: ${h.cut.join(" | ")}`, x);
    return h.text;
  };
  const planWords = draftWords(m.hay, name, "acqwn");
  const outline = [...m.cards.values()];
  const numbers = new Set(valuesIn(m.hay));

  type Row = { x: Record<string, unknown>; ref: string; kind: PlanCard["kind"]; title: string };
  const rows: Row[] = [];
  /** A ref taken for a card the canvas has: what hangs under it hangs there. */
  const same = new Map<string, OutlineCard>();
  for (const item of list(rec(raw).cards).slice(0, PLAN_LIMITS.cards * 2)) {
    const x = rec(item);
    const ref = word(x.ref);
    const kind = x.kind === "outcome" || x.kind === "opportunity" || x.kind === "solution" ? x.kind : null;
    if (!ref || !kind || rows.some((r) => r.ref === ref)) {
      drop("no id of its own, or a kind it can't be", item);
      continue;
    }
    const title = held(x.title, PLAN_LIMITS.title, "title", item);
    if (!title) {
      drop("its title says nothing once what wasn't sent is out", item);
      continue;
    }
    const there = outline.find((c) => c.kind === kind && sameTopic(c.title, title));
    if (there) {
      same.set(ref, there);
      drop("on the canvas already: what hangs under it hangs on the one there", item);
      continue;
    }
    if (rows.some((r) => r.kind === kind && sameTopic(r.title, title))) {
      drop("proposed twice", item);
      continue;
    }
    rows.push({ x, ref, kind, title });
  }
  const rowOf = new Map(rows.map((r) => [r.ref, r]));

  /** Where a ref points. */
  const place = (ref: string): { card: OutlineCard } | { row: Row } | null => {
    const c = m.cards.get(ref) ?? same.get(ref);
    if (c) return { card: c };
    const r = rowOf.get(ref);
    return r ? { row: r } : null;
  };

  const out = new Map<string, PlanCard>();
  const typeOf = new Map<string, SolutionType>();
  for (const r of rows) {
    const t = SOLUTION_TYPES.find((s) => s === r.x.type);
    if (t) typeOf.set(r.ref, t);
  }
  // A solution hanging under a solution proposed here makes that one a New product.
  for (const r of rows) {
    if (r.kind !== "solution") continue;
    const at = place(word(r.x.under));
    if (at && "row" in at && at.row.kind === "solution") typeOf.set(at.row.ref, "product");
  }

  const counts = { goals: 0, problems: 0, per: new Map<string, number>() };
  const fit = (r: Row, under: PlanCard["under"]): string | null => {
    if (out.size >= PLAN_LIMITS.cards) return "over the limit";
    if (r.kind === "outcome") return ++counts.goals > PLAN_LIMITS.goals ? "over the limit of goals" : null;
    if (r.kind === "opportunity") return ++counts.problems > PLAN_LIMITS.problems ? "over the limit of problems" : null;
    const key = under && "card" in under ? under.card : under && "ref" in under ? under.ref : "";
    const n = (counts.per.get(key) ?? 0) + 1;
    counts.per.set(key, n);
    const parentProduct = under && "ref" in under ? typeOf.get(under.ref) === "product" : under && "card" in under ? outline.find((c) => c.id === under.card)?.type === "product" : false;
    return n > (parentProduct ? PLAN_LIMITS.modules : PLAN_LIMITS.solutionsPer) ? "over the limit under it" : null;
  };

  const under = (r: Row): PlanCard["under"] | "no" => {
    const at = place(word(r.x.under));
    if (!at) return r.kind === "solution" ? "no" : null;
    const kind = "card" in at ? at.card.kind : at.row.kind;
    const here = "card" in at ? { card: at.card.id } : { ref: at.row.ref };
    if (r.kind === "outcome") return kind === "outcome" ? here : null;
    if (r.kind === "opportunity") return kind === "solution" ? null : here;
    if (kind === "opportunity") return here;
    if (kind === "solution") {
      const product = "card" in at ? at.card.type === "product" : typeOf.get(at.row.ref) === "product";
      return product ? here : "no";
    }
    return "no";
  };

  const visit = (r: Row, path: readonly string[] = []): PlanCard | null => {
    if (out.has(r.ref)) return out.get(r.ref)!;
    if (path.includes(r.ref)) return null;
    const u = under(r);
    if (u === "no") {
      drop("a solution goes under a problem, a module under a New product", r.x);
      return null;
    }
    // What it hangs under goes first; if that's gone, so is this.
    if (u && "ref" in u) {
      const parent = rowOf.get(u.ref);
      if (!parent || !visit(parent, [...path, r.ref])) {
        drop("what it hangs under isn't kept", r.x);
        return null;
      }
    }
    const no = fit(r, u);
    if (no) {
      drop(no, r.x);
      return null;
    }
    const refs = strs(r.x.cites);
    const pieces = refs.flatMap((c) => m.pieces.get(c) ?? []);
    const answers = refs.flatMap((c) => m.answers.get(c) ?? []);
    const read = refs.flatMap((c) => m.read.get(c) ?? []);
    const own = answers.map(() => ({ evidence: false, basis: "own" as Basis }));
    const module = r.kind === "solution" && !!u && (("ref" in u && rowOf.get(u.ref)?.kind === "solution") || ("card" in u && outline.find((c) => c.id === u.card)?.kind === "solution"));
    const needed = module && r.x.needed === "yes";
    const type = typeOf.get(r.ref);
    const how = r.kind === "solution" ? held(r.x.how, PLAN_LIMITS.how, "prose", r.x) : "";
    const metric = rec(r.x.metric);
    const metricName = r.kind === "outcome" ? held(metric.name, PLAN_LIMITS.metric, "title", r.x) : "";
    const target = Number(word(metric.target).replace(/,/g, ""));
    const assumptions: PlanCard["assumptions"] = [];
    const named = new Map<number, string>();
    list(r.x.assumptions).map(rec).forEach((a, i) => {
      if (r.kind !== "solution" || assumptions.length >= PLAN_LIMITS.assumptions) return;
      const category = ASSUMPTION_CATEGORIES.find((c) => c === a.category);
      const text = held(a.text, PLAN_LIMITS.assumption, "prose", r.x);
      if (!category || !text) return;
      const id = o.id();
      named.set(i + 1, id);
      assumptions.push({ id, category, text, importance: a.importance === "1" ? 1 : a.importance === "2" ? 2 : 3 });
    });
    const t = rec(r.x.test);
    const what = planWords(t.what, PLAN_LIMITS.what, true);
    const testHow = planWords(t.how, PLAN_LIMITS.testHow, true);
    const pass = planWords(t.pass, PLAN_LIMITS.pass, true);
    const riskiest = [...assumptions].sort((a, b) => b.importance - a.importance)[0];
    const card: PlanCard = {
      ref: r.ref,
      kind: r.kind,
      under: u,
      title: r.title,
      description: held(r.x.description, PLAN_LIMITS.description, "prose", r.x),
      why: held(r.x.why, PLAN_LIMITS.why, "prose", r.x),
      ...(type && r.kind === "solution" && !module ? { type } : {}),
      ...(how ? { how } : {}),
      ...(needed ? { needed: true as const } : {}),
      // A part the product needs claims nothing, so there's nothing to say about where it came from.
      ...(needed ? {} : cameFrom([...pieces, ...own], read.length > 0)),
      ...(metricName ? { metric: { name: metricName, target: word(metric.target) && Number.isFinite(target) && numbers.has(target) ? target : null } } : {}),
      quotes: [...new Set(pieces.map((p) => p.ref))],
      answers,
      read: read.map((l) => ({ text: l.text, ...(l.url ? { url: l.url } : {}), ...(l.title ? { title: l.title } : {}) })),
      helps: [],
      assumptions,
      ...(what && testHow && riskiest ? { test: { assumption: named.get(Number(word(t.assumption))) ?? riskiest.id, what, how: testHow, suggested: pass } } : {}),
    };
    out.set(r.ref, card);
    return card;
  };
  for (const r of rows) visit(r);

  // What else each solution helps, once it's known what's kept.
  for (const r of rows) {
    const card = out.get(r.ref);
    if (card?.kind !== "solution") continue;
    const seen = new Set<string>();
    for (const h of strs(r.x.helps)) {
      const at = place(h);
      if (!at) continue;
      if ("card" in at) {
        if (at.card.kind !== "opportunity" || seen.has(at.card.id) || (card.under && "card" in card.under && card.under.card === at.card.id)) continue;
        seen.add(at.card.id);
        card.helps.push(at.card.topic ? { topic: at.card.topic, title: at.card.title } : { card: at.card.id, title: at.card.title });
      } else {
        if (at.row.kind !== "opportunity" || !out.has(at.row.ref) || seen.has(at.row.ref) || (card.under && "ref" in card.under && card.under.ref === at.row.ref)) continue;
        seen.add(at.row.ref);
        card.helps.push({ ref: at.row.ref, title: at.row.title });
      }
    }
  }

  const cards = [...out.values()];
  const named = word(rec(raw).start);
  const startable = (c: PlanCard) => c.kind === "solution" && !c.needed;
  const start = out.get(named) && startable(out.get(named)!) ? named : (cards.find(startable)?.ref ?? null);
  const doubt = holdWords(unwrapped(rec(raw).doubt), m.hay, { max: PLAN_LIMITS.doubt, shape: "prose" }).text;
  const quotes: Record<string, QuoteRef> = {};
  for (const p of m.pieces.values()) if (p.source && p.ref.startsWith("hub:quote:")) quotes[p.ref] = { sourceId: p.source, quoteId: p.ref.slice("hub:quote:".length) };
  return { cards, start, doubt, quotes };
}

// ---------------------------------------------------------------------------
// As proposals on the canvas

/** What a plan proposes, in a line: each New product with its modules, then what else there is, and the other problems it links to. */
export function planLine(list: readonly Proposal[]): string {
  const cards = list.flatMap((p) => (p.kind === "card" ? [p] : []));
  const products = cards.filter((p) => p.card.solutionType === "product");
  const under = (p: { cardId: string }) => cards.filter((c) => c.parentId === p.cardId && c.card.kind === "solution").length;
  const modules = new Set(products.flatMap((p) => cards.filter((c) => c.parentId === p.cardId && c.card.kind === "solution").map((c) => c.cardId)));
  const count = (k: OstCard["kind"]) => cards.filter((c) => c.card.kind === k && !modules.has(c.cardId) && c.card.solutionType !== "product" && !c.replaces).length;
  const n = (k: number, one: string, many = `${one}s`) => (k ? `${k} ${k === 1 ? one : many}` : "");
  const parts = [
    ...products.map((p) => `a New product, “${p.card.title}”${under(p) ? `, with ${n(under(p), "module")}` : ""}`),
    n(count("outcome"), "goal"),
    n(count("opportunity"), "problem"),
    n(count("solution"), "solution"),
    n(count("test"), "test"),
    n(list.filter((p) => p.kind === "helps").length, "link to another problem", "links to other problems"),
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

/** A problem's page as a card, what its page rests on on it (`problemCard`). */
export type PageWords = Record<string, { title: string; evidence: OstEvidence[] } | undefined>;

const evidenceId = (o: { id: () => string }, at: number, e: Omit<OstEvidence, "id" | "at" | "addedBy">): OstEvidence => ({ id: o.id(), addedBy: "ai", at, ...e });

/**
 * The draft as proposals, in the order they can land: what hangs under a card after it. A problem only
 * a page so far is made a card first, in the faint card's place (a card under a faint one would save
 * on its own), and its page's words rest on it. Accepting a solution takes its test along.
 */
export function planProposals(d: PlanDraft, ctx: { doc: Doc; things: ReadonlyMap<string, SpaceThing>; pages: PageWords; now: number; id: () => string }): Proposal[] {
  const out: Proposal[] = [];
  const cardIds = new Map(d.cards.map((c) => [c.ref, ctx.id()]));
  const promoted = new Map<string, string>();
  const promote = (faint: string): string => {
    const made = promoted.get(faint);
    if (made) return made;
    const t = ctx.things.get(faint);
    const topic = t?.type === "problem" ? t.topic : "";
    const n = ctx.doc.nodes[faint];
    const page = ctx.pages[topic];
    const id = ctx.id();
    promoted.set(faint, id);
    out.push({ id: `page:${topic}`, kind: "card", cardId: id, parentId: n?.parentId ?? null, card: newCard("opportunity", { title: page?.title ?? (n?.meta.ost?.title ?? ""), createdBy: "ai" }), backing: { quotes: [], words: page?.evidence ?? [] }, why: "It's a problem's page so far: this puts it on the canvas.", replaces: faint });
    return id;
  };
  const parentOf = (u: PlanCard["under"]): string | null => {
    if (!u) return null;
    if ("ref" in u) return cardIds.get(u.ref) ?? null;
    return ctx.things.get(u.card)?.type === "problem" ? promote(u.card) : u.card;
  };
  for (const c of d.cards) {
    const parentId = parentOf(c.under);
    const cardId = cardIds.get(c.ref)!;
    const assumptions: OstAssumption[] = c.assumptions.map((a) => ({ ...a, addedBy: "ai" }));
    const card = newCard(c.kind, {
      title: c.title,
      createdBy: "ai",
      ...(c.description ? { description: c.description } : {}),
      ...(c.came ? { came: c.came } : {}),
      ...(c.type ? { solutionType: c.type } : {}),
      ...(c.how ? { how: c.how } : {}),
      ...(c.needed ? { needed: true as const } : {}),
      ...(d.start === c.ref ? { start: true as const } : {}),
      ...(c.metric ? { metric: { name: c.metric.name, direction: "increase" as const, baseline: null, current: null, target: c.metric.target } } : {}),
      ...(assumptions.length ? { assumptions } : {}),
    });
    const words = [
      ...c.answers.map((a) => evidenceId(ctx, ctx.now, { kind: "answer", text: a.answer, answerId: `plan:${a.question}` })),
      ...c.read.map((l) => evidenceId(ctx, ctx.now, { kind: "read", text: l.text, ...(l.url ? { url: l.url } : {}), ...(l.title ? { sourceTitle: l.title } : {}) })),
    ];
    const quotes = c.quotes.flatMap((r) => d.quotes[r] ?? []);
    out.push({ id: `${c.kind === "solution" ? "sol" : "plan"}:${c.ref}`, kind: "card", cardId, parentId, card, backing: { quotes, words }, why: c.why || c.description });
    if (c.test) out.push({ id: `test:${c.ref}`, kind: "card", cardId: ctx.id(), parentId: cardId, card: newCard("test", { title: c.test.what, createdBy: "ai", test: { assumptionIds: [c.test.assumption], method: c.test.how, ...(c.test.suggested ? { suggested: { criterion: c.test.suggested } } : {}) } }), backing: { quotes: [], words: [] }, why: "" });
  }
  for (const c of d.cards)
    for (const h of c.helps) {
      const to: OstHelpTarget = "ref" in h ? { card: cardIds.get(h.ref), title: h.title } : h;
      out.push({ id: `helps:${c.ref}:${"ref" in h ? h.ref : (h.card ?? h.topic)}`, kind: "helps", cardId: cardIds.get(c.ref)!, to, why: "" });
    }
  return out;
}
