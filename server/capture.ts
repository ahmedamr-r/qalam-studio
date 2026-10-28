import { nanoid } from "nanoid";
import { extractCall, synthesizeCall } from "@/ai/discovery";
import { structured } from "@/ai/server";
import { topicsCall } from "@/ai/topics";
import type { CaptureResult } from "@/discovery/capture";
import type { Ingested } from "@/discovery/ingest/core";
import type { Proposal } from "@/discovery/proposals";
import { hasQuote, packCalls, quotePiece, SOURCE_KIND_LABEL, unread, type SourceRecord } from "@/discovery/sources";
import { sanitizeExtract, sanitizeSynthesis, synthCardsOf, type CallChunk, type SynthCard, type SynthQuote } from "@/discovery/synthesis";
import { awaitingRoles, finishExtracted, speakerNote } from "@/discovery/transcript";
import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { cardOf } from "@/discovery/ops";
import { fileMaterial, type FilingDeps, type FilingTotals } from "@/hub/filing";
import { goalsText } from "@/goals/text";
import { contextText } from "@/org/context-md";
import { contextOf, type OrgContext, type PackRequest } from "@/org/pack";
import { indexFor } from "./index/registry";
import { packedPieces, packFor } from "./index/search";
import type { OrgStore } from "./org/store";

/**
 * Capture: material added to the organization rather than to a board (pasted on its home, dropped
 * in its inbox folder), handled by the core, with no board open. It's kept as a source of the
 * organization's, then Qalam AI picks out what customers said in it, files that into the topic
 * pages, and proposes where it fits on each board (one call over the boards' trees). Each board's
 * proposals wait in its own file (hub/placements/<board>.json) until the board reviews them. Every step is the board's own, made
 * here: the same calls, and the same checks on what comes back.
 */

export type { CaptureResult } from "@/discovery/capture";

export interface CaptureOpts {
  /** The product it's for (none: the whole organization). */
  product?: string | null;
  emit?: (label: string) => void;
  signal?: AbortSignal;
}

function indexOf(store: OrgStore) {
  try {
    return indexFor(store);
  } catch {
    return null;
  }
}

/** How the core reaches what filing (and a capture) needs: the store, the index, Qalam AI. */
export async function coreDeps(store: OrgStore): Promise<FilingDeps> {
  const products = await store.listProducts();
  const about = await store.getAbout();
  const goals = await store.getGoals();
  const names = new Map(products.map((p) => [p.id, p.name]));
  const ix = indexOf(store);
  const pack = async (r: PackRequest): Promise<OrgContext | null> => {
    if (!ix) return null;
    await ix.settled();
    const p = await packFor(ix, { query: r.query.slice(0, 4000), anchor: r.anchor, product: r.product, budget: r.budget, wholeTop: r.wholeTop, types: r.types, exclude: r.exclude });
    return contextOf({ block: p.block, items: packedPieces(p) });
  };
  return {
    products,
    about,
    productLine: (id) => {
      const p = products.find((x) => x.id === id);
      return [p ? contextText(p, `The product (${p.name}):`) : "", contextText(about, "The organization:"), goalsText(goals, { product: id ?? null, productName: (x) => names.get(x) })].filter(Boolean).join("\n\n");
    },
    listTopics: () => store.listTopics(),
    pack,
    call: async (body) => (await structured<unknown>(topicsCall(body))).data,
    file: async (f, from, filed) => {
      const r = await store.fileTopics(f, { from, filed });
      return { created: r.created, counts: r.counts, pages: r.pages.map((p) => ({ id: p.id, title: p.title, kind: p.kind })) };
    },
  };
}

// Sources being filed by the core now (by folder and id): asked twice, a source is filed once.
const filing = new Set<string>();

/**
 * File sources into the topic pages here in the core, so what a window started finishes even when
 * it moves on (an organization set up from a brain dump, then a board started). Material that isn't
 * one product's goes as the whole organization's.
 */
export async function fileSources(store: OrgStore, ids: string[], product: string | null = null): Promise<FilingTotals | null> {
  const keys = ids.map((id) => `${store.dir}:${id}`).filter((k) => !filing.has(k));
  if (!keys.length) return null;
  for (const k of keys) filing.add(k);
  try {
    const sources = (await Promise.all(keys.map((k) => store.getSource(k.slice(store.dir.length + 1))))).filter((s): s is SourceRecord => !!s);
    return sources.length ? await fileMaterial(await coreDeps(store), sources, { product }) : null;
  } finally {
    for (const k of keys) filing.delete(k);
  }
}

/** What customers said in the source's unread parts, picked out and checked as on a board. */
async function readIn(store: OrgStore, deps: FilingDeps, s: SourceRecord, o: CaptureOpts): Promise<SourceRecord> {
  const calls = packCalls(unread(s));
  if (!calls.length) return s;
  const product = deps.productLine(s.product ?? null).slice(0, 2000);
  const org = await deps.pack({ query: [product, s.title].join("\n"), product: s.product ?? undefined, budget: 1200, types: ["need", "card", "page"] });
  let cur = s;
  for (const [i, call] of calls.entries()) {
    if (o.signal?.aborted) break;
    o.emit?.(calls.length > 1 ? `Picking out what customers said (part ${i + 1} of ${calls.length})` : "Picking out what customers said");
    const chunks: CallChunk[] = call.map((c, j) => ({ ref: `c${j + 1}`, sourceId: cur.id, start: c.start, text: cur.text.slice(c.start, c.end), ...(cur.pages ? { pages: cur.pages } : {}) }));
    const body = {
      stage: "extract" as const,
      product,
      chunks: chunks.map((c) => ({ id: c.ref, source: cur.title.slice(0, 300), kind: SOURCE_KIND_LABEL[cur.kind], text: c.text, ...(cur.transcript ? { speakers: speakerNote(cur.transcript) } : {}) })),
      ...(org ? { context: org.context } : {}),
    };
    const { data } = await structured<unknown>(extractCall(body));
    const got = finishExtracted(sanitizeExtract(data, chunks, new Map([[cur.id, cur.quotes.map((q) => q.span)]])), () => cur);
    cur = {
      ...cur,
      read: [...new Set([...cur.read, ...call.map((c) => c.index)])],
      quotes: [...cur.quotes, ...got.quotes.map((q) => q.quote)].sort((a, b) => a.span[0] - b.span[0]),
      needs: [...cur.needs, ...got.needs.map((n) => n.need)],
    };
    await store.putSource(cur);
  }
  return cur;
}

interface BoardTree {
  id: string;
  name: string;
  product: string | null;
  doc: Doc;
  cards: SynthCard[];
}

/** Only what's about one board's cards: a mapping, a word against, a new need under one of them. */
function forBoard(raw: unknown, refs: Set<string>): Record<string, unknown> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (k: string, field: string) => (Array.isArray(r[k]) ? (r[k] as Record<string, unknown>[]).filter((x) => refs.has(String(x?.[field]))) : []);
  return { mappings: list("mappings", "cardId"), newOpportunities: list("newOpportunities", "parent"), contradictions: list("contradictions", "cardId") };
}

/** Where the source's quotes fit on the boards of its product (every board, for the whole organization's): proposals for each. */
async function placeIn(store: OrgStore, deps: FilingDeps, s: SourceRecord, o: CaptureOpts): Promise<Record<string, Proposal[]>> {
  if (s.kind === "dump" || !s.quotes.length) return {};
  const boards: BoardTree[] = [];
  let next = 1;
  for (const p of store.listProjects()) {
    if (p.type !== "discovery" || (s.product && p.product && p.product !== s.product)) continue;
    const doc = (await store.getDoc(p.id).catch(() => null))?.doc;
    if (!doc || next > 400) continue;
    const cards = synthCardsOf(doc, next, 401 - next);
    if (!cards.some((c) => c.kind === "outcome")) continue;
    next += cards.length;
    boards.push({ id: p.id, name: p.name, product: p.product ?? null, doc, cards });
  }
  if (!boards.length) return {};
  o.emit?.(`Finding where it fits on ${boards.length === 1 ? `“${boards[0].name}”` : `${boards.length} boards`}`);
  const quotes: SynthQuote[] = s.quotes.slice(0, 150).map((q, i) => ({ ref: `q${i + 1}`, sourceId: s.id, quoteId: q.id, span: q.span }));
  const refByQuote = new Map(quotes.map((q) => [q.quoteId, q.ref]));
  const product = deps.productLine(s.product ?? null).slice(0, 2000);
  const org = await deps.pack({ query: boards.flatMap((b) => b.cards.slice(0, 30).map((c) => c.title)).join("\n"), product: s.product ?? undefined, budget: 1500, types: ["page", "decision", "need", "assumption", "context"] });
  const body = {
    stage: "synthesize" as const,
    product,
    tree: boards.flatMap((b) =>
      b.cards.map((c) => ({ id: c.ref, parent: c.parentRef, kind: c.kind, title: c.title.slice(0, 400), quotes: cardOf(b.doc, c.id)?.evidence.filter((e) => e.kind === "quote").length ?? 0, ...(c.parentRef ? {} : { board: b.name }) })),
    ),
    quotes: s.quotes.slice(0, 150).map((q, i) => ({ id: `q${i + 1}`, text: q.text.slice(0, 1200), source: s.title.slice(0, 300), speaker: q.speaker?.slice(0, 80) ?? null, kind: q.kind })),
    needs: s.needs
      .map((n) => ({ title: n.title.slice(0, 200), quoteIds: n.quoteIds.map((id) => refByQuote.get(id)).filter((x): x is string => !!x).slice(0, 30) }))
      .filter((n) => n.quoteIds.length)
      .slice(0, 60),
    ...(org ? { context: org.context } : {}),
  };
  const { data } = await structured<unknown>(synthesizeCall(body));
  const out: Record<string, Proposal[]> = {};
  for (const b of boards) {
    const outcome = b.cards.find((c) => c.kind === "outcome" && !c.parentRef);
    const proposals = sanitizeSynthesis(forBoard(data, new Set(b.cards.map((c) => c.ref))), {
      cards: b.cards,
      quotes,
      outcomeRef: outcome?.ref ?? null,
      has: (cardId, q) => {
        const n = b.doc.nodes[cardId];
        return isOstCard(n) && hasQuote(n.meta.ost, q.sourceId, q.span, quotePiece(q.quoteId));
      },
    });
    if (proposals.length) out[b.id] = proposals;
  }
  return out;
}

/**
 * Keep material as one of the organization's sources and do what a board would with it: pick out
 * what customers said, file it into the topic pages, propose where it fits on the boards.
 */
export async function captureSource(store: OrgStore, ing: Ingested, o: CaptureOpts = {}): Promise<CaptureResult> {
  const emit = o.emit ?? (() => {});
  let s: SourceRecord = {
    v: 1,
    id: nanoid(10),
    projectId: "",
    boards: [],
    product: o.product ?? null,
    kind: ing.kind,
    title: ing.title,
    ...(ing.origin ? { origin: ing.origin } : {}),
    text: ing.text,
    ...(ing.pages ? { pages: ing.pages } : {}),
    ...(ing.truncated ? { truncated: true } : {}),
    ...(ing.segments && ing.transcript ? { segments: ing.segments, transcript: ing.transcript } : {}),
    addedAt: Date.now(),
    read: [],
    quotes: [],
    needs: [],
  };
  emit(`Keeping “${s.title}” in the organization`);
  await store.putSource(s);
  const result = (filed?: FilingTotals, placed: CaptureResult["placed"] = []): CaptureResult => ({ sourceId: s.id, title: s.title, quotes: s.quotes.length, needs: s.needs.length, ...(filed ? { filed } : {}), placed });
  if (awaitingRoles(s)) return { ...result(), waiting: "roles" };
  const deps = await coreDeps(store);
  s = await readIn(store, deps, s, o);
  if (o.signal?.aborted || !s.quotes.length) return result();
  emit("Filing it into the topic pages");
  const filed = await fileMaterial(deps, [s], { product: s.product ?? null, signal: o.signal });
  // Filing noted the quotes it saw on the source: build on that copy.
  s = (await store.getSource(s.id)) ?? s;
  const placements = await placeIn(store, deps, s, o);
  for (const [board, list] of Object.entries(placements)) await store.setPlacements(board, s.id, list);
  // Its product, when everything it fits is one product's.
  const products = new Set(Object.keys(placements).map((b) => store.getProject(b)?.record.product ?? null));
  const only = products.size === 1 ? [...products][0] : null;
  if (!s.product && only) await store.putSource((s = { ...s, product: only }));
  return result(
    filed,
    Object.entries(placements).map(([board, list]) => ({ board, name: store.getProject(board)?.record.name ?? "A board", count: list.length })),
  );
}
