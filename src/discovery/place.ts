import { newId } from "@/doc/factory";
import { isPartial } from "@/ai/partial-json";
import { mentions, quoteFinder, verbatim } from "./quotes";
import { KINDS, canHold } from "./kinds";
import { newCard } from "./ops";
import { proposalKey, type Backing, type Proposal, type QuoteRef } from "./proposals";
import type { SourceQuote } from "./sources";
import type { PlaceCard } from "./dump";
import type { AssumptionCategory, OstAssumption, OstEvidence, OstKind, OstMetric, OstTest } from "./types";

/*
 * Where Qalam AI would put a brain dump on the board, made safe (pure). The model proposes; code
 * decides what holds:
 *   - a new card goes only where the tree's rules let it (an outcome under an outcome or on its
 *     own, a need under an outcome or a need, a solution under a need, a test under a solution),
 *     no deeper than the board allows, never repeating a card of its tree;
 *   - every new outcome, solution and test rests on the builder's words: pieces of the dump, or
 *     their answers quoted word for word (an option Qalam AI wrote isn't their words). A need with
 *     none behind it is Qalam AI's reading, kept only when it holds something of theirs, and it
 *     shows as Assumed;
 *   - a number is kept only where the builder wrote it, in the dump or their answers;
 *   - words go only on cards that can take them, once, and never where the builder discarded them;
 *   - a card moves only where it may hang, never under itself; two cards merge only when they're
 *     the same kind and neither holds the other, and a card Screens projects link to is kept;
 *   - what the builder discarded before isn't proposed again.
 */

export const PLACE_LIMITS = {
  cards: 30,
  perParent: 6,
  trees: 3,
  /** Outcomes below a tree's root. */
  outcomeDepth: 2,
  /** Opportunities below their outcome. */
  depth: 3,
  piecesPerCard: 6,
  /** Customers' quotes from the organization's other sources, per new card. */
  hubPerCard: 3,
  answersPerCard: 2,
  perCard: 6,
  perPiece: 3,
  against: 12,
  assumptions: 4,
  edits: 10,
  moves: 10,
  merges: 6,
  notes: 8,
  total: 80,
  title: 90,
  description: 280,
  why: 200,
  note: 240,
} as const;

export interface PlaceContext {
  /** The board, as the call named its cards. */
  cards: PlaceCard[];
  /** The dump's pieces, as the call named them. */
  pieces: { ref: string; q: SourceQuote }[];
  /** The dump's source. */
  sourceId: string;
  /** The builder's answers, as the call named them, with the words they typed themselves. */
  answers: { ref: string; answerId: string; words: string }[];
  /** Everything the builder wrote (the dump and what they typed): numbers must be in it. */
  said: string;
  /** proposalKey()s the builder discarded before. */
  settled: Set<string>;
  /** The card already rests on these words of the dump. */
  has: (cardId: string, span: [number, number]) => boolean;
  /** The tree the dump was pasted beside: a note about nothing in particular goes by it. */
  anchor: string | null;
  /** Customers' quotes from the organization's knowledge the call was given, by their ids (k…). */
  hub?: Map<string, { quote: QuoteRef; span: [number, number] }>;
  /** The card already rests on these words of that source. */
  hasQuote?: (cardId: string, q: QuoteRef, span: [number, number]) => boolean;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).map(rec);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const CATEGORIES: AssumptionCategory[] = ["desirability", "viability", "feasibility", "usability", "ethical"];

/** A place on the board a card can hang from: a card there, or a new one kept above it. */
interface Spot {
  id: string;
  kind: OstKind;
  depth: number;
  outcomeDepth: number;
  /** Its tree (a new tree by `new:<ref>`). */
  root: string;
  parentId: string | null;
  /** Its child cards' titles (normalized). */
  titles: Set<string>;
  /** New cards proposed under it. */
  added: number;
}

/** The metric fields the builder's words bear out: names as written, numbers only where they wrote them. */
function metricFields(m: Record<string, unknown>, ctx: PlaceContext): Partial<OstMetric> {
  const theirs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && mentions(ctx.said, v) ? v : undefined);
  const timeframe = typeof m.timeframe === "string" && m.timeframe.trim() ? quoteFinder(ctx.said)(m.timeframe, 2)?.words : undefined;
  const out: Partial<OstMetric> = {
    name: clip(m.name, 80) || undefined,
    unit: clip(m.unit, 24) || undefined,
    direction: m.direction === "increase" || m.direction === "decrease" ? m.direction : undefined,
    baseline: theirs(m.baseline),
    current: theirs(m.current),
    target: theirs(m.target),
    timeframe: timeframe?.slice(0, 40),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Partial<OstMetric>;
}

function assumptionsFrom(raw: unknown, have: Set<string>): OstAssumption[] {
  const out: OstAssumption[] = [];
  for (const a of items(raw)) {
    const text = clip(a.text, 200);
    if (!text || have.has(key(text)) || out.length >= PLACE_LIMITS.assumptions) continue;
    have.add(key(text));
    out.push({
      id: newId(),
      category: CATEGORIES.includes(a.category as AssumptionCategory) ? (a.category as AssumptionCategory) : "desirability",
      text,
      importance: (a.importance === 1 || a.importance === 2 || a.importance === 3 ? a.importance : 2) as 1 | 2 | 3,
      addedBy: "ai",
    });
  }
  return out;
}

/** Qalam AI's placement of a brain dump, kept only where it holds up. `ids` keeps new ids stable while the answer streams in. */
export function sanitizePlace(raw: unknown, ctx: PlaceContext, ids: Map<string, string> = new Map(), now = Date.now()): Proposal[] {
  const r = rec(raw);
  const L = PLACE_LIMITS;
  const byRef = new Map(ctx.cards.map((c) => [c.ref, c]));
  const onBoard = new Set(ctx.cards.map((c) => c.id));
  const pieceOf = new Map(ctx.pieces.map((p) => [p.ref, p.q]));
  const answerOf = new Map(ctx.answers.map((a) => [a.ref, a]));
  const idOf = (k: string) => {
    let v = ids.get(k);
    if (!v) ids.set(k, (v = newId()));
    return v;
  };
  const quoteRef = (q: SourceQuote): QuoteRef => ({ sourceId: ctx.sourceId, quoteId: q.id });
  const why = (x: Record<string, unknown>) => clip(x.why, L.why);

  const spots = new Map<string, Spot>();
  const treeTitles = new Map<string, Set<string>>();
  for (const c of ctx.cards) {
    spots.set(c.id, { id: c.id, kind: c.kind, depth: c.depth, outcomeDepth: c.outcomeDepth, root: c.root, parentId: c.parentRef ? (byRef.get(c.parentRef)?.id ?? null) : null, titles: new Set(c.childTitles.map(key)), added: 0 });
    treeTitles.set(c.root, (treeTitles.get(c.root) ?? new Set()).add(key(c.title)));
  }
  const parentOf = (s: Spot) => (s.parentId ? (spots.get(s.parentId) ?? null) : null);
  /** Up to an ancestor with room, when a card would go deeper than the tree allows. */
  const roomFor = (p: Spot | null, kind: OstKind) => {
    let s = p;
    if (kind === "outcome") while (s && s.kind === "outcome" && s.outcomeDepth + 1 > L.outcomeDepth) s = parentOf(s);
    if (kind === "opportunity") while (s && s.kind === "opportunity" && s.depth + 1 > L.depth) s = parentOf(s);
    return s;
  };
  const backingOf = (x: Record<string, unknown>): Backing => {
    const seen = new Set<string>();
    const quotes = (Array.isArray(x.fragmentIds) ? x.fragmentIds : [])
      .map((id) => pieceOf.get(String(id)))
      .filter((q): q is SourceQuote => !!q && !seen.has(q.id) && !!seen.add(q.id))
      .slice(0, L.piecesPerCard)
      .map(quoteRef);
    // What customers said elsewhere in the organization, that the card rests on too.
    for (const id of (Array.isArray(x.pieceIds) ? x.pieceIds : []).slice(0, L.hubPerCard)) {
      const h = ctx.hub?.get(String(id));
      if (h && !quotes.some((q) => q.sourceId === h.quote.sourceId && q.quoteId === h.quote.quoteId)) quotes.push(h.quote);
    }
    const words: OstEvidence[] = [];
    for (const a of items(x.answers)) {
      const ans = answerOf.get(String(a.answerId));
      const said = ans?.words && typeof a.quote === "string" ? verbatim(ans.words, a.quote) : null;
      if (ans && said && words.length < L.answersPerCard && !words.some((w) => w.text === said)) words.push({ id: newId(), kind: "answer", text: said, answerId: ans.answerId, addedBy: "ai", at: now });
    }
    return { quotes, words };
  };

  // New cards, parents before their children.
  const cards: Extract<Proposal, { kind: "card" }>[] = [];
  const fresh = new Map<string, Spot>();
  let trees = 0;
  for (const x of items(r.cards)) {
    if (cards.length >= L.cards) break;
    const ref = clip(x.id, 24);
    const kind = KINDS.includes(x.kind as OstKind) ? (x.kind as OstKind) : null;
    if (!ref || !kind || fresh.has(ref)) continue;
    let parent: Spot | null = typeof x.parentCard === "string" ? (spots.get(byRef.get(x.parentCard)?.id ?? "") ?? null) : null;
    if (!parent && typeof x.parentNew === "string") parent = fresh.get(x.parentNew) ?? null;
    if (parent && !canHold(parent.kind, kind)) continue;
    parent = roomFor(parent, kind);
    // Only an outcome starts a tree of its own.
    if (!parent && kind !== "outcome") continue;
    const title = clip(x.title, L.title);
    const root = parent ? parent.root : `new:${ref}`;
    const inTree = treeTitles.get(root) ?? new Set<string>();
    if (!title || parent?.titles.has(key(title)) || inTree.has(key(title))) continue;
    if (parent ? parent.added >= L.perParent : trees >= L.trees) continue;
    const backing = backingOf(x);
    if (!backing.quotes.length && !backing.words.length && kind !== "opportunity") continue;
    const description = clip(x.description, L.description);
    const m = kind === "outcome" && x.metric ? metricFields(rec(x.metric), ctx) : {};
    const metric: OstMetric | undefined = m.name ? { name: m.name, direction: m.direction ?? "increase", baseline: m.baseline ?? null, current: m.current ?? m.baseline ?? null, target: m.target ?? null, ...(m.unit ? { unit: m.unit } : {}), ...(m.timeframe ? { timeframe: m.timeframe } : {}) } : undefined;
    const assumptions = kind === "solution" ? assumptionsFrom(x.assumptions, new Set()) : [];
    const t = rec(x.test);
    const test: OstTest | undefined = kind === "test" ? { assumptionIds: [], ...(clip(t.method, 160) ? { method: clip(t.method, 160) } : {}), ...(clip(t.criterion, 160) ? { criterion: clip(t.criterion, 160) } : {}) } : undefined;
    const card = newCard(kind, { title, createdBy: "ai", ...(description ? { description } : {}), ...(metric ? { metric } : {}), ...(assumptions.length ? { assumptions } : {}), ...(test ? { test } : {}) });
    const cardId = idOf(`card:${ref}`);
    const p: Extract<Proposal, { kind: "card" }> = { id: idOf(`p:card:${ref}`), kind: "card", cardId, parentId: parent?.id ?? null, card, backing, why: why(x) };
    if (ctx.settled.has(proposalKey(p, cards))) continue;
    if (parent) {
      parent.titles.add(key(title));
      parent.added++;
    } else trees++;
    treeTitles.set(root, inTree.add(key(title)));
    const spot: Spot = { id: cardId, kind, depth: kind === "opportunity" ? (parent?.kind === "opportunity" ? parent.depth + 1 : 1) : 0, outcomeDepth: kind === "outcome" && parent ? parent.outcomeDepth + 1 : 0, root, parentId: parent?.id ?? null, titles: new Set(), added: 0 };
    fresh.set(ref, spot);
    spots.set(cardId, spot);
    cards.push(p);
  }

  /** The card or one of the cards above it is `id` (a move there would put a card under itself). */
  const under = (s: Spot | null, id: string) => {
    for (let x = s; x; x = parentOf(x)) if (x.id === id) return true;
    return false;
  };
  const cardAt = (v: unknown) => (typeof v === "string" ? byRef.get(v) : undefined);

  // Moves: where the dump or the answers say a card belongs.
  const moves: Proposal[] = [];
  const moved = new Set<string>();
  for (const x of items(r.moves)) {
    if (moves.length >= L.moves) break;
    const c = cardAt(x.cardId);
    if (!c || moved.has(c.id)) continue;
    const target: Spot | null = typeof x.parentCard === "string" ? (spots.get(cardAt(x.parentCard)?.id ?? "") ?? null) : typeof x.parentNew === "string" ? (fresh.get(x.parentNew) ?? null) : null;
    const from = c.parentRef ? (byRef.get(c.parentRef)?.id ?? null) : null;
    if (target ? !canHold(target.kind, c.kind) || target.id === from || under(target, c.id) : c.kind !== "outcome" || !from) continue;
    const p: Proposal = { id: idOf(`p:move:${c.id}`), kind: "move", cardId: c.id, fromParent: from, parentId: target?.id ?? null, why: why(x) };
    if (ctx.settled.has(proposalKey(p, cards))) continue;
    moved.add(c.id);
    moves.push(p);
  }

  // Merges: two cards the builder says are the same. The one Screens projects link to stays.
  const merges: Extract<Proposal, { kind: "merge" }>[] = [];
  const into = new Map<string, string>();
  for (const x of items(r.merges)) {
    if (merges.length >= L.merges) break;
    let keep = cardAt(x.keep);
    let drop = cardAt(x.drop);
    if (!keep || !drop || keep.id === drop.id || keep.kind !== drop.kind) continue;
    if ([keep.id, drop.id].some((id) => moved.has(id) || into.has(id) || [...into.values()].includes(id))) continue;
    if (under(spots.get(keep.id)!, drop.id) || under(spots.get(drop.id)!, keep.id)) continue;
    if (keep.designs && drop.designs) continue;
    if (drop.designs) [keep, drop] = [drop, keep];
    const t = clip(x.title, L.title);
    const p: Extract<Proposal, { kind: "merge" }> = { id: idOf(`p:merge:${keep.id}:${drop.id}`), kind: "merge", cardId: keep.id, dropId: drop.id, ...(t && key(t) !== key(keep.title) ? { title: t } : {}), why: why(x) };
    if (ctx.settled.has(proposalKey(p))) continue;
    into.set(drop.id, keep.id);
    merges.push(p);
  }
  // What was about the card that folds in is about the one it folds into.
  const live = (id: string | undefined) => (id ? (into.get(id) ?? id) : undefined);
  for (const p of cards) if (p.parentId && into.has(p.parentId)) p.parentId = into.get(p.parentId)!;
  for (const p of moves) if (p.kind === "move" && p.parentId && into.has(p.parentId)) p.parentId = into.get(p.parentId)!;
  const cardById = new Map(ctx.cards.map((c) => [c.id, c]));

  // Rewording: a card the dump or the answers sharpen (never one that folds into another).
  const edits: Proposal[] = [];
  const edited = new Set<string>();
  for (const x of items(r.edits)) {
    if (edits.length >= L.edits) break;
    const c = cardAt(x.cardId);
    if (!c || into.has(c.id) || edited.has(c.id)) continue;
    const t = clip(x.title, L.title);
    const d = clip(x.description, L.description);
    const title = t && key(t) !== key(c.title) ? t : undefined;
    const description = d && d !== c.description ? d : undefined;
    if (!title && !description) continue;
    const p: Proposal = { id: idOf(`p:edit:${c.id}`), kind: "edit", cardId: c.id, from: c.title, ...(title ? { title } : {}), ...(description ? { description } : {}), why: why(x) };
    if (ctx.settled.has(proposalKey(p))) continue;
    edited.add(c.id);
    edits.push(p);
  }

  // The dump's words on cards that are there, for them or against them.
  const words: Proposal[] = [];
  const pairs = new Set<string>();
  const perCard = new Map<string, number>();
  const perPiece = new Map<string, number>();
  let against = 0;
  for (const x of items(r.evidence)) {
    const id = live(cardAt(x.cardId)?.id);
    const c = id ? cardById.get(id) : undefined;
    const q = pieceOf.get(String(x.fragmentId));
    if (!c || !q || !(c.kind === "opportunity" || c.kind === "solution" || c.kind === "outcome")) continue;
    const stance = x.stance === "against" ? "against" : "attach";
    if (ctx.has(c.id, q.span) || q.dismissed?.includes(c.id) || pairs.has(`${c.id}:${q.id}`)) continue;
    if ((perCard.get(c.id) ?? 0) >= L.perCard || (perPiece.get(q.id) ?? 0) >= L.perPiece || (stance === "against" && against >= L.against)) continue;
    pairs.add(`${c.id}:${q.id}`);
    perCard.set(c.id, (perCard.get(c.id) ?? 0) + 1);
    perPiece.set(q.id, (perPiece.get(q.id) ?? 0) + 1);
    if (stance === "against") against++;
    words.push({ id: idOf(`p:${stance}:${c.id}:${q.id}`), kind: stance, cardId: c.id, quote: quoteRef(q), why: why(x) });
  }
  // Customers' quotes from the organization's other sources, on cards that are there.
  for (const x of items(r.quotes)) {
    const id = live(cardAt(x.cardId)?.id);
    const c = id ? cardById.get(id) : undefined;
    const h = ctx.hub?.get(String(x.pieceId));
    if (!c || !h || !(c.kind === "opportunity" || c.kind === "solution" || c.kind === "outcome")) continue;
    const stance = x.stance === "against" ? "against" : "attach";
    const q = `${h.quote.sourceId}:${h.quote.quoteId}`;
    if (ctx.hasQuote?.(c.id, h.quote, h.span) || pairs.has(`${c.id}:${q}`)) continue;
    if ((perCard.get(c.id) ?? 0) >= L.perCard || (perPiece.get(q) ?? 0) >= L.perPiece || (stance === "against" && against >= L.against)) continue;
    pairs.add(`${c.id}:${q}`);
    perCard.set(c.id, (perCard.get(c.id) ?? 0) + 1);
    perPiece.set(q, (perPiece.get(q) ?? 0) + 1);
    if (stance === "against") against++;
    words.push({ id: idOf(`p:${stance}:${c.id}:${q}`), kind: stance, cardId: c.id, quote: h.quote, why: why(x) });
  }

  // Beliefs about solutions that are there, one proposal per solution.
  const beliefs = new Map<string, Extract<Proposal, { kind: "assumption" }>>();
  for (const x of items(r.assumptions)) {
    const id = live(cardAt(x.cardId)?.id);
    const c = id ? cardById.get(id) : undefined;
    if (c?.kind !== "solution") continue;
    const cur = beliefs.get(c.id);
    const have = new Set([...c.assumptions, ...(cur?.assumptions.map((a) => a.text) ?? [])].map(key));
    const add = assumptionsFrom([x], have).slice(0, L.assumptions - (cur?.assumptions.length ?? 0));
    if (!add.length) continue;
    if (cur) cur.assumptions.push(...add);
    else beliefs.set(c.id, { id: idOf(`p:assumption:${c.id}`), kind: "assumption", cardId: c.id, assumptions: add, why: why(x) });
  }
  const assumptions = [...beliefs.values()].filter((p) => !ctx.settled.has(proposalKey(p)));

  // Numbers for outcomes that are there: only what changes, only as the builder wrote it.
  const metrics: Proposal[] = [];
  for (const x of items(r.metrics)) {
    const id = live(cardAt(x.cardId)?.id);
    const c = id ? cardById.get(id) : undefined;
    if (c?.kind !== "outcome" || metrics.some((p) => p.cardId === c.id)) continue;
    const cur = (c.metric ?? {}) as Partial<OstMetric>;
    const patch = Object.fromEntries(Object.entries(metricFields(x, ctx)).filter(([k, v]) => cur[k as keyof OstMetric] !== v)) as Partial<OstMetric>;
    if (!Object.keys(patch).length) continue;
    const p: Proposal = { id: idOf(`p:metric:${c.id}`), kind: "metric", cardId: c.id, metric: patch, why: why(x) };
    if (!ctx.settled.has(proposalKey(p))) metrics.push(p);
  }

  // Open questions and pushback, beside the card they're about.
  const notes: Proposal[] = [];
  const noted = new Set<string>();
  for (const x of items(r.notes)) {
    if (notes.length >= L.notes) break;
    const text = clip(x.text, L.note);
    const k = key(text);
    if (!text || noted.has(k)) continue;
    const anchorId = live(cardAt(x.cardId)?.id) ?? (typeof x.newCard === "string" ? fresh.get(x.newCard)?.id : undefined) ?? (ctx.anchor && onBoard.has(ctx.anchor) ? ctx.anchor : null);
    const p: Proposal = { id: idOf(`p:note:${k}`), kind: "note", cardId: idOf(`note:${k}`), anchorId, textId: idOf(`note-text:${k}`), text, color: x.kind === "challenge" ? "pink" : "yellow", why: why(x) };
    if (ctx.settled.has(proposalKey(p))) continue;
    noted.add(k);
    notes.push(p);
  }

  // What waits on a card that didn't hold up goes with it; a need of Qalam AI's own reading stays
  // only while it holds something of the builder's.
  let kept: Proposal[] = [...cards, ...moves, ...merges, ...edits, ...words, ...assumptions, ...metrics, ...notes];
  for (;;) {
    const newIds = new Set(kept.filter((p) => p.kind === "card").map((p) => p.cardId));
    const there = (id: string | null) => !id || onBoard.has(id) || newIds.has(id);
    const next = kept.filter((p) => {
      if (p.kind === "card") {
        if (!there(p.parentId)) return false;
        if (p.card.kind !== "opportunity" || p.backing.quotes.length || p.backing.words.length) return true;
        return kept.some((q) => (q.kind === "card" || q.kind === "move") && q.parentId === p.cardId);
      }
      if (p.kind === "move") return there(p.parentId);
      if (p.kind === "note") return there(p.anchorId);
      return true;
    });
    if (next.length === kept.length) break;
    kept = next;
  }
  return kept.slice(0, L.total);
}

/** What a placement still being written already settles: each card, move or note once its object has closed. */
export function partialPlace(partial: unknown, ctx: PlaceContext, ids: Map<string, string>): Proposal[] {
  const r = rec(partial);
  const closed = (v: unknown) => (Array.isArray(v) ? v.filter((x) => !!x && !isPartial(x)) : []);
  return sanitizePlace(
    { cards: closed(r.cards), evidence: closed(r.evidence), quotes: closed(r.quotes), assumptions: closed(r.assumptions), metrics: closed(r.metrics), edits: closed(r.edits), moves: closed(r.moves), merges: closed(r.merges), notes: closed(r.notes) },
    ctx,
    ids,
  );
}
