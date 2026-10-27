import { newId } from "@/doc/factory";
import { quoteFinder } from "./quotes";
import { QUOTE_KINDS, pageAt, quotable, type QuoteKind, type SourceNeed, type SourceQuote } from "./sources";
import { newCard } from "./ops";
import { canHold } from "./kinds";
import type { Proposal, QuoteRef } from "./proposals";
import type { OstKind } from "./types";

/*
 * What Qalam AI makes of a board's sources, made safe (pure). The model proposes; code decides:
 *   - extract: a quote is kept only if code finds it in the chunk it names, word for word, and it
 *     stores the source's words and where they sit; a speaker only if the source names them; a
 *     need only if a kept quote shows it;
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

export const EXTRACT_LIMITS = { quotesPerChunk: 40, quoteChars: 600, needsPerCall: 12, needTitle: 90, speaker: 60 } as const;

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
}

export interface Extracted {
  quotes: { sourceId: string; quote: SourceQuote }[];
  needs: { sourceId: string; need: SourceNeed }[];
}

/**
 * The quotes and needs one extract call returned, kept only where code finds them. `taken` holds
 * the spans each source already has quotes at (an overlapping quote isn't kept twice).
 */
export function sanitizeExtract(raw: unknown, chunks: CallChunk[], taken: Map<string, [number, number][]> = new Map(), now = Date.now()): Extracted {
  const r = rec(raw);
  const byRef = new Map(chunks.map((c) => [c.ref, { c, find: quoteFinder(c.text) }]));
  const spans = new Map([...taken].map(([k, v]) => [k, [...v]]));
  const perChunk = new Map<string, number>();
  const kept = new Map<string, { sourceId: string; id: string }>();
  const out: Extracted = { quotes: [], needs: [] };

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
    const quote: SourceQuote = {
      id: newId(),
      text: m.words,
      span,
      ...(m.parts.length > 1 ? { parts: m.parts.map(([a, b]): [number, number] => [at + a, at + b]) } : {}),
      ...(page ? { page } : {}),
      ...(speaker ? { speaker } : {}),
      kind,
      addedBy: "ai",
      at: now,
    };
    const ref = clip(q.id, 24);
    if (ref && !kept.has(ref)) kept.set(ref, { sourceId: ch.c.sourceId, id: quote.id });
    out.quotes.push({ sourceId: ch.c.sourceId, quote });
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
    if (!parent || !title) continue;
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
