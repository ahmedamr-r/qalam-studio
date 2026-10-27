import { produce } from "immer";
import { emptyDoc, type Doc } from "@/doc/schema";
import { isOstCard, rootBounds, treeBounds, treeRootOf, visibleCards } from "@/doc/board";
import { type Pt, boundsOf, isDescendant, worldBounds, worldCorners } from "@/doc/geometry";
import { reparentIn } from "@/doc/ops";
import { canHold } from "./kinds";
import { addCardIn, deleteKeepIn, makeCardNode, moveCardsIn, setTargetIn, updateCardIn } from "./ops";
import { layoutDocTrees, TREE_GAP } from "./pass";
import { fromSource, hasQuote, quotable } from "./sources";
import { makeSticky } from "./sticky";
import type { OstAssumption, OstCard, OstEvidence, OstMetric, StickyColor } from "./types";

/*
 * Qalam AI's proposals for the board, made safe and carried out (pure). A proposal changes one
 * thing: words attached to a card (for or against it), a new card, assumptions or a metric's
 * numbers for a card that's there, a card reworded, moved or merged into another, a note beside a
 * card. Nothing lands until the builder accepts it; until then the board as it would be is drawn
 * over the real one (a ghost), where only what would change shows faded. Each proposal is
 * accepted or discarded on its own; one that waits on another (a card under a new card) goes
 * along with it.
 */

/** A quote by where it lives (a brain dump's pieces are quotes of its source too). */
export interface QuoteRef {
  sourceId: string;
  quoteId: string;
}

/** What a new card rests on: words of a source, and words code already checked (the builder's answers). */
export interface Backing {
  quotes: QuoteRef[];
  words: OstEvidence[];
}

export type Proposal = {
  id: string;
  /** The node its bar sits on: the card it changes or adds, or the note it adds. */
  cardId: string;
  why: string;
} & (
  | { kind: "attach" | "against"; quote: QuoteRef }
  | { kind: "card"; card: OstCard; /** null: a tree of its own, at `at`. */ parentId: string | null; backing: Backing; at?: Pt }
  | { kind: "assumption"; assumptions: OstAssumption[] }
  | { kind: "metric"; metric: Partial<OstMetric> }
  | { kind: "edit"; /** Its title when proposed (a renamed card makes the proposal stale). */ from: string; title?: string; description?: string }
  | { kind: "move"; fromParent: string | null; /** null: onto the board as a tree of its own, at `at`. */ parentId: string | null; at?: Pt }
  | { kind: "merge"; /** The card that folds into `cardId`. */ dropId: string; title?: string }
  | { kind: "note"; /** The card it's beside (null: the tree's side). */ anchorId: string | null; textId: string; text: string; color: StickyColor; at?: Pt }
);

/** A quote as evidence (null when its source or the quote is gone). */
export type EvidenceOf = (q: QuoteRef, against: boolean) => OstEvidence | null;

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Where a proposal lands: the card it changes, or where a card it adds or moves goes. */
export const proposalTarget = (p: Proposal): string | null => (p.kind === "card" || p.kind === "move" ? p.parentId : p.kind === "note" ? p.anchorId : p.cardId);

/**
 * What a discarded proposal is remembered by, so it isn't proposed again (words attached to a
 * card are remembered on the quote itself). A new card's parent may itself be new: it's named by
 * its title then, since its id is new each time.
 */
export function proposalKey(p: Proposal, all: Proposal[] = []): string {
  const parentKey = (id: string | null) => {
    if (!id) return "board";
    const pending = all.find((x) => x.kind === "card" && x.cardId === id);
    return pending?.kind === "card" ? `new:${key(pending.card.title)}` : id;
  };
  switch (p.kind) {
    case "attach":
    case "against":
      return `${p.kind}:${p.cardId}:${p.quote.sourceId}:${p.quote.quoteId}`;
    case "card":
      return `card:${parentKey(p.parentId)}:${key(p.card.title)}`;
    case "assumption":
      return `assumption:${p.cardId}:${key(p.assumptions.map((a) => a.text).join(" "))}`;
    case "metric":
      return `metric:${p.cardId}:${JSON.stringify(p.metric)}`;
    case "edit":
      return `edit:${p.cardId}:${key(p.title ?? "")}:${key(p.description ?? "")}`;
    case "move":
      return `move:${p.cardId}:${parentKey(p.parentId)}`;
    case "merge":
      return `merge:${[p.cardId, p.dropId].sort().join("|")}`;
    case "note":
      return `note:${key(p.text)}`;
  }
}

/** The proposals this one waits on: the new card it goes under, is moved into, or sits beside. */
export function dependsOn(p: Proposal, all: Proposal[]): Proposal[] {
  const pending = (id: string | null) => (id ? all.filter((x) => x.kind === "card" && x.cardId === id) : []);
  if (p.kind === "card" || p.kind === "move") return pending(p.parentId);
  if (p.kind === "note") return pending(p.anchorId);
  return [];
}

/** These proposals and every one they wait on (accepting a card under a new card accepts that one too). */
export function withNeeds(ids: string[], all: Proposal[]): string[] {
  const out = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) if (out.has(p.id)) for (const d of dependsOn(p, all)) if (!out.has(d.id)) out.add(d.id), (grew = true);
  }
  return all.filter((p) => out.has(p.id)).map((p) => p.id);
}

/** These proposals and every one that waits on them (discarding a new card discards what goes under it). */
export function withDependents(ids: string[], all: Proposal[]): string[] {
  const out = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) if (!out.has(p.id) && dependsOn(p, all).some((d) => out.has(d.id))) out.add(p.id), (grew = true);
  }
  return all.filter((p) => out.has(p.id)).map((p) => p.id);
}

/**
 * The trees a proposal changes on the board, by root (a new tree by its new root card's id; a
 * note is its own). A move or a merge can join two trees: they're drawn together then.
 */
export function touchedRoots(doc: Doc, p: Proposal, all: Proposal[]): string[] {
  const rootOf = (id: string | null): string | null => {
    if (!id) return null;
    if (doc.nodes[id]) return treeRootOf(doc, id);
    const pending = all.find((x) => x.kind === "card" && x.cardId === id);
    if (pending?.kind !== "card") return null;
    return pending.parentId ? rootOf(pending.parentId) : pending.cardId;
  };
  const ids =
    p.kind === "card" ? [p.parentId ? rootOf(p.parentId) : p.cardId]
    : p.kind === "move" ? [rootOf(p.cardId), p.parentId ? rootOf(p.parentId) : p.cardId]
    : p.kind === "merge" ? [rootOf(p.cardId), rootOf(p.dropId)]
    : p.kind === "note" ? [p.cardId]
    : [rootOf(p.cardId)];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

// ---------------------------------------------------------------------------
// Carrying one out

const resolve = (b: Backing, evidence: EvidenceOf) => [...b.quotes.map((q) => evidence(q, false)).filter((e): e is OstEvidence => !!e), ...b.words];

/** Words already on a card (the same span of the same source, or the same words). */
const sameWords = (a: OstEvidence, b: OstEvidence) => (fromSource(a) && fromSource(b) && a.sourceId && a.span && b.span ? a.sourceId === b.sourceId && a.span[0] === b.span[0] && a.span[1] === b.span[1] : a.text === b.text);

/** Carry out one proposal on a draft document. False when it no longer fits (a card gone or renamed, the words already there). */
export function applyProposal(d: Doc, p: Proposal, evidence: EvidenceOf): boolean {
  const card = (id: string) => (isOstCard(d.nodes[id]) ? d.nodes[id].meta.ost! : null);
  switch (p.kind) {
    case "attach":
    case "against": {
      const c = card(p.cardId);
      const ev = c && evidence(p.quote, p.kind === "against");
      if (!c || !ev || !quotable(c, ev.kind === "dump" ? "dump" : undefined) || hasQuote(c, ev.sourceId!, ev.span!, ev.piece)) return false;
      c.evidence.push(ev);
      return true;
    }
    case "card": {
      const parent = p.parentId ? card(p.parentId) : null;
      if (d.nodes[p.cardId] || (p.parentId ? !parent || !canHold(parent.kind, p.card.kind) : p.card.kind !== "outcome")) return false;
      const ev = resolve(p.backing, evidence);
      // Words it was to rest on are gone (their source was removed); only a need may rest on nothing (Assumed).
      if ((!ev.length && p.backing.quotes.length + p.backing.words.length > 0) || (!ev.length && p.card.kind !== "opportunity")) return false;
      addCardIn(d, { ...makeCardNode({ ...p.card, evidence: ev.map((e) => ({ ...e })) }, p.at), id: p.cardId }, p.parentId);
      return true;
    }
    case "assumption": {
      const c = card(p.cardId);
      if (c?.kind !== "solution") return false;
      const have = new Set((c.assumptions ?? []).map((a) => key(a.text)));
      const add = p.assumptions.filter((a) => !have.has(key(a.text)));
      if (!add.length) return false;
      c.assumptions = [...(c.assumptions ?? []), ...add.map((a) => ({ ...a }))];
      return true;
    }
    case "metric": {
      const c = card(p.cardId);
      if (c?.kind !== "outcome") return false;
      const m: OstMetric = c.metric ?? { name: "", direction: "increase", baseline: null, current: null, target: null };
      const next = { ...m, ...Object.fromEntries(Object.entries(p.metric).filter(([, v]) => v !== undefined)) } as OstMetric;
      if (JSON.stringify(next) === JSON.stringify(m)) return false;
      c.metric = next;
      return true;
    }
    case "edit": {
      const c = card(p.cardId);
      if (!c || c.title !== p.from) return false;
      updateCardIn(d, p.cardId, (x) => {
        if (p.title) x.title = p.title;
        if (p.description) x.description = p.description;
      });
      return true;
    }
    case "move": {
      const n = d.nodes[p.cardId];
      if (!isOstCard(n) || (n.parentId ?? null) !== p.fromParent) return false;
      if (p.parentId) return moveCardsIn(d, [p.cardId], p.parentId);
      if (n.meta.ost.kind !== "outcome") return false;
      reparentIn(d, [p.cardId], null);
      if (p.at) Object.assign(d.nodes[p.cardId], { x: p.at.x, y: p.at.y });
      return true;
    }
    case "merge": {
      const keep = card(p.cardId);
      const drop = card(p.dropId);
      if (!keep || !drop || keep.kind !== drop.kind || isDescendant(d, p.cardId, p.dropId) || isDescendant(d, p.dropId, p.cardId)) return false;
      const target = drop.stage === "target" && keep.stage !== "target";
      updateCardIn(d, p.cardId, (k) => {
        for (const e of drop.evidence) if (!k.evidence.some((x) => sameWords(x, e))) k.evidence.push({ ...e });
        const have = new Set((k.assumptions ?? []).map((a) => key(a.text)));
        const more = (drop.assumptions ?? []).filter((a) => !have.has(key(a.text)));
        if (more.length) k.assumptions = [...(k.assumptions ?? []), ...more.map((a) => ({ ...a }))];
        const designs = [...(k.designs ?? []), ...(drop.designs ?? []).filter((x) => !k.designs?.some((y) => y.projectId === x.projectId))];
        if (designs.length) k.designs = designs;
        if (!k.description && drop.description) k.description = drop.description;
        if (p.title) k.title = p.title;
      });
      if (target) setTargetIn(d, p.cardId);
      const kids = d.nodes[p.dropId].children.filter((c) => isOstCard(d.nodes[c]));
      if (kids.length) reparentIn(d, kids, p.cardId);
      deleteKeepIn(d, p.dropId);
      return true;
    }
    case "note": {
      if (d.nodes[p.cardId] || (p.anchorId && !d.nodes[p.anchorId])) return false;
      const { frame, text } = makeSticky(p.at ?? { x: 0, y: 0 }, p.color);
      const f = { ...frame, id: p.cardId, children: [p.textId], meta: { ...frame.meta, source: "ai" as const } };
      const t = { ...text, id: p.textId, parentId: p.cardId, text: { ...text.text, content: p.text } };
      d.nodes[f.id] = f;
      d.nodes[t.id] = t;
      d.roots.push(f.id);
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Drawn over the board

/**
 * The trees under `roots` as they would be with the proposals carried out, laid out: the ghost
 * drawn over the real trees while they're reviewed. Cards a proposal doesn't touch keep their
 * data object, so the board draws them as they are and only what would change as a ghost (a moved
 * card too, at its new place).
 */
export function proposalDoc(doc: Doc, roots: string[], proposals: Proposal[], evidence: EvidenceOf): Doc | null {
  const nodes: Doc["nodes"] = {};
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    nodes[id] = n;
    if (n.type === "frame") n.children.forEach(walk);
  };
  const real = roots.filter((r) => doc.nodes[r]);
  real.forEach(walk);
  const next = produce({ ...emptyDoc(), nodes, roots: [...real] } as Doc, (d) => {
    for (const p of proposals) {
      if (!applyProposal(d, p, evidence)) continue;
      if (p.kind === "move" && isOstCard(d.nodes[p.cardId])) d.nodes[p.cardId].meta.ost = { ...d.nodes[p.cardId].meta.ost! };
      if (p.kind === "note") d.nodes[p.cardId].opacity = 0.72;
    }
  });
  return next.roots.length ? layoutDocTrees(next) : null;
}

/** The right edge and top of what's on the board (new trees go beyond it), or null on an empty board. */
function boardEdge(doc: Doc): { x: number; y: number } | null {
  const ids = doc.roots.filter((id) => doc.nodes[id]);
  if (!ids.length) return null;
  const b = boundsOf(ids.flatMap((id) => {
    const r = rootBounds(doc, id);
    return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }];
  }));
  return { x: b.x + b.w, y: b.y };
}

/** Room for a note beside its card, and between notes. */
const NOTE_GAP = 48;

/**
 * Where what the proposals put on the board goes: new trees (and trees moved out on their own)
 * side by side to the right of everything, `origin` on an empty board; notes beside the tree of
 * the card they're about, stacked so they don't overlap. Returns the proposals with `at` set.
 */
export function arrangeNew(doc: Doc, proposals: Proposal[], evidence: EvidenceOf, origin: Pt = { x: 0, y: 0 }): Proposal[] {
  const edge = boardEdge(doc);
  let x = edge ? edge.x + 240 : origin.x;
  const y = edge ? edge.y : origin.y;
  const out = proposals.map((p) => ({ ...p }));
  for (const p of out) {
    const root = p.kind === "card" && !p.parentId ? p.cardId : p.kind === "move" && !p.parentId ? p.cardId : null;
    if (!root || (p.kind !== "card" && p.kind !== "move")) continue;
    p.at = { x: Math.round(x), y: Math.round(y) };
    // How wide it will be: a moved branch as it is; a new tree laid out with what goes under it.
    let w = 320;
    if (p.kind === "move" && doc.nodes[p.cardId]) w = boundsOf(visibleCards(doc, p.cardId).flatMap((id) => worldCorners(doc, id))).w;
    else {
      const own = proposalDoc(doc, [], out.filter((q) => q.kind === "card" && touchedRoots(doc, q, out).includes(root)), evidence);
      if (own?.nodes[root]) w = treeBounds(own, root).w;
    }
    x += w + TREE_GAP;
  }
  // Notes: beside the board as it would be, at their card's height.
  const notes = out.filter((p): p is Extract<Proposal, { kind: "note" }> => p.kind === "note");
  if (!notes.length) return out;
  const rest = out.filter((p) => p.kind !== "note");
  const roots = [...new Set(rest.flatMap((p) => touchedRoots(doc, p, rest)))];
  const ghost = proposalDoc(doc, [...new Set([...roots, ...doc.roots.filter((r) => isOstCard(doc.nodes[r]))])], rest, evidence) ?? doc;
  const taken: { x: number; y0: number; y1: number }[] = [];
  for (const n of notes) {
    const anchor = n.anchorId && ghost.nodes[n.anchorId] ? n.anchorId : null;
    const root = anchor ? treeRootOf(ghost, anchor) : null;
    const tree = root ? treeBounds(ghost, root) : null;
    const box = anchor ? worldBounds(ghost, anchor) : null;
    const nx = tree ? tree.x + tree.w + NOTE_GAP + 100 : x + 100;
    let top = box ? box.y : y;
    // Stacked under a note already in that column.
    for (const t of taken) if (Math.abs(t.x - nx) < 200 && top < t.y1 && top + 120 > t.y0) top = t.y1 + 16;
    taken.push({ x: nx, y0: top, y1: top + 140 });
    n.at = { x: Math.round(nx), y: Math.round(top + 60) };
  }
  return out;
}
