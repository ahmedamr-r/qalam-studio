import type { Doc } from "@/doc/schema";
import type { ProductMap } from "@/code/map";
import type { SeenMap } from "@/seen/types";
import { dayOf, type Decision } from "@/decisions/model";
import { metricText } from "@/discovery/dump";
import { KIND_LABEL, stageLabel } from "@/discovery/kinds";
import { QUOTE_KIND_LABEL, quotePiece, type SourceRecord } from "@/discovery/sources";
import type { OstCard, OstEvidence } from "@/discovery/types";
import { metricLine } from "@/goals/goals-md";
import type { GoalTree } from "@/goals/types";
import { factHash } from "@/knowledge/refs";
import type { ContextFields } from "@/org/context-md";
import type { Project } from "@/projects/model";
import { SECTION_HEADING, type Topic, type TopicSection } from "./topics";

/**
 * The organization's knowledge as pieces: small and typed, one fact each (a customer's words, a
 * need, a card, an assumption, a decision, a line about a product). Single facts are found better
 * than chunks of a document (Dense X Retrieval). Each piece says where it came from and links to
 * the pieces it relates to (a card to the quotes behind it, a need to the quotes that show it),
 * and code writes it a context line ("A pain Sara said in “Sara interview”, Oct 12 · Grocery")
 * that goes into word and meaning search with it: Anthropic's contextual retrieval, without a
 * model call. Pure: the index (server/index) builds pieces from the organization's files.
 */

export type PieceType = "quote" | "need" | "evidence" | "card" | "assumption" | "decision" | "context" | "page";

export type EdgeKind =
  /** A card rests on a piece of evidence. */
  | "backs"
  /** A piece of evidence speaks against a card. */
  | "against"
  /** A card sits under another. */
  | "under"
  /** A quote or need is in a source. */
  | "in"
  /** A need is shown by a quote. */
  | "shows"
  /** A decision is about a card. */
  | "about"
  /** An assumption is one a solution rests on. */
  | "of"
  /** A topic page's line rests on a piece. */
  | "cites"
  /** Two cards on different boards are the same need (linked by the team). */
  | "same"
  /** An outcome card is a goal on a board (goals.md). */
  | "for";

export interface HubEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Since when it holds (evidence: when it was attached). */
  at?: number;
}

export interface HubPiece {
  ref: string;
  type: PieceType;
  /** What kind of it: a quote's (pain, need…) or a brain dump piece's role, a card's kind, an evidence's, a decision's. */
  sub?: string;
  /** The words. */
  text: string;
  /** What it is and where it's from, written by code. */
  line: string;
  /** A short name for lists (a card's title, a source's). */
  title?: string;
  /** The product it's for (null: the whole organization). */
  product: string | null;
  board?: string;
  card?: string;
  source?: string;
  speaker?: string;
  stage?: string;
  /** When it was said, written or decided. */
  at: number;
}

/** Something pieces belong to: a source, a board, a topic page. */
export interface HubEntity {
  ref: string;
  kind: "source" | "board" | "topic";
  name: string;
}

export interface Built {
  pieces: HubPiece[];
  edges: HubEdge[];
  entities: HubEntity[];
}

/** Names the context lines use. */
export interface Names {
  product: (id: string) => string | undefined;
}

export const cardRef = (board: string, card: string) => `hub:card:${board}:${card}`;
export const sourceRef = (id: string) => `hub:source:${id}`;
export const boardRef = (id: string) => `hub:board:${id}`;
export const decisionRef = (id: string) => `hub:decision:${id}`;
export const topicRef = (id: string) => `hub:topic:${id}`;
export const goalRef = (id: string) => `hub:goal:${id}`;
export const topicLineRef = (topic: string, line: string) => `hub:topic:${topic}:${line}`;

const date = (at: number) => (at > 0 ? new Date(at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "");
const q = (t: string) => `“${t.replace(/\s+/g, " ").trim() || "Untitled"}”`;
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");
const forProduct = (product: string | null | undefined, n: Names) => (product ? (n.product(product) ?? null) : null);

// ---------------------------------------------------------------------------
// Sources: their quotes (a brain dump's pieces too) and the needs seen in them

export function sourcePieces(s: SourceRecord, n: Names): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  const src = sourceRef(s.id);
  const product = s.product ?? null;
  const where = `${q(s.title)}${date(s.addedAt) ? `, ${date(s.addedAt)}` : ""}`;
  for (const quote of s.quotes) {
    const ref = quotePiece(quote.id);
    const dump = s.kind === "dump";
    const online = s.kind === "post";
    const what = dump
      ? `${quote.role ? `${/^[aeiou]/i.test(quote.role) ? "An" : "A"} ${quote.role}` : "A piece"} from the brain dump`
      : `${QUOTE_KIND_LABEL[quote.kind] ?? "A quote"}${quote.speaker ? ` ${quote.speaker} said` : online ? " someone online said" : " a customer said"}${online ? " in public" : ""}`;
    pieces.push({
      ref,
      type: "quote",
      // A brain dump's pieces are the team's words, never a customer's; a post's are people online's: their kind says so.
      sub: dump ? `dump:${quote.role ?? "piece"}` : online ? `online:${quote.kind}` : quote.kind,
      text: quote.text,
      line: join(`${what} in ${where}`, forProduct(product, n)),
      title: s.title,
      product,
      source: s.id,
      ...(quote.speaker ? { speaker: quote.speaker } : {}),
      at: quote.at || s.addedAt,
    });
    edges.push({ from: ref, to: src, kind: "in" });
  }
  for (const need of s.needs) {
    const ref = `hub:need:${s.id}:${need.id}`;
    pieces.push({ ref, type: "need", text: need.title, line: join(`A need seen in ${where}`, forProduct(product, n)), title: s.title, product, source: s.id, at: s.addedAt });
    edges.push({ from: ref, to: src, kind: "in" });
    for (const id of need.quoteIds) edges.push({ from: ref, to: quotePiece(id), kind: "shows" });
  }
  return { pieces, edges, entities: [{ ref: src, kind: "source", name: s.title }] };
}

// ---------------------------------------------------------------------------
// Boards: cards, the evidence written on them, and solutions' assumptions

type Node = { parentId?: string | null; meta?: { ost?: OstCard } };

const EVIDENCE_WHAT: Record<OstEvidence["kind"], string> = { answer: "The team's answer", note: "A note", quote: "A quote", dump: "The team's words from a brain dump" };

/** A card's words: its title, what it means, and its number or test. */
function cardText(c: OstCard): string {
  const test = c.test ? [c.test.method && `Method: ${c.test.method}`, c.test.criterion && `Pass if: ${c.test.criterion}`, c.test.result && `Result: ${c.test.result}`].filter(Boolean).join(". ") : "";
  return [c.title, c.description, metricText(c.metric), test]
    .map((x) => x?.trim().replace(/[.。]+$/, ""))
    .filter(Boolean)
    .join(". ");
}

export function boardPieces(p: Project, doc: Doc | null, n: Names): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  const product = p.product ?? null;
  const on = join(`on the board ${q(p.name)}`, forProduct(product, n));
  const nodes = (doc?.nodes ?? {}) as unknown as Record<string, Node>;
  for (const [id, node] of Object.entries(nodes)) {
    const c = node.meta?.ost;
    if (!c) continue;
    const ref = cardRef(p.id, id);
    let parent = node.parentId ?? null;
    while (parent && !nodes[parent]?.meta?.ost) parent = nodes[parent]?.parentId ?? null;
    const parentCard = parent ? nodes[parent].meta!.ost! : null;
    pieces.push({
      ref,
      type: "card",
      sub: c.kind,
      text: cardText(c),
      line: join(`${KIND_LABEL[c.kind]}, ${stageLabel(c.kind, c.stage).toLowerCase()}${parentCard ? `, under ${q(parentCard.title)}` : ""}`, on),
      title: c.title,
      product,
      board: p.id,
      card: id,
      stage: c.stage,
      at: c.stageAt ?? p.createdAt,
    });
    if (parent) edges.push({ from: ref, to: cardRef(p.id, parent), kind: "under" });
    for (const e of c.evidence) {
      // Words that are a source's piece link to it; the rest are pieces of their own, kept with the card.
      const to = e.piece ?? `hub:evidence:${p.id}:${e.id}`;
      edges.push({ from: ref, to, kind: e.stance === "against" ? "against" : "backs", at: e.at });
      if (e.piece) continue;
      const from = e.sourceTitle ? ` in ${q(e.sourceTitle)}` : "";
      pieces.push({
        ref: to,
        type: "evidence",
        sub: e.kind,
        text: e.text,
        line: join(`${EVIDENCE_WHAT[e.kind]}${e.speaker ? ` (${e.speaker})` : ""}${from}, ${e.stance === "against" ? "against" : "for"} ${q(c.title)}`, on),
        ...(e.sourceTitle ? { title: e.sourceTitle } : {}),
        product,
        board: p.id,
        card: id,
        ...(e.sourceId ? { source: e.sourceId } : {}),
        ...(e.speaker ? { speaker: e.speaker } : {}),
        at: e.at,
      });
    }
    for (const a of c.assumptions ?? []) {
      const aref = `hub:assumption:${p.id}:${a.id}`;
      pieces.push({ ref: aref, type: "assumption", sub: a.category, text: a.text, line: join(`A ${a.category} assumption behind ${q(c.title)}${a.importance === 3 ? ", which it fails without" : ""}`, on), product, board: p.id, card: id, at: a.at ?? c.stageAt ?? p.createdAt });
      edges.push({ from: aref, to: ref, kind: "of" });
    }
  }
  return { pieces, edges, entities: [{ ref: boardRef(p.id), kind: "board", name: p.name }] };
}

// ---------------------------------------------------------------------------
// Decisions (an undone one isn't knowledge: the log keeps it, search doesn't)

export function decisionPieces(list: Decision[], productOf: (board: string) => string | null | undefined, n: Names): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  for (const d of list) {
    if (d.undone) continue;
    const ref = decisionRef(d.id);
    const product = productOf(d.board) ?? d.product ?? null;
    const knew = d.knew ? ` What we knew then: ${[d.knew.evidence, ...d.knew.pieces.slice(0, 2).map((x) => q(x.text))].join("; ")}.` : "";
    pieces.push({
      ref,
      type: "decision",
      sub: d.kind,
      text: `${d.what}.${d.why ? ` Why: ${d.why}` : ""}${knew}`,
      line: join(`A decision ${d.by === "qalam" ? "Qalam AI proposed and the team accepted" : "the team made"} on ${q(d.boardName)}, ${dayOf(d.at)}`, forProduct(product, n)),
      title: d.cardTitle || d.boardName,
      product,
      board: d.board,
      ...(d.card ? { card: d.card } : {}),
      at: d.at,
    });
    const about = new Set([d.card, ...(Array.isArray(d.detail?.cards) ? (d.detail.cards as unknown[]) : [])].filter((x): x is string => typeof x === "string"));
    for (const card of about) edges.push({ from: ref, to: cardRef(d.board, card), kind: "about", at: d.at });
  }
  return { pieces, edges, entities: [] };
}

// ---------------------------------------------------------------------------
// What the organization and its products are (about.md, products/*.md)

export function contextPieces(owner: { product: string | null; name: string; at: number }, c: ContextFields): Built {
  const who = owner.product ? owner.name : `${owner.name} (the organization)`;
  const items: [string, string, string][] = [
    ["audience", `Who ${who} is for`, c.audience],
    ["context", `About ${who}`, c.context],
    // One piece for all of them: a name like "New customers" alone is near everything in meaning.
    ["segments", `The kinds of customer ${who} tells apart`, c.segments.join("; ")],
    ["notes", `Notes on ${who}`, c.notes ?? ""],
  ];
  const pieces: HubPiece[] = [];
  for (const [sub, line, text] of items) {
    if (!text.trim()) continue;
    pieces.push({ ref: `hub:context:${owner.product ?? "org"}:${sub}:${factHash(text)}`, type: "context", sub, text: text.trim(), line, title: owner.name, product: owner.product, at: owner.at });
  }
  return { pieces, edges: [], entities: [] };
}

// ---------------------------------------------------------------------------
// The goals (goals.md): each a piece, under the goal it feeds, linked to the card working on it

export function goalPieces(t: GoalTree, n: Names, orgName: string): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  const byId = new Map(t.goals.map((g) => [g.id, g]));
  for (const g of t.goals) {
    const ref = goalRef(g.id);
    const parent = g.parent ? byId.get(g.parent) : undefined;
    const who = g.product ? (n.product(g.product) ?? "a product") : `${orgName} (the organization)`;
    pieces.push({
      ref,
      type: "context",
      sub: "goal",
      text: g.metric ? `${g.title} (${g.metric.name ? `${g.metric.name}: ` : ""}${metricLine(g.metric)})` : g.title,
      line: join(g.id === t.north ? `The North Star of ${who}` : `A goal of ${who}`, parent ? `under ${q(parent.title)}` : null, g.status !== "active" ? g.status : null),
      title: g.title,
      product: g.product,
      at: g.at,
    });
    if (parent) edges.push({ from: ref, to: goalRef(parent.id), kind: "under" });
    if (g.on) edges.push({ from: cardRef(g.on.board, g.on.card), to: ref, kind: "for" });
    for (const c of g.cites) edges.push({ from: ref, to: c, kind: "backs" });
  }
  return { pieces, edges, entities: [] };
}

// ---------------------------------------------------------------------------
// What a product does today, from its code (hub/maps/*.md): each step of a flow a piece, the
// flow's first linked to the goal it measures

export const mapRef = (key: string, flow: number, step: number) => `hub:map:${key}:${flow}:${step}`;

export function mapPieces(m: ProductMap, n: Names): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  const who = m.product ? (n.product(m.product) ?? "a product") : "the organization";
  m.flows.forEach((f, fi) =>
    f.steps.forEach((s, si) => {
      const ref = mapRef(m.key, fi, si);
      pieces.push({ ref, type: "context", sub: "map", text: `${f.name}, step ${si + 1}: ${s.title}${s.events.length ? ` (sends ${s.events.join(", ")})` : ""}`, line: join(`What ${who} does today, from its code`, `in ${s.file}`), title: f.name, product: m.product, at: m.readAt });
      if (f.goal && si === 0) edges.push({ from: ref, to: goalRef(f.goal), kind: "for" });
    }),
  );
  return { pieces, edges, entities: [] };
}

// ---------------------------------------------------------------------------
// What people see in a product, from its screenshots (hub/seen/*.md): each screen a piece (what
// it's for, what's on it, its controls as it shows them), each flow a piece (its screens in
// order); a screen is in its flows, a flow is for the goal it serves

export const screenRef = (key: string, screen: string) => `hub:screen:${key}:${screen}`;
export const flowRef = (key: string, flow: string) => `hub:flow:${key}:${flow}`;

export function seenPieces(m: SeenMap, n: Names): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  const who = m.product ? (n.product(m.product) ?? "a product") : "the organization";
  const names = new Map(m.screens.map((s) => [s.key, s.name]));
  for (const s of m.screens) {
    const states = Object.values(s.states).filter(Boolean);
    const text = [`${s.name}${s.does ? `: ${s.does}` : ""}`, s.on ? `On it: ${s.on}` : "", s.can.length ? `You can: ${s.can.map((c) => `“${c.label}”`).join(", ")}` : "", states.length ? `Also shown: ${states.join("; ")}` : ""].filter(Boolean).join(" ");
    pieces.push({ ref: screenRef(m.key, s.key), type: "context", sub: "screen", text, line: join(`What people see in ${who}`, `a ${s.kind} screen, from a screenshot`), title: s.name, product: m.product, at: s.at });
  }
  for (const f of m.flows) {
    const ref = flowRef(m.key, f.key);
    const text = `${f.name}${f.aim ? ` (${f.aim})` : ""}: ${f.steps.map((s) => names.get(s) ?? s).join(" → ")}${f.notShown.length ? `. Not shown yet: ${f.notShown.join("; ")}` : ""}`;
    pieces.push({ ref, type: "context", sub: "flow", text, line: join(`What people see in ${who}`, `a flow of ${f.steps.length} screens`), title: f.name, product: m.product, at: f.at });
    for (const s of new Set(f.steps)) edges.push({ from: screenRef(m.key, s), to: ref, kind: "in" });
    if (f.goal) edges.push({ from: ref, to: goalRef(f.goal), kind: "for" });
  }
  return { pieces, edges, entities: [] };
}

// ---------------------------------------------------------------------------
// Topic pages: each line a piece, linked to the pieces it cites (hub/topics/*.md)

const ABOUT_TOPIC: Record<Topic["kind"], string> = { need: "the need", segment: "the segment", product: "the product" };
const SECTION_LINE: Record<TopicSection, string> = {
  know: "What the organization knows about",
  believe: "What the team believes about",
  against: "What speaks against",
  open: "An open question about",
};

export function topicPieces(t: Topic, n: Names): Built {
  const pieces: HubPiece[] = [];
  const edges: HubEdge[] = [];
  const page = topicRef(t.id);
  // One product's page is that product's; one about several (or none) is the whole organization's.
  const product = t.products.length === 1 ? t.products[0] : null;
  for (const l of t.lines) {
    const ref = topicLineRef(t.id, l.id);
    const against = (l.disputes ?? []).map((d) => ` Disputed: ${d.text}`).join("");
    pieces.push({
      ref,
      type: "page",
      sub: l.section,
      text: `${l.text}${against}`,
      line: join(`${SECTION_LINE[l.section]} ${ABOUT_TOPIC[t.kind]} ${q(t.title)}, on its topic page${l.by === "person" ? ", in the team's words" : ""}`, forProduct(product, n)),
      title: t.title,
      product,
      at: l.at || t.updatedAt,
    });
    edges.push({ from: ref, to: page, kind: "in" });
    for (const c of [...l.cites, ...(l.disputes ?? []).flatMap((d) => d.cites)]) edges.push({ from: ref, to: c, kind: "cites" });
  }
  return { pieces, edges, entities: [{ ref: page, kind: "topic", name: t.title }] };
}

/** "We know" for a page line's part (search results show it). */
export const sectionOf = (sub: string | null | undefined) => (sub && sub in SECTION_HEADING ? SECTION_HEADING[sub as TopicSection] : null);

// ---------------------------------------------------------------------------

/** What word and meaning search read for a piece: its line, the cards it's about, its words. */
export function searchText(p: Pick<HubPiece, "line" | "text">, topics: string[] = []): string {
  return `${p.line}${topics.length ? ` · about ${topics.map(q).join(", ")}` : ""}\n${p.text}`;
}

/**
 * What meaning search embeds for a piece: what it is in a word or two, the cards it's about, and
 * its words. Measured on the eval set (eval/retrieval): the full context line (source, date,
 * product) is as long as a quote and drowns its meaning, so it stays out; the cards a piece is
 * about are the best context it has. Lines about the organization keep theirs ("A goal of …").
 */
export function meaningText(p: Pick<HubPiece, "line" | "text" | "type" | "sub"> & { title?: string | null }, topics: string[] = []): string {
  if (p.type === "context") return `${p.line}: ${p.text}`;
  // A page's line is about its topic: the topic's name is its context.
  if (p.type === "page") return `${sectionOf(p.sub) ?? "Topic page"}, about ${q(p.title ?? "")}: ${p.text}`;
  const team = p.type === "quote" && p.sub?.startsWith("dump:");
  const online = p.type === "quote" && p.sub?.startsWith("online:");
  const what = team ? `The team's ${p.sub!.slice(5)}` : online ? `Someone online's ${p.sub!.slice(7)}` : p.type === "quote" ? `A customer ${p.sub ?? "quote"}` : p.type === "card" ? (p.sub ?? "card") : p.type;
  return `${what}. ${topics.length ? `About ${topics.map(q).join(", ")}. ` : ""}${p.text}`;
}

/** Built pieces, edges and entities, merged (a ref seen twice keeps the first). */
export function merge(...parts: Built[]): Built {
  const seen = new Set<string>();
  const out: Built = { pieces: [], edges: [], entities: [] };
  for (const b of parts) {
    for (const p of b.pieces) if (!seen.has(p.ref)) (seen.add(p.ref), out.pieces.push(p));
    out.edges.push(...b.edges);
    out.entities.push(...b.entities);
  }
  return out;
}
