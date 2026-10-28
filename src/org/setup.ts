import { newId } from "@/doc/factory";
import { fragmentRefs, roundAnswers, type DumpChallenge } from "@/discovery/dump";
import type { SourceQuote } from "@/discovery/sources";
import { checkWords } from "@/hub/topics";
import type { PlanBucket } from "@/ui/ai/plan";
import { emptyContext, type ContextFields, type Product } from "./context-md";

/*
 * An organization set up from a brain dump (pure): someone pastes what they know about the company
 * (or points at its website), and Qalam AI reads it the way a board reads a brain dump (what it
 * took from it, its pieces in their own words, its pushback, rounds of questions), then proposes
 * what the organization is: its About, its products, who each is for, their goals and segments.
 * Code keeps a line only where it rests on pieces and answers that were sent, with every quote and
 * number in it found there, and a new product only under a name they used. Accepting a line writes
 * it to about.md or the product's file (src/org/context-md.ts); nothing is written before.
 */

export type SetupField = "audience" | "context" | "goals" | "segments";
export const SETUP_FIELDS: SetupField[] = ["audience", "context", "goals", "segments"];

/** One line Qalam AI proposes for the organization's pages. */
export interface SetupLine {
  id: string;
  /** Where it goes: "org" (about.md), a product there already (its id), or a new one ("new:n1"). */
  to: string;
  field: SetupField;
  text: string;
  /** The dump's pieces it rests on (its source's quote ids). */
  pieces: string[];
  /** The answers it rests on. */
  answers: { question: string; answer: string }[];
  why: string;
}

/** A product Qalam AI would add, named as they name it (the team can rename it before it's made). */
export interface SetupProduct {
  /** How its lines name it until it's made (n1, n2…). */
  ref: string;
  name: string;
  why: string;
}

export interface SetupProposal {
  summary: string;
  products: SetupProduct[];
  lines: SetupLine[];
}

/** How setting the organization up is going, kept on the dump's source (a reload picks it up). */
export interface SetupSession {
  v: 1;
  /** reading → asking ⇄ analyzing → ready → placing → review → done. */
  phase: "reading" | "asking" | "analyzing" | "ready" | "placing" | "review" | "done" | "failed";
  /** The step that failed: Try again runs it again with what's kept. */
  failed?: { at: "reading" | "analyzing" | "placing"; error: string };
  /** What Qalam AI took from it, revised after each round of answers. */
  understanding: string;
  /** Pushback still open. */
  challenges: DumpChallenge[];
  /** Every round of questions so far; the last is the one being asked (or just answered). */
  buckets: PlanBucket[];
  /** They left the rest of the questions: proposed with what's answered. */
  skipped?: boolean;
  proposal?: SetupProposal;
  /** What was done with each line, by its id. */
  decided?: Record<string, "accepted" | "discarded">;
  /** The products accepting lines made, by their ref (n1…). */
  made?: Record<string, string>;
  /** Boards started from accepted goals, by the goal's line id. */
  boards?: Record<string, string>;
  model?: string;
}

export const SETUP_LIMITS = { products: 6, goals: 6, segments: 8, line: 160, text: 420, name: 60, why: 200, summary: 600 } as const;
const L = SETUP_LIMITS;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).map(rec);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string"))];
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------------------------------------------------------------------------
// What a call is sent, and its answer as code keeps it

export interface SentAnswer {
  ref: string;
  question: string;
  /** The answer in words: an option they picked, or what they typed. */
  answer: string;
}

export interface SetupSent {
  /** The dump's pieces, as the call named them (f1…). */
  pieces: { ref: string; q: SourceQuote }[];
  /** Their answers, as the call named them (a1…). */
  answers: SentAnswer[];
  /** The organization's products when the call was made, as it named them (p1…). */
  products: { ref: string; product: Product }[];
  /** What the organization says about itself already. */
  about: ContextFields;
  /** The organization's name, the dump and every answer: a new product is named only in these words. */
  said: string;
}

/** What a setup's calls name, from the dump's source, the answers so far and the organization as it is. */
export function setupSent(name: string, source: { text: string; quotes: SourceQuote[] }, session: Pick<SetupSession, "buckets">, now: { about: ContextFields; products: Product[] }): SetupSent {
  const answers = roundAnswers(session)
    .flat()
    .map((a, i) => ({ ref: `a${i + 1}`, question: a.question, answer: a.answer }));
  return {
    pieces: fragmentRefs(source.quotes),
    answers,
    products: now.products.map((product, i) => ({ ref: `p${i + 1}`, product })),
    about: now.about,
    said: [name, source.text, ...answers.map((a) => a.answer)].join("\n"),
  };
}

/** Words a product's name may carry without their having said them: what kind of thing it is. */
const GENERIC = new Set(["app", "apps", "the", "and", "for", "our", "platform", "service", "services", "product", "products", "tool", "tools", "website", "site", "web", "mobile", "online", "of"]);
const fold = (w: string) => w.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(fold);
/** A word as they may have written it: one or many ("office", "offices", "category", "categories"). */
const forms = (w: string) => [w, `${w}s`, `${w}es`, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/y$/, "ies")];

/** A product's name holds when each of its words (but what kind of thing it is) is one they used. */
export function nameHolds(name: string, said: string): boolean {
  const theirs = new Set(wordsOf(said));
  const own = wordsOf(name).filter((w) => !GENERIC.has(w));
  return own.length > 0 && own.every((w) => forms(w).some((f) => theirs.has(f)));
}

/**
 * What Qalam AI proposes, kept only where it holds: each line cites pieces or answers that were
 * sent, and its quotes and numbers are in them (an option they picked is their answer: the line
 * shows it as such), a text field is filled only where it's empty, a goal or segment is never
 * there twice, and a new product is named in their words and has a line to stand on. Lines for a
 * product there already go to it, whether the answer names it by its id or by its name.
 */
export function sanitizeSetup(raw: unknown, sent: SetupSent): SetupProposal {
  const r = rec(raw);
  const pieceOf = new Map(sent.pieces.map((p) => [p.ref, p.q]));
  const answerOf = new Map(sent.answers.map((a) => [a.ref, a]));
  const existing = new Map(sent.products.map((p) => [p.ref, p.product]));
  const lines: SetupLine[] = [];
  let products: SetupProduct[] = [];
  // What each place says, now and with what's kept so far.
  const says = new Map<string, ContextFields>([["org", sent.about], ...sent.products.map((p) => [p.product.id, p.product] as const)]);

  const take = (to: string, field: SetupField, x: unknown) => {
    const v = rec(x);
    const pieces = ids(v.fragmentIds).flatMap((ref) => pieceOf.get(ref) ?? []);
    const answers = ids(v.answerIds).flatMap((ref) => answerOf.get(ref) ?? []);
    if (!pieces.length && !answers.length) return;
    const isText = field === "audience" || field === "context";
    const text = checkWords(v.text, [...pieces, ...answers.map((a) => ({ text: a.answer }))], "", isText ? L.text : L.line);
    if (!text) return;
    const c = says.get(to) ?? emptyContext();
    if (isText) {
      if (c[field].trim()) return;
      says.set(to, { ...c, [field]: text });
    } else {
      if (c[field].some((x) => key(x) === key(text)) || lines.filter((l) => l.to === to && l.field === field).length >= L[field]) return;
      says.set(to, { ...c, [field]: [...c[field], text] });
    }
    lines.push({ id: newId(), to, field, text, pieces: pieces.map((q) => q.id), answers: answers.map(({ question, answer }) => ({ question, answer })), why: clip(v.why, L.why) });
  };
  const fieldsOf = (to: string, x: Record<string, unknown>) => {
    for (const f of ["audience", "context"] as const) if (x[f]) take(to, f, x[f]);
    for (const f of ["goals", "segments"] as const) for (const g of items(x[f])) take(to, f, g);
  };

  fieldsOf("org", rec(r.about));
  for (const p of items(r.products)) {
    const name = clip(p.name, L.name);
    const there = existing.get(clip(p.id, 12)) ?? sent.products.find((x) => name && key(x.product.name) === key(name))?.product;
    if (there) {
      fieldsOf(there.id, p);
      continue;
    }
    const twin = products.find((x) => key(x.name) === key(name));
    if (!twin && (products.length >= L.products || !name || !nameHolds(name, sent.said))) continue;
    const np = twin ?? { ref: `n${products.length + 1}`, name, why: clip(p.why, L.why) };
    if (!twin) products.push(np);
    fieldsOf(`new:${np.ref}`, p);
  }
  // A new product is made by accepting one of its lines: one with none kept isn't proposed.
  products = products.filter((p) => lines.some((l) => l.to === `new:${p.ref}`));
  return { summary: clip(r.summary, L.summary), products, lines };
}

// ---------------------------------------------------------------------------
// Accepting and discarding

/** Lines no one has accepted or discarded yet. */
export const pendingLines = (s: Pick<SetupSession, "proposal" | "decided">) => (s.proposal?.lines ?? []).filter((l) => !s.decided?.[l.id]);

/** The session once these lines are accepted or discarded: done when none is left. */
export function decide(s: SetupSession, lineIds: string[], how: "accepted" | "discarded", made?: Record<string, string>): SetupSession {
  const known = new Set((s.proposal?.lines ?? []).map((l) => l.id));
  const decided = { ...s.decided, ...Object.fromEntries(lineIds.filter((id) => known.has(id)).map((id) => [id, how])) };
  const left = (s.proposal?.lines ?? []).some((l) => !decided[l.id]);
  return { ...s, decided, ...(made ? { made } : {}), phase: left ? "review" : "done" };
}

/** A line on what a place says: a goal or segment added once, a text field filled (or added to, when someone filled it meanwhile). */
function withLine<T extends ContextFields>(c: T, l: SetupLine): T {
  if (l.field === "goals" || l.field === "segments") return c[l.field].some((x) => key(x) === key(l.text)) ? c : { ...c, [l.field]: [...c[l.field], l.text] };
  const was = c[l.field].trim();
  if (key(was).includes(key(l.text))) return c;
  return { ...c, [l.field]: was ? `${was}\n\n${l.text}` : l.text };
}

export interface SetupWrites {
  /** about.md as it should be now (null: unchanged). */
  about: ContextFields | null;
  /** Products made or changed. */
  products: Product[];
  /** The products made so far, by their ref. */
  made: Record<string, string>;
}

/**
 * What accepting these lines writes, on the organization as it is now: about.md, products changed,
 * new ones made under the name the proposal has (renamed or not). A product made before and since
 * deleted is made again.
 */
export function applyLines(now: { about: ContextFields; products: Product[] }, proposal: SetupProposal, lines: SetupLine[], made: Record<string, string> = {}, makeId: () => string = newId): SetupWrites {
  let about: ContextFields | null = null;
  const changed = new Map<string, Product>();
  const next = { ...made };
  const productAt = (to: string): Product | null => {
    if (!to.startsWith("new:")) return changed.get(to) ?? now.products.find((p) => p.id === to) ?? null;
    const ref = to.slice(4);
    const id = next[ref];
    const had = id ? (changed.get(id) ?? now.products.find((p) => p.id === id)) : undefined;
    if (had) return had;
    const np = proposal.products.find((p) => p.ref === ref);
    if (!np) return null;
    const p: Product = { id: makeId(), name: np.name, ...emptyContext() };
    next[ref] = p.id;
    return p;
  };
  for (const l of lines) {
    if (l.to === "org") {
      about = withLine(about ?? now.about, l);
      continue;
    }
    const p = productAt(l.to);
    if (p) changed.set(p.id, withLine(p, l));
  }
  return { about, products: [...changed.values()], made: next };
}

/** Accepted goals a board can start from, and the product each is for (null: the whole organization). */
export function boardGoals(s: Pick<SetupSession, "proposal" | "decided" | "made">): { line: SetupLine; product: string | null }[] {
  return (s.proposal?.lines ?? [])
    .filter((l) => l.field === "goals" && s.decided?.[l.id] === "accepted")
    .flatMap((line): { line: SetupLine; product: string | null }[] => {
      if (line.to === "org") return [{ line, product: null }];
      const product = line.to.startsWith("new:") ? s.made?.[line.to.slice(4)] : line.to;
      return product ? [{ line, product }] : [];
    });
}
