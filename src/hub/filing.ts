import { FILING_MAX_LINES, type TopicsRequest } from "@/ai/topics";
import { quotePiece, type SourceQuote, type SourceRecord } from "@/discovery/sources";
import type { ContextFields, Product } from "@/org/context-md";
import type { OrgContext, PackRequest } from "@/org/pack";
import { isEvidence, sameTopic, sameWords, sanitizeFiling, type Applied, type Citable, type Filing, type FilingSent, type SentTopic, type TopicInfo, type TopicKind } from "./topics";

/**
 * Filing new material into the organization's topic pages: the quotes of some sources that the
 * pages haven't seen (a brain dump's pieces too, as the team's words), a few dozen per call. Each
 * call carries the topics there are (and the product's and segments' pages not made yet), the
 * pages the material may change in full, and what else the organization knows; Qalam AI answers
 * with lines, code keeps the ones it can stand behind (src/hub/topics.ts), and the organization's
 * store writes them. Every quote sent is noted as seen, kept or not, so it isn't sent again. It
 * runs in a window (src/org/filing.ts) and in the core (a capture, the inbox): each passes how it
 * reaches the pages, the search index and Qalam AI.
 */

/** How a window or the core reaches what filing needs. */
export interface FilingDeps {
  products: Product[];
  about: ContextFields;
  /** What Qalam AI is told the product (or the whole organization) is. */
  productLine: (product: string | null) => string;
  listTopics: () => Promise<TopicInfo[]>;
  pack: (r: PackRequest) => Promise<OrgContext | null>;
  /** The filing call's answer (src/ai/topics.ts). */
  call: (body: TopicsRequest, signal?: AbortSignal) => Promise<unknown>;
  /** Write what code kept, and note the quotes as seen. */
  file: (filing: Filing, from: string, filed: Record<string, string[]>) => Promise<{ created: string[]; counts: Applied["counts"]; pages: { id: string; title: string; kind: TopicKind }[] }>;
}

/** Material in one call. */
const CALL_QUOTES = 80;
const CALL_CHARS = 16_000;
/** Pages sent in full, at most. */
const PAGE_LINES = Math.min(250, FILING_MAX_LINES);
const MAX_PAGES = 12;
/** What else the organization knows, in tokens. */
const KNOW_BUDGET = 2000;
const KNOW_TYPES = ["quote", "need", "evidence", "card", "assumption", "decision", "context"];

export interface FilingTotals {
  calls: number;
  created: number;
  added: number;
  revised: number;
  retired: number;
  disputed: number;
  /** The pages that changed, newest change last. */
  pages: { id: string; title: string; kind: TopicKind }[];
}

interface Item {
  s: SourceRecord;
  q: SourceQuote;
}

/** The quotes of these sources the topic pages haven't seen. */
export function unfiled(sources: SourceRecord[]): Item[] {
  return sources.flatMap((s) => {
    const seen = new Set(s.filed ?? []);
    return s.quotes.filter((q) => q.text.trim() && !seen.has(q.id)).map((q) => ({ s, q }));
  });
}

/** The material in calls: a source's quotes stay together where they fit. */
function batches(items: Item[]): Item[][] {
  const out: Item[][] = [];
  let cur: Item[] = [];
  let chars = 0;
  for (const it of items) {
    const n = it.q.text.length;
    if (cur.length && (cur.length >= CALL_QUOTES || chars + n > CALL_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** “Sara interview”, “Sara interview” and “Support tickets”, “Sara interview” and 3 other sources. */
export function materialName(titles: string[]): string {
  const t = [...new Set(titles)].map((x) => `“${x.replace(/\s+/g, " ").trim() || "Untitled"}”`);
  if (t.length <= 2) return t.join(" and ");
  return `${t[0]} and ${t.length - 1} other sources`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * File the sources' unseen quotes into the topic pages. `product`: the product the material is
 * for (a board's), else each source's own. Stops between calls when `signal` aborts.
 */
export async function fileMaterial(deps: FilingDeps, sources: SourceRecord[], o: { product?: string | null; signal?: AbortSignal; onStep?: (done: number, of: number) => void } = {}): Promise<FilingTotals> {
  const totals: FilingTotals = { calls: 0, created: 0, added: 0, revised: 0, retired: 0, disputed: 0, pages: [] };
  const byProduct = new Map<string | null, Item[]>();
  for (const it of unfiled(sources)) {
    const p = o.product !== undefined ? o.product : (it.s.product ?? null);
    byProduct.set(p, [...(byProduct.get(p) ?? []), it]);
  }
  const calls = [...byProduct].flatMap(([product, items]) => batches(items).map((b) => ({ product, items: b })));
  for (const [i, c] of calls.entries()) {
    if (o.signal?.aborted) break;
    o.onStep?.(i, calls.length);
    await fileOne(deps, c.items, c.product, o.signal, totals);
    totals.calls++;
  }
  o.onStep?.(calls.length, calls.length);
  return totals;
}

async function fileOne(deps: FilingDeps, items: Item[], product: string | null, signal: AbortSignal | undefined, totals: FilingTotals) {
  const { products, about } = deps;
  const pages = await deps.listTopics();
  const sent: FilingSent = { topics: new Map(), lines: new Map(), cites: new Map() };

  // The topics there are, then the product's and its segments' pages not made yet (every product's,
  // for material that's the whole organization's: it may be about any of them).
  const topics: TopicsRequest["topics"] = [];
  const callId = new Map<string, string>();
  const add = (t: SentTopic, lines: number) => {
    const id = `t${topics.length + 1}`;
    topics.push({ id, kind: t.kind, title: clip(t.title, 200), lines, made: !!t.id });
    sent.topics.set(id, t);
    if (t.id) callId.set(t.id, id);
  };
  for (const p of pages.slice(0, 260)) add({ id: p.id, kind: p.kind, title: p.title, products: p.products, lines: p.lines.map((l) => l.text) }, p.lines.length);
  const forProducts = product ? products.filter((p) => p.id === product) : products;
  for (const p of forProducts)
    if (!pages.some((t) => t.kind === "product" && t.products.includes(p.id))) add({ id: null, kind: "product", title: p.name, products: [p.id], lines: [] }, 0);
  const segments = [...forProducts.flatMap((p) => p.segments.map((s) => ({ s, products: [p.id] }))), ...about.segments.map((s) => ({ s, products: [] as string[] }))];
  for (const { s, products: ps } of segments)
    if (s.trim() && !pages.some((t) => t.kind === "segment" && sameTopic(t.title, s)) && !topics.some((t) => t.kind === "segment" && sameTopic(t.title, s))) add({ id: null, kind: "segment", title: s.trim(), products: ps, lines: [] }, 0);

  // The material, under q ids; what the pages may change, in full.
  const material: TopicsRequest["material"] = items.map((it, i) => {
    const team = it.s.kind === "dump";
    const id = `q${i + 1}`;
    sent.cites.set(id, { ref: quotePiece(it.q.id), text: it.q.text, label: it.s.title, evidence: !team, product: it.s.product ?? null });
    return { id, text: clip(it.q.text, 1200), source: clip(it.s.title, 300), speaker: it.q.speaker ? clip(it.q.speaker, 80) : null, kind: team ? (it.q.role ?? "note") : it.q.kind, team };
  });
  const quoteIds = new Map(items.map((it, i) => [it.q.id, `q${i + 1}`]));
  const needs = [...new Set(items.map((it) => it.s))]
    .flatMap((s) => s.needs.map((n) => ({ title: clip(n.title, 200), quoteIds: n.quoteIds.map((q) => quoteIds.get(q)).filter((x): x is string => !!x).slice(0, 30) })))
    .filter((n) => n.quoteIds.length)
    .slice(0, 60);
  const query = [...needs.map((n) => n.title), ...items.map((it) => it.q.text)].join("\n").slice(0, 4000);
  const full = await pagesFor(deps, pages, query, product);
  let n = 0;
  const pagesIn: TopicsRequest["pages"] = full.map((p) => ({
    topic: callId.get(p.id)!,
    lines: p.lines.slice(-80).map((l) => {
      const id = `l${++n}`;
      const disputed = (l.disputes ?? []).map((d) => clip(d.text, 400)).slice(0, 8);
      sent.lines.set(id, { topic: callId.get(p.id)!, line: { id: l.id, by: l.by, text: l.text, section: l.section, disputed } });
      return { id, section: l.section, text: clip(l.text, 400), by: l.by, disputed };
    }),
  }));

  // What else the organization knows that bears on it (not the material itself, nor the pages).
  const org = await deps.pack({ query, product: product ?? undefined, budget: KNOW_BUDGET, types: KNOW_TYPES, exclude: items.map((it) => quotePiece(it.q.id)) });
  for (const p of org?.pieces ?? []) sent.cites.set(p.k, { ref: p.ref, text: p.text, label: (p.title ?? "").replace(/\s+/g, " ").trim(), evidence: isEvidence(p), product: p.product } satisfies Citable);

  const body: TopicsRequest = { product: deps.productLine(product).slice(0, 2000), topics, pages: pagesIn, material, needs, ...(org ? { context: org.context } : {}) };
  const data = await deps.call(body, signal);
  const filing = sanitizeFiling(data, sent, { products: product ? [product] : [] });
  const filed: Record<string, string[]> = {};
  for (const it of items) filed[it.s.id] = [...(filed[it.s.id] ?? []), it.q.id];
  const r = await deps.file(filing, materialName(items.map((it) => it.s.title)), filed);
  totals.created += r.created.length;
  totals.added += r.counts.added;
  totals.revised += r.counts.revised;
  totals.retired += r.counts.retired;
  totals.disputed += r.counts.disputed;
  for (const p of r.pages) totals.pages = [...totals.pages.filter((x) => x.id !== p.id), p];
}

/** The pages to send in full: all of them while they're few, else the ones the material is nearest. */
async function pagesFor(deps: FilingDeps, pages: TopicInfo[], query: string, product: string | null): Promise<TopicInfo[]> {
  const made = pages.filter((p) => p.lines.length);
  const lines = (list: TopicInfo[]) => list.reduce((n, p) => n + Math.min(p.lines.length, 80), 0);
  if (lines(made) <= PAGE_LINES && made.length <= MAX_PAGES) return made;
  const order: string[] = [];
  const found = await deps.pack({ query, product: product ?? undefined, budget: 3000, types: ["page"] });
  for (const p of found?.pieces ?? []) {
    const id = p.ref.split(":")[2];
    if (id && !order.includes(id)) order.push(id);
  }
  // Then by the words their titles share with the material.
  const words = new Set(sameWords(query).split(" ").filter((w) => w.length > 3));
  const shared = (p: TopicInfo) => sameWords(p.title).split(" ").filter((w) => words.has(w)).length;
  const rest = made.filter((p) => !order.includes(p.id) && shared(p) > 0).sort((a, b) => shared(b) - shared(a));
  const out: TopicInfo[] = [];
  for (const p of [...order.map((id) => made.find((x) => x.id === id)).filter((x): x is TopicInfo => !!x), ...rest]) {
    if (out.length >= MAX_PAGES || lines([...out, p]) > PAGE_LINES) break;
    out.push(p);
  }
  return out;
}
