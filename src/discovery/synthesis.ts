import { sanitizeFoundGoals, type FoundGoal } from "@/goals/found";
import { newId } from "@/doc/factory";
import { quoteFinder } from "./quotes";
import { heldBasis, isBasis } from "./basis";
import { valuesIn } from "@/hub/topics";
import { QUOTE_KINDS, pageAt, quotable, type GoalNumber, type QuoteKind, type SourceKind, type SourceNeed, type SourceQuote } from "./sources";
import { newCard } from "./ops";
import { canHold } from "./kinds";
import type { Proposal, QuoteRef } from "./proposals";
import type { OstKind } from "./types";
import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { cardOf } from "./ops";
import { allCards, childCards } from "./tree";

/*
 * What Qalam AI makes of a board's sources, made safe (pure). The model proposes; code decides:
 *   - extract: a point is kept only if code finds it in the chunk it names, word for word, and it
 *     stores the source's words and where they sit; what it rests on as far as code can hold it
 *     (./basis.ts); a speaker only if the source names them; a need only if a kept point shows it;
 *     what the document is only if its numbers are in what was read;
 *   - synthesize: a quote can back (or speak against) an opportunity or a solution that exists;
 *     a new opportunity must rest on at least one kept quote, under the outcome or an opportunity,
 *     not repeating a card already there. Nothing lands on the board until it's accepted: until
 *     then the proposals are a ghost over the tree (proposals.ts).
 */

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).map(rec);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------------------------------------------------------------------------
// Extract

export const EXTRACT_LIMITS = { quotesPerChunk: 40, quoteChars: 600, needsPerCall: 12, needTitle: 90, speaker: 60, about: 160 } as const;

/** A chunk as one call shows it to Qalam AI. */
export interface CallChunk {
  /** The id the call gives it ("c1"). */
  ref: string;
  sourceId: string;
  /** Where it starts in the source's text. */
  start: number;
  text: string;
  /** The source's page starts (PDF). */
  pages?: number[];
  /** Its source's kind: what a point can be held to (./basis.ts). */
  kind?: SourceKind;
}

export interface Extracted {
  quotes: { sourceId: string; quote: SourceQuote }[];
  needs: { sourceId: string; need: SourceNeed }[];
  /** What each document is, in a line, the first the call says of it. */
  about: { sourceId: string; text: string }[];
  /** A number a measured point states for a goal the call was sent. */
  goalNumbers: { sourceId: string; number: GoalNumber }[];
  /** Goals it points to, where the call was asked (src/goals/found.ts). */
  foundGoals: { sourceId: string; goal: FoundGoal }[];
}

/**
 * The quotes and needs one extract call returned, kept only where code finds them. `taken` holds
 * the spans each source already has quotes at (an overlapping quote isn't kept twice).
 */
export function sanitizeExtract(raw: unknown, chunks: CallChunk[], taken: Map<string, [number, number][]> = new Map(), now = Date.now(), goals: ReadonlyMap<string, string> = new Map(), known: readonly string[] = []): Extracted {
  const r = rec(raw);
  const byRef = new Map(chunks.map((c) => [c.ref, { c, find: quoteFinder(c.text) }]));
  const spans = new Map([...taken].map(([k, v]) => [k, [...v]]));
  const perChunk = new Map<string, number>();
  const kept = new Map<string, { sourceId: string; id: string }>();
  const out: Extracted = { quotes: [], needs: [], about: [], goalNumbers: [], foundGoals: [] };

  for (const a of items(r.about)) {
    const ch = byRef.get(typeof a.chunkId === "string" ? a.chunkId : "");
    const text = clip(a.text, EXTRACT_LIMITS.about);
    if (!ch || !text || out.about.some((x) => x.sourceId === ch.c.sourceId)) continue;
    if ((text.match(/\d+(?:[.,]\d+)*/g) ?? []).every((n) => ch.c.text.includes(n))) out.about.push({ sourceId: ch.c.sourceId, text });
  }

  for (const q of items(r.quotes)) {
    const ch = byRef.get(typeof q.chunkId === "string" ? q.chunkId : "");
    if (!ch || typeof q.text !== "string" || (perChunk.get(ch.c.ref) ?? 0) >= EXTRACT_LIMITS.quotesPerChunk) continue;
    const m = ch.find(q.text);
    if (!m || m.words.length > EXTRACT_LIMITS.quoteChars) continue;
    const at = ch.c.start;
    const span: [number, number] = [at + m.span[0], at + m.span[1]];
    const list = spans.get(ch.c.sourceId) ?? [];
    if (list.some(([a, b]) => a < span[1] && span[0] < b)) continue;
    list.push(span);
    spans.set(ch.c.sourceId, list);
    perChunk.set(ch.c.ref, (perChunk.get(ch.c.ref) ?? 0) + 1);
    // A speaker only as the source writes them.
    const named = clip(q.speaker, EXTRACT_LIMITS.speaker);
    const speaker = named && !/^(null|none|unknown|n\/a)$/i.test(named) ? ch.find(named, 2)?.words : undefined;
    const kind: QuoteKind = QUOTE_KINDS.includes(q.kind as QuoteKind) ? (q.kind as QuoteKind) : "need";
    const page = pageAt(ch.c.pages, span[0]);
    const basis = isBasis(q.basis) ? heldBasis(q.basis, m.words, ch.c.kind) : undefined;
    const quote: SourceQuote = {
      id: newId(),
      text: m.words,
      span,
      ...(m.parts.length > 1 ? { parts: m.parts.map(([a, b]): [number, number] => [at + a, at + b]) } : {}),
      ...(page ? { page } : {}),
      ...(speaker ? { speaker } : {}),
      kind,
      ...(basis && basis !== "said" ? { basis } : {}),
      addedBy: "ai",
      at: now,
    };
    const ref = clip(q.id, 24);
    if (ref && !kept.has(ref)) kept.set(ref, { sourceId: ch.c.sourceId, id: quote.id });
    out.quotes.push({ sourceId: ch.c.sourceId, quote });
  }

  // A goal's number: only a goal it was sent, on a measured point, and only where the point has that number.
  for (const n of items(r.goalNumbers)) {
    const goal = goals.get(typeof n.goal === "string" ? n.goal : "");
    const at = kept.get(clip(n.quoteId, 24));
    const q = at && out.quotes.find((x) => x.quote.id === at.id);
    if (!goal || !q || q.quote.basis !== "measured" || typeof n.value !== "number" || !valuesIn(q.quote.text).includes(n.value) || out.goalNumbers.some((x) => x.number.goal === goal)) continue;
    out.goalNumbers.push({ sourceId: q.sourceId, number: { goal, value: n.value, quote: q.quote.id } });
  }

  // Goals it points to, each under the source its first point is in.
  const points = new Map([...kept].flatMap(([ref, at]) => {
    const q = out.quotes.find((x) => x.quote.id === at.id)?.quote;
    return q ? [[ref, { id: q.id, text: q.text, ...(q.basis ? { basis: q.basis } : {}) }] as const] : [];
  }));
  for (const goal of sanitizeFoundGoals(r.goals, points, known, newId)) {
    const sourceId = out.quotes.find((x) => x.quote.id === goal.cites[0])?.sourceId;
    if (sourceId) out.foundGoals.push({ sourceId, goal });
  }

  // Needs: each with the kept quotes that show it, filed under the source(s) the quotes are from.
  const titles = new Set<string>();
  for (const n of items(r.needs)) {
    if (titles.size >= EXTRACT_LIMITS.needsPerCall) break;
    const title = clip(n.title, EXTRACT_LIMITS.needTitle);
    if (!title || titles.has(key(title))) continue;
    const refs = (Array.isArray(n.quoteIds) ? n.quoteIds : []).map((x) => kept.get(String(x))).filter((x): x is { sourceId: string; id: string } => !!x);
    if (!refs.length) continue;
    titles.add(key(title));
    const bySource = new Map<string, string[]>();
    for (const x of refs) if (!bySource.get(x.sourceId)?.includes(x.id)) bySource.set(x.sourceId, [...(bySource.get(x.sourceId) ?? []), x.id]);
    for (const [sourceId, quoteIds] of bySource) out.needs.push({ sourceId, need: { id: newId(), title, quoteIds } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthesize

export const SYNTH_LIMITS = { mappings: 60, perCard: 6, perQuote: 3, against: 12, opportunities: 8, perParent: 4, depth: 3, title: 90, description: 280, why: 200 } as const;


/** A card as the synthesize call names it. */
export interface SynthCard {
  ref: string;
  id: string;
  kind: OstKind;
  title: string;
  /** The card it hangs under, by its ref (null for a tree's root). */
  parentRef: string | null;
  /** Opportunities: how deep (1 = under the outcome). */
  depth: number;
  /** Titles of its child cards, to keep a new opportunity from repeating one. */
  childTitles: string[];
}

export interface SynthQuote extends QuoteRef {
  ref: string;
  /** Where the words sit in the source (to see whether a card already has them). */
  span: [number, number];
  /** Cards the builder discarded it for before. */
  dismissed?: string[];
}

export interface SynthContext {
  cards: SynthCard[];
  quotes: SynthQuote[];
  /** The card the board's tree hangs from (new opportunities with no good parent go here). */
  outcomeRef: string | null;
  /** The card already has these words. */
  has: (cardId: string, q: SynthQuote) => boolean;
  /** A scoped placement: new needs hang only under these cards (by ref), wherever the answer put them. */
  within?: ReadonlySet<string>;
}

/** Whether a card is somewhere under another. */
export function isUnder(doc: Doc, id: string, above: string): boolean {
  for (let at = doc.nodes[id]?.parentId; at; at = doc.nodes[at]?.parentId) if (at === above) return true;
  return false;
}

/** A card a scoped placement sends: one it's scoped to, under one, or above one (so the call reads where they sit). */
export const inScope = (doc: Doc, id: string, scope: readonly string[]) => scope.some((w) => w === id || isUnder(doc, id, w) || isUnder(doc, w, id));

/** Only what's about these cards (by ref): a mapping, a word against, a new need under one of them. */
export function forBoard(raw: unknown, refs: ReadonlySet<string>): Record<string, unknown> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (k: string, field: string) => (Array.isArray(r[k]) ? (r[k] as Record<string, unknown>[]).filter((x) => refs.has(String(x?.[field]))) : []);
  return { mappings: list("mappings", "cardId"), newOpportunities: list("newOpportunities", "parent"), contradictions: list("contradictions", "cardId") };
}

/** How deep an opportunity is (1 = right under the outcome); 0 for other cards. */
function depthOf(doc: Doc, id: string): number {
  let d = 0;
  let n = doc.nodes[id];
  while (isOstCard(n) && n.meta.ost.kind === "opportunity") {
    d++;
    n = n.parentId ? doc.nodes[n.parentId] : undefined!;
  }
  return d;
}

/** A board's cards as a synthesize call names them (c1, c2…, from `first`), at most `max`: only those `keep` takes, before the limit. */
export function synthCardsOf(doc: Doc, first = 1, max = 400, keep?: (id: string) => boolean): SynthCard[] {
  const cards = allCards(doc)
    .filter((c) => !keep || keep(c.id))
    .slice(0, max);
  const refOf = new Map(cards.map((c, i) => [c.id, `c${first + i}`]));
  return cards.map(({ id, card }) => {
    const parent = doc.nodes[id].parentId;
    return { ref: refOf.get(id)!, id, kind: card.kind, title: card.title, parentRef: parent ? (refOf.get(parent) ?? null) : null, depth: depthOf(doc, id), childTitles: childCards(doc, id).map((c) => cardOf(doc, c)?.title ?? "") };
  });
}

/** A pairing not to propose: the card has the words, or the builder discarded them for it before. */
function settled(ctx: SynthContext, cardId: string, q: SynthQuote): boolean {
  return !!q.dismissed?.includes(cardId) || ctx.has(cardId, q);
}

/** Qalam AI's proposals for the tree, kept only where they hold up. */
export function sanitizeSynthesis(raw: unknown, ctx: SynthContext): Proposal[] {
  const r = rec(raw);
  const cards = new Map(ctx.cards.map((c) => [c.ref, c]));
  const quotes = new Map(ctx.quotes.map((q) => [q.ref, q]));
  const out: Proposal[] = [];
  const pairs = new Set<string>();
  const perCard = new Map<string, number>();
  const perQuote = new Map<string, number>();
  const ref = (q: SynthQuote): QuoteRef => ({ sourceId: q.sourceId, quoteId: q.quoteId });

  const pairOk = (x: Record<string, unknown>) => {
    const card = cards.get(String(x.cardId));
    const q = quotes.get(String(x.quoteId));
    if (!card || !q || !quotable(card) || settled(ctx, card.id, q)) return null;
    const pair = `${card.ref}\u0000${q.ref}`;
    if (pairs.has(pair)) return null;
    return { card, q, pair };
  };

  for (const x of items(r.mappings)) {
    if (out.length >= SYNTH_LIMITS.mappings) break;
    const ok = pairOk(x);
    if (!ok || (perCard.get(ok.card.ref) ?? 0) >= SYNTH_LIMITS.perCard || (perQuote.get(ok.q.ref) ?? 0) >= SYNTH_LIMITS.perQuote) continue;
    pairs.add(ok.pair);
    perCard.set(ok.card.ref, (perCard.get(ok.card.ref) ?? 0) + 1);
    perQuote.set(ok.q.ref, (perQuote.get(ok.q.ref) ?? 0) + 1);
    out.push({ id: newId(), kind: "attach", cardId: ok.card.id, quote: ref(ok.q), why: clip(x.why, SYNTH_LIMITS.why) });
  }

  // New opportunities: under the outcome or an opportunity no deeper than the tree allows, each
  // resting on kept quotes, none repeating a card that's already there.
  const fresh = new Map<string, Set<string>>();
  const freshCount = new Map<string, number>();
  let made = 0;
  for (const x of items(r.newOpportunities)) {
    if (made >= SYNTH_LIMITS.opportunities) break;
    const title = clip(x.title, SYNTH_LIMITS.title);
    let parent = cards.get(String(x.parent));
    if (!parent || !canHold(parent.kind, "opportunity")) parent = ctx.outcomeRef ? cards.get(ctx.outcomeRef) : undefined;
    while (parent && parent.kind === "opportunity" && parent.depth >= SYNTH_LIMITS.depth) parent = parent.parentRef ? cards.get(parent.parentRef) : undefined;
    // Re-hung out of a scoped placement's cards (under a solution, too deep): left out.
    if (!parent || !title || (ctx.within && !ctx.within.has(parent.ref))) continue;
    const backed = (Array.isArray(x.quoteIds) ? x.quoteIds : [])
      .map((id) => quotes.get(String(id)))
      .filter((q): q is SynthQuote => !!q)
      .filter((q, i, a) => a.findIndex((y) => y.ref === q.ref) === i)
      .slice(0, 6);
    if (!backed.length) continue;
    const k = key(title);
    const taken = fresh.get(parent.ref) ?? new Set(parent.childTitles.map(key));
    if (!k || taken.has(k) || (freshCount.get(parent.ref) ?? 0) >= SYNTH_LIMITS.perParent) continue;
    taken.add(k);
    fresh.set(parent.ref, taken);
    freshCount.set(parent.ref, (freshCount.get(parent.ref) ?? 0) + 1);
    made++;
    const description = clip(x.description, SYNTH_LIMITS.description);
    const card = newCard("opportunity", { title, createdBy: "ai", ...(description ? { description } : {}) });
    out.push({ id: newId(), kind: "card", cardId: newId(), parentId: parent.id, card, backing: { quotes: backed.map(ref), words: [] }, why: clip(x.why, SYNTH_LIMITS.why) });
  }

  // Words against a card: never the same words that were just proposed to back it.
  let against = 0;
  for (const x of items(r.contradictions)) {
    if (against >= SYNTH_LIMITS.against) break;
    const ok = pairOk(x);
    if (!ok) continue;
    pairs.add(ok.pair);
    against++;
    out.push({ id: newId(), kind: "against", cardId: ok.card.id, quote: ref(ok.q), why: clip(x.why, SYNTH_LIMITS.why) });
  }
  return out;
}
