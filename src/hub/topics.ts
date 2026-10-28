import { quoteFinder } from "@/discovery/quotes";

/**
 * Topic pages (pure): one living page for each customer need, each kind of customer (segment) and
 * each product, saying where the organization stands: what it knows (customers said or did it, a
 * test showed it), what the team believes, what speaks against it, and what nobody knows yet.
 * Qalam AI files new material into them as it arrives (Karpathy's LLM Wiki: ingest, query, lint),
 * and code checks every line it proposes: each cites the pieces it rests on, and a line is kept
 * only when every piece it cites was sent, its quoted words are in those pieces, and so are its
 * numbers. A line in "We know" or "Against" rests on customers' words or a test's result; the
 * team's words alone make it something "We believe". Qalam AI never rewrites what people wrote:
 * it adds lines, revises or takes back its own, and disputes anyone's with what speaks against it.
 */

export const TOPIC_KINDS = ["need", "segment", "product"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

export const SECTIONS = ["know", "believe", "against", "open"] as const;
export type TopicSection = (typeof SECTIONS)[number];

export const SECTION_HEADING: Record<TopicSection, string> = { know: "We know", believe: "We believe", against: "Against", open: "Open questions" };
/** How people see each kind: a need page is a customer's problem (the board's problem cards rest on it). */
export const TOPIC_KIND_LABEL: Record<TopicKind, string> = { need: "Problem", segment: "Segment", product: "Product" };

export type Author = "qalam" | "person";

/** Something said against a line, under it. */
export interface TopicDispute {
  id: string;
  text: string;
  by: Author;
  cites: string[];
  /** What a reader sees its pieces as: their sources' and boards' names. */
  from: string[];
  at: number;
}

export interface TopicLine {
  id: string;
  section: TopicSection;
  text: string;
  /** Qalam AI (checked against what it cites) or a person (never rewritten by Qalam AI). */
  by: Author;
  /** The pieces it rests on (refs). */
  cites: string[];
  from: string[];
  at: number;
  disputes?: TopicDispute[];
  /** Indented text under it that isn't a dispute, kept as written. */
  more?: string;
}

export interface TopicEvent {
  at: number;
  text: string;
}

export interface Topic {
  id: string;
  kind: TopicKind;
  title: string;
  /** The products it's about (none: the whole organization). */
  products: string[];
  createdAt: number;
  updatedAt: number;
  lines: TopicLine[];
  /** What changed on it, newest first. */
  history: TopicEvent[];
  /** Text under the title, before the first section, kept as written. */
  intro?: string;
  /** Text in a section before its lines, kept as written. */
  intros?: Partial<Record<TopicSection, string>>;
  /** Sections Qalam doesn't know, kept as written (at the end). */
  notes?: string;
  /** Front matter fields Qalam doesn't know, kept as written. */
  extra?: Record<string, unknown>;
}

export const TOPIC_LIMITS = { title: 100, line: 320, linesPerTopic: 80, history: 50, newTopics: 8, add: 60, revise: 20, retire: 10, dispute: 12, cites: 12, why: 200 } as const;

/** Words only, for telling two texts apart ("Late deliveries." and "late deliveries" are the same line). */
export const sameWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const wordSet = (s: string) => new Set(sameWords(s).split(" ").filter((w) => w.length > 2));

/** Two titles that name the same topic: the same words, or nearly all of them. */
export function sameTopic(a: string, b: string): boolean {
  if (sameWords(a) === sameWords(b)) return true;
  const x = wordSet(a);
  const y = wordSet(b);
  if (x.size < 2 || y.size < 2) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.75;
}

// ---------------------------------------------------------------------------
// What a line can rest on

/** A piece a filing call sent, under its id there (q…, k…). */
export interface Citable {
  ref: string;
  text: string;
  /** What a reader sees it as: its source's or board's name. */
  label: string;
  /** Customers' own words, or a test's result. */
  evidence: boolean;
  product: string | null;
}

const DONE_TESTS = new Set(["passed", "failed", "inconclusive"]);

/** Customers' own words, or a test's result: what "We know" and "Against" rest on. A brain dump's pieces are the team's. */
export function isEvidence(p: { type: string; sub?: string | null; stage?: string | null }): boolean {
  if (p.type === "quote") return !(p.sub ?? "").startsWith("dump:");
  if (p.type === "evidence") return p.sub === "quote";
  if (p.type === "card") return p.sub === "test" && DONE_TESTS.has(p.stage ?? "");
  return false;
}

const IDS = /\s*\[(?:[a-z]{1,2}\d{1,4})(?:\s*,\s*[a-z]{0,2}\d{1,4})*\]/gi;

/**
 * The numbers in a text, as written and with their unit applied ("2M" is 2 and 2,000,000), digits
 * against letters too ("9am", "10pm"): a line's numbers must be among what it cites.
 */
export function valuesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)*)(?:\s*(k|m|bn|%)(?![a-z]))?/gi)) {
    // "1,200" is a thousands separator; "1,5" (one decimal place) reads as a decimal comma.
    const value = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m[1]) ? Number(m[1].replace(/,/g, "")) : Number(m[1].replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const unit = m[2]?.toLowerCase();
    out.push(value);
    if (unit === "k" || unit === "m" || unit === "bn") out.push(value * (unit === "k" ? 1e3 : unit === "m" ? 1e6 : 1e9));
  }
  return out;
}
const QUOTED = /[“"]([^”"]+)[”"]/g;

/** A line as written: one line, no ids, no bullet. */
export function cleanLine(s: string): string {
  return s
    .replace(IDS, "")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .trim();
}

/**
 * The line's words if code can stand behind them, else null: one sentence at most so long, its
 * quotation marks closed, every quote in it found word for word in a piece it cites (or in `also`,
 * words already checked), and every number in it there too.
 */
export function checkWords(raw: unknown, cited: Pick<Citable, "text">[], also = "", max: number = TOPIC_LIMITS.line): string | null {
  if (typeof raw !== "string") return null;
  const text = cleanLine(raw);
  if (text.length < 3 || text.length > max) return null;
  const opens = (text.match(/“/g) ?? []).length;
  if (opens !== (text.match(/”/g) ?? []).length || (text.match(/"/g) ?? []).length % 2) return null;
  const hay = [...cited.map((c) => c.text), also].filter(Boolean);
  const finders = hay.map((t) => quoteFinder(t));
  for (const m of text.matchAll(QUOTED)) {
    const words = m[1].trim();
    if (words && !finders.some((f) => f(words, Math.min(8, words.length)))) return null;
  }
  const known = new Set(hay.flatMap(valuesIn));
  for (const m of text.replace(QUOTED, " ").matchAll(/(\d+(?:[.,]\d+)*)(?:\s*(k|m|bn|%)(?![a-z]))?/gi)) if (!valuesIn(m[0]).some((v) => known.has(v))) return null;
  return text;
}

/** The names a line's pieces show as, each once. */
export const labelsOf = (cited: Pick<Citable, "label">[]) => [...new Set(cited.map((c) => c.label.trim()).filter(Boolean))];

// ---------------------------------------------------------------------------
// A filing call: what it was sent, and its answer as code keeps it

/** A topic the call named: a page, or a product's or segment's page not made yet (`id` null). */
export interface SentTopic {
  id: string | null;
  kind: TopicKind;
  title: string;
  products: string[];
  /** Its lines' words (for leaving out what it already says). */
  lines: string[];
}

export interface SentLine {
  topic: string;
  /** `disputed`: what's already said against it. */
  line: Pick<TopicLine, "id" | "by" | "text" | "section"> & { disputed?: string[] };
}

export interface FilingSent {
  /** By call id (t1…). */
  topics: Map<string, SentTopic>;
  /** By call id (l1…). */
  lines: Map<string, SentLine>;
  /** By call id (q1…, k1…). */
  cites: Map<string, Citable>;
}

export interface FiledWords {
  text: string;
  cites: string[];
  from: string[];
  /** The products of what it cites. */
  products: string[];
}

export interface Filing {
  /** Pages to start (`key` is what `add` names them by: "new:<key>"). */
  create: { key: string; kind: TopicKind; title: string; products: string[] }[];
  add: (FiledWords & { topic: string; section: TopicSection })[];
  revise: (FiledWords & { topic: string; line: string })[];
  retire: { topic: string; line: string; why: string }[];
  dispute: (FiledWords & { topic: string; line: string })[];
}

export const emptyFiling = (): Filing => ({ create: [], add: [], revise: [], retire: [], dispute: [] });
export const filingSize = (f: Filing) => f.add.length + f.revise.length + f.retire.length + f.dispute.length;

const NEW_ID = /^n\d{1,2}$/;

/** The answer's items of one kind (objects only). */
const items = (raw: unknown, key: string): Record<string, unknown>[] => {
  const v = (raw as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
};

/**
 * Qalam AI's filing, as code keeps it: lines on pages it was sent (or new ones it named), resting
 * on pieces it was sent, their words checked against those pieces. New topics that repeat a page
 * become that page; a new topic with no line kept isn't started. `products`: the material's, for
 * the pages it starts.
 */
export function sanitizeFiling(raw: unknown, sent: FilingSent, o: { products?: string[] } = {}): Filing {
  const out = emptyFiling();
  /** Where each id the answer may name lands: a page ("<id>") or a page to start ("new:<key>"). */
  const target = new Map<string, string>();
  const starting = new Map<string, Filing["create"][number] & { lines: string[] }>();
  for (const [cid, t] of sent.topics) {
    if (t.id) target.set(cid, t.id);
    else {
      target.set(cid, `new:${cid}`);
      starting.set(cid, { key: cid, kind: t.kind, title: t.title, products: t.products, lines: [] });
    }
  }
  const sentTitles = [...sent.topics].map(([cid, t]) => ({ cid, title: t.title }));
  for (const n of items(raw, "newTopics").slice(0, TOPIC_LIMITS.newTopics * 2)) {
    const id = typeof n.id === "string" ? n.id.trim() : "";
    const kind = n.kind === "segment" ? "segment" : n.kind === "need" ? "need" : null;
    const title = typeof n.title === "string" ? cleanLine(n.title).replace(/^[“"]|[”"]$/g, "").replace(/[.。]+$/, "") : "";
    if (!NEW_ID.test(id) || target.has(id) || !kind || title.length < 3 || title.length > TOPIC_LIMITS.title) continue;
    const same = sentTitles.find((t) => sameTopic(t.title, title)) ?? [...starting.values()].map((s) => ({ cid: s.key, title: s.title })).find((t) => sameTopic(t.title, title));
    if (same) {
      target.set(id, target.get(same.cid)!);
      continue;
    }
    if ([...starting.values()].filter((s) => NEW_ID.test(s.key)).length >= TOPIC_LIMITS.newTopics) continue;
    target.set(id, `new:${id}`);
    starting.set(id, { key: id, kind, title, products: [...new Set(o.products ?? [])], lines: [] });
  }

  const linesOn = new Map<string, string[]>();
  for (const [cid, t] of sent.topics) linesOn.set(target.get(cid)!, t.lines.map(sameWords));
  const cite = (v: unknown): Citable[] => {
    const seen = new Set<string>();
    const list: Citable[] = [];
    for (const id of Array.isArray(v) ? v : []) {
      const c = typeof id === "string" ? sent.cites.get(id.trim().replace(/^\[|\]$/g, "")) : undefined;
      if (!c || seen.has(c.ref)) continue;
      seen.add(c.ref);
      list.push(c);
      if (list.length >= TOPIC_LIMITS.cites) break;
    }
    return list;
  };
  const words = (text: string, cited: Citable[]): FiledWords => ({
    text,
    cites: cited.map((c) => c.ref),
    from: labelsOf(cited),
    products: [...new Set(cited.map((c) => c.product).filter((p): p is string => !!p))],
  });

  for (const a of items(raw, "add")) {
    if (out.add.length >= TOPIC_LIMITS.add) break;
    const where = typeof a.topic === "string" ? target.get(a.topic.trim()) : undefined;
    const section = (SECTIONS as readonly string[]).includes(a.section as string) ? (a.section as TopicSection) : null;
    const cited = cite(a.cites);
    if (!where || !section || !cited.length) continue;
    const text = checkWords(a.text, cited);
    if (!text) continue;
    const have = linesOn.get(where) ?? [];
    if (have.includes(sameWords(text)) || have.length >= TOPIC_LIMITS.linesPerTopic) continue;
    have.push(sameWords(text));
    linesOn.set(where, have);
    // Knowing, or speaking against, takes customers' words or a test's result; the team's words alone are a belief.
    const placed: TopicSection = (section === "know" || section === "against") && !cited.some((c) => c.evidence) ? "believe" : section;
    out.add.push({ topic: where, section: placed, ...words(text, cited) });
  }

  for (const r of items(raw, "revise")) {
    if (out.revise.length >= TOPIC_LIMITS.revise) break;
    const l = typeof r.line === "string" ? sent.lines.get(r.line.trim()) : undefined;
    const cited = cite(r.cites);
    if (!l || l.line.by !== "qalam" || !cited.length || out.revise.some((x) => x.line === l.line.id) || out.retire.some((x) => x.line === l.line.id)) continue;
    // Its own words were checked when it was written: they may stay.
    const text = checkWords(r.text, cited, l.line.text);
    if (!text) continue;
    out.revise.push({ topic: target.get(l.topic) ?? l.topic, line: l.line.id, ...words(text, cited) });
  }

  for (const r of items(raw, "retire")) {
    if (out.retire.length >= TOPIC_LIMITS.retire) break;
    const l = typeof r.line === "string" ? sent.lines.get(r.line.trim()) : undefined;
    if (!l || l.line.by !== "qalam" || out.retire.some((x) => x.line === l.line.id) || out.revise.some((x) => x.line === l.line.id)) continue;
    out.retire.push({ topic: target.get(l.topic) ?? l.topic, line: l.line.id, why: typeof r.why === "string" ? cleanLine(r.why).slice(0, TOPIC_LIMITS.why) : "" });
  }

  for (const d of items(raw, "dispute")) {
    if (out.dispute.length >= TOPIC_LIMITS.dispute) break;
    const l = typeof d.line === "string" ? sent.lines.get(d.line.trim()) : undefined;
    const cited = cite(d.cites);
    if (!l || !cited.length || out.retire.some((x) => x.line === l.line.id)) continue;
    const text = checkWords(d.text, cited);
    if (!text || (l.line.disputed ?? []).some((x) => sameWords(x) === sameWords(text)) || out.dispute.some((x) => x.line === l.line.id && sameWords(x.text) === sameWords(text))) continue;
    out.dispute.push({ topic: target.get(l.topic) ?? l.topic, line: l.line.id, ...words(text, cited) });
  }

  // Pages to start: the ones a line was kept for.
  for (const s of starting.values()) {
    const on = out.add.filter((a) => a.topic === `new:${s.key}`);
    if (!on.length) continue;
    const products = s.kind === "product" ? s.products : [...new Set([...s.products, ...on.flatMap((a) => a.products)])];
    out.create.push({ key: s.key, kind: s.kind, title: s.title, products });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applying a filing to the pages

export interface Applied {
  /** Pages that changed or started, as they are now. */
  pages: Topic[];
  created: string[];
  counts: { added: number; revised: number; retired: number; disputed: number };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A line's words quoted in a sentence: clipped, without its own full stop. */
export const quoted = (s: string, n = 140) => clip(s.replace(/[.。]+$/, ""), n);

/** "Added 2 lines and disputed 1": what a filing did to one page. */
function didLine(c: { added: number; revised: number; disputed: number }): string {
  const parts = [c.added && `added ${plural(c.added, "line")}`, c.revised && `revised ${c.revised}`, c.disputed && `disputed ${c.disputed}`].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/**
 * A filing on the pages as they are now (a line gone meanwhile is left alone; one a person edited
 * meanwhile is theirs, so it isn't revised). `from` names the material ("“Sara interview”").
 */
export function applyFiling(pages: Map<string, Topic>, f: Filing, o: { now: number; newId: () => string; from: string }): Applied {
  const changed = new Map<string, Topic>();
  const created = new Set<string>();
  const touched = new Set<string>();
  const counts = { added: 0, revised: 0, retired: 0, disputed: 0 };
  const per = new Map<string, { added: number; revised: number; disputed: number }>();
  const tally = (id: string, k: "added" | "revised" | "disputed") => {
    const c = per.get(id) ?? { added: 0, revised: 0, disputed: 0 };
    c[k]++;
    per.set(id, c);
    counts[k]++;
    touched.add(id);
  };
  const keyed = new Map<string, string>();
  const page = (ref: string): Topic | undefined => {
    const id = ref.startsWith("new:") ? keyed.get(ref.slice(4)) : ref;
    if (!id) return undefined;
    const t = changed.get(id) ?? pages.get(id);
    if (!t) return undefined;
    if (!changed.has(id)) changed.set(id, { ...t, lines: t.lines.map((l) => ({ ...l })), history: [...t.history] });
    return changed.get(id);
  };
  for (const c of f.create) {
    const id = o.newId();
    keyed.set(c.key, id);
    changed.set(id, { id, kind: c.kind, title: c.title, products: c.products, createdAt: o.now, updatedAt: o.now, lines: [], history: [] });
    created.add(id);
  }
  const grow = (t: Topic, products: string[]) => {
    if (t.kind !== "product") t.products = [...new Set([...t.products, ...products])];
  };
  for (const a of f.add) {
    const t = page(a.topic);
    if (!t || t.lines.length >= TOPIC_LIMITS.linesPerTopic || t.lines.some((l) => sameWords(l.text) === sameWords(a.text))) continue;
    t.lines.push({ id: o.newId(), section: a.section, text: a.text, by: "qalam", cites: a.cites, from: a.from, at: o.now });
    grow(t, a.products);
    tally(t.id, "added");
  }
  for (const r of f.revise) {
    const t = page(r.topic);
    const l = t?.lines.find((x) => x.id === r.line);
    if (!t || !l || l.by !== "qalam") continue;
    const cites = [...new Set([...l.cites, ...r.cites])];
    if (l.text === r.text && cites.length === l.cites.length) continue;
    Object.assign(l, { text: r.text, cites, from: [...new Set([...l.from, ...r.from])], at: o.now });
    grow(t, r.products);
    tally(t.id, "revised");
  }
  for (const r of f.retire) {
    const t = page(r.topic);
    const at = t?.lines.findIndex((x) => x.id === r.line) ?? -1;
    if (!t || at < 0 || t.lines[at].by !== "qalam") continue;
    const [gone] = t.lines.splice(at, 1);
    t.history.unshift({ at: o.now, text: `Qalam AI took back “${quoted(gone.text, 140)}”${r.why ? `: ${r.why.replace(/[.。]+$/, "")}` : ""}.` });
    counts.retired++;
    touched.add(t.id);
  }
  for (const d of f.dispute) {
    const t = page(d.topic);
    const l = t?.lines.find((x) => x.id === d.line);
    if (!t || !l || (l.disputes ?? []).some((x) => sameWords(x.text) === sameWords(d.text))) continue;
    l.disputes = [...(l.disputes ?? []), { id: o.newId(), text: d.text, by: "qalam", cites: d.cites, from: d.from, at: o.now }];
    grow(t, d.products);
    tally(t.id, "disputed");
  }
  const out: Topic[] = [];
  for (const id of touched) {
    const t = changed.get(id)!;
    const c = per.get(id);
    if (created.has(id)) t.history.unshift({ at: o.now, text: `Qalam AI started this page from ${o.from}, with ${plural(c?.added ?? 0, "line")}.` });
    else if (c) t.history.unshift({ at: o.now, text: `Qalam AI ${didLine(c)}, from ${o.from}.` });
    t.history = t.history.slice(0, TOPIC_LIMITS.history);
    t.updatedAt = o.now;
    out.push(t);
  }
  // A page that was to start but kept no line (each repeated what was there) isn't made.
  return { pages: out, created: [...created].filter((id) => touched.has(id)), counts };
}

// ---------------------------------------------------------------------------

/** How many lines each part of a page has. */
export function sectionCounts(t: Pick<Topic, "lines">): Record<TopicSection, number> {
  const c = { know: 0, believe: 0, against: 0, open: 0 };
  for (const l of t.lines) c[l.section]++;
  return c;
}

/** Lines with something said against them. */
export const disputedCount = (t: Pick<Topic, "lines">) => t.lines.filter((l) => l.disputes?.length).length;

// ---------------------------------------------------------------------------
// Shapes, as the organization's server takes them (a page people changed, a checked filing)

/** A page as the store hands it out: its version, and its file in the organization's folder. */
export type TopicInfo = Topic & { version: string; file: string };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const strs = (v: unknown, n: number, max: number): string[] | null => (Array.isArray(v) && v.length <= n && v.every((x) => isStr(x, max)) ? (v as string[]) : null);
const ID = /^[A-Za-z0-9_~-]{1,64}$/;
const isAuthor = (v: unknown): v is Author => v === "qalam" || v === "person";
const isSection = (v: unknown): v is TopicSection => (SECTIONS as readonly unknown[]).includes(v);
const atOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function disputeShape(raw: unknown): TopicDispute | null {
  const d = raw as Record<string, unknown> | null;
  const cites = strs(d?.cites, 50, 200);
  const from = strs(d?.from, 20, 200);
  if (!d || !isStr(d.id, 64) || !isStr(d.text, 2000) || !d.text.trim() || !isAuthor(d.by) || !cites || !from) return null;
  return { id: d.id, text: d.text.trim(), by: d.by, cites, from, at: atOf(d.at) };
}

function lineShape(raw: unknown): TopicLine | null {
  const l = raw as Record<string, unknown> | null;
  const cites = strs(l?.cites, 50, 200);
  const from = strs(l?.from, 20, 200);
  if (!l || !isStr(l.id, 64) || !ID.test(l.id) || !isSection(l.section) || !isStr(l.text, 2000) || !l.text.trim() || !isAuthor(l.by) || !cites || !from) return null;
  const disputes = Array.isArray(l.disputes) ? l.disputes.slice(0, 20).map(disputeShape) : [];
  if (disputes.some((d) => !d)) return null;
  return {
    id: l.id,
    section: l.section,
    // One line each: a line break would end it in the file.
    text: l.text.replace(/\s+/g, " ").trim(),
    by: l.by,
    cites,
    from,
    at: atOf(l.at),
    ...(disputes.length ? { disputes: disputes as TopicDispute[] } : {}),
    ...(isStr(l.more, 20_000) && l.more.trim() ? { more: l.more } : {}),
  };
}

/** A page as people changed it, or null when it isn't one (`id`: the page it's for). */
export function topicShape(raw: unknown, id: string): Topic | null {
  const t = raw as Record<string, unknown> | null;
  const products = strs(t?.products, 50, 64);
  if (!t || t.id !== id || !ID.test(id) || !(TOPIC_KINDS as readonly unknown[]).includes(t.kind) || !isStr(t.title, 200) || !t.title.trim() || !products || !Array.isArray(t.lines) || t.lines.length > 400) return null;
  const lines = t.lines.map(lineShape);
  if (lines.some((l) => !l)) return null;
  const history = (Array.isArray(t.history) ? t.history : [])
    .slice(0, TOPIC_LIMITS.history)
    .map((h) => h as Record<string, unknown>)
    .filter((h) => h && isStr(h.text, 600) && h.text.trim())
    .map((h) => ({ at: atOf(h.at), text: (h.text as string).replace(/\s+/g, " ").trim() }));
  const intros = t.intros && typeof t.intros === "object" ? Object.fromEntries(Object.entries(t.intros).filter(([k, v]) => isSection(k) && isStr(v, 20_000))) : {};
  const extra = t.extra && typeof t.extra === "object" && !Array.isArray(t.extra) ? (t.extra as Record<string, unknown>) : null;
  return {
    id,
    kind: t.kind as TopicKind,
    title: t.title.replace(/\s+/g, " ").trim(),
    products,
    createdAt: atOf(t.createdAt),
    updatedAt: atOf(t.updatedAt),
    lines: lines as TopicLine[],
    history,
    ...(isStr(t.intro, 20_000) && t.intro.trim() ? { intro: t.intro } : {}),
    ...(Object.keys(intros).length ? { intros } : {}),
    ...(isStr(t.notes, 50_000) && t.notes.trim() ? { notes: t.notes } : {}),
    ...(extra && Object.keys(extra).length ? { extra } : {}),
  };
}

const TOPIC_REF = /^(?:new:n?\w{1,12}|[A-Za-z0-9_~-]{1,64})$/;

function wordsShape(w: Record<string, unknown>): FiledWords | null {
  const cites = strs(w.cites, TOPIC_LIMITS.cites, 200);
  const from = strs(w.from, TOPIC_LIMITS.cites, 200);
  const products = strs(w.products, 50, 64);
  if (!isStr(w.text, TOPIC_LIMITS.line) || !cleanLine(w.text) || !cites?.length || !from || !products) return null;
  return { text: cleanLine(w.text), cites, from, products };
}

/** A filing as the client checked it (sanitizeFiling), or null when it isn't one. */
export function filingShape(raw: unknown): Filing | null {
  const f = raw as Record<string, unknown> | null;
  const list = (k: string, max: number) => (Array.isArray(f?.[k]) && (f![k] as unknown[]).length <= max ? (f![k] as Record<string, unknown>[]) : null);
  const create = list("create", TOPIC_LIMITS.newTopics * 4);
  const add = list("add", TOPIC_LIMITS.add);
  const revise = list("revise", TOPIC_LIMITS.revise);
  const retire = list("retire", TOPIC_LIMITS.retire);
  const dispute = list("dispute", TOPIC_LIMITS.dispute);
  if (!create || !add || !revise || !retire || !dispute) return null;
  const out = emptyFiling();
  for (const c of create) {
    const products = strs(c?.products, 50, 64);
    if (!c || !isStr(c.key, 12) || !(TOPIC_KINDS as readonly unknown[]).includes(c.kind) || !isStr(c.title, TOPIC_LIMITS.title) || !c.title.trim() || !products) return null;
    out.create.push({ key: c.key, kind: c.kind as TopicKind, title: c.title.trim(), products });
  }
  const topic = (v: unknown) => isStr(v, 70) && TOPIC_REF.test(v);
  for (const a of add) {
    const w = a && topic(a.topic) && isSection(a.section) ? wordsShape(a) : null;
    if (!w) return null;
    out.add.push({ topic: a.topic as string, section: a.section as TopicSection, ...w });
  }
  for (const r of revise) {
    const w = r && topic(r.topic) && isStr(r.line, 64) ? wordsShape(r) : null;
    if (!w) return null;
    out.revise.push({ topic: r.topic as string, line: r.line as string, ...w });
  }
  for (const r of retire) {
    if (!r || !topic(r.topic) || !isStr(r.line, 64) || !isStr(r.why, TOPIC_LIMITS.why)) return null;
    out.retire.push({ topic: r.topic as string, line: r.line as string, why: r.why as string });
  }
  for (const d of dispute) {
    const w = d && topic(d.topic) && isStr(d.line, 64) ? wordsShape(d) : null;
    if (!w) return null;
    out.dispute.push({ topic: d.topic as string, line: d.line as string, ...w });
  }
  return out;
}
