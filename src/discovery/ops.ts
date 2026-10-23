import type { Doc, FrameNode } from "@/doc/schema";
import { studio } from "@/doc/store";
import { isOstCard, treeRootOf } from "@/doc/board";
import { type Pt, isDescendant } from "@/doc/geometry";
import { newId } from "@/doc/factory";
import { reparentIn } from "@/doc/ops";
import { CARD_WIDTH, CHILD_KINDS, DEFAULT_STAGE, KIND_LABEL, canHold, defaultChildKind } from "./kinds";
import type { OstCard, OstKind, OstStage } from "./types";

/*
 * Editing the tree. The `…In` functions work on a draft inside one `mutate` (so a gesture or a
 * command is one undo step); the rest wrap them for commands and panels. Positions are never set
 * here: the layout pass (pass.ts) places every card after each edit.
 */

const PLURAL: Record<OstKind, string> = { outcome: "outcomes", opportunity: "opportunities", solution: "solutions", test: "tests" };

export function newCard(kind: OstKind, data: Partial<OstCard> = {}): OstCard {
  return { v: 1, kind, title: "", stage: DEFAULT_STAGE[kind], createdBy: "user", evidence: [], ...data };
}

/** A card's node, not yet in a document. */
export function makeCardNode(card: OstCard, at: Pt = { x: 0, y: 0 }): FrameNode {
  return {
    id: newId(),
    type: "frame",
    name: card.title,
    parentId: null,
    children: [],
    x: at.x,
    y: at.y,
    w: CARD_WIDTH[card.kind],
    h: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: null,
    stroke: null,
    radius: null,
    clip: false,
    dir: "ltr",
    meta: { source: card.createdBy === "ai" ? "ai" : "user", ost: card },
  };
}

export const cardOf = (doc: Doc, id: string | null | undefined): OstCard | null => {
  const n = id ? doc.nodes[id] : undefined;
  return isOstCard(n) ? n.meta.ost! : null;
};

const listOf = (d: Doc, parentId: string | null) => (parentId ? d.nodes[parentId].children : d.roots);

/** Put a card node in the document under `parentId` (null: on the board), at `index` (default last). */
export function addCardIn(d: Doc, node: FrameNode, parentId: string | null, index?: number) {
  d.nodes[node.id] = node;
  node.parentId = parentId;
  const list = listOf(d, parentId);
  list.splice(Math.max(0, Math.min(index ?? list.length, list.length)), 0, node.id);
}

/** Why these cards can't go under `target`, or null when they can (null target: onto the board, always fine). */
export function dropProblem(doc: Doc, ids: string[], target: string | null): string | null {
  if (!target) return null;
  const t = cardOf(doc, target);
  if (!t) return "Cards go under other cards";
  for (const id of ids) {
    const c = cardOf(doc, id);
    if (!c) return "Only cards go in the tree";
    if (id === target || isDescendant(doc, target, id)) return "A card can't go inside itself";
    if (!canHold(t.kind, c.kind)) return CHILD_KINDS[t.kind].length ? `${KIND_LABEL[t.kind]} cards hold ${CHILD_KINDS[t.kind].map((k) => PLURAL[k]).join(" and ")}` : `${KIND_LABEL[t.kind]} cards hold no other cards`;
  }
  return null;
}

/** Move cards under `target` at `index` (null target: onto the board where they show). Returns false when they can't go there. */
export function moveCardsIn(d: Doc, ids: string[], target: string | null, index?: number): boolean {
  if (dropProblem(d, ids, target)) return false;
  // Moving within the same list: the index counts the list without the moved cards.
  if (target !== null && index !== undefined) {
    const list = listOf(d, target);
    const before = list.slice(0, index).filter((id) => ids.includes(id)).length;
    index -= before;
  }
  reparentIn(d, ids, target, index);
  return true;
}

/** One step earlier (-1) or later (+1) among its siblings. */
export function reorderCardIn(d: Doc, id: string, delta: -1 | 1): boolean {
  const n = d.nodes[id];
  if (!n) return false;
  const list = listOf(d, n.parentId);
  const cards = list.filter((x) => isOstCard(d.nodes[x]));
  const i = cards.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cards.length) return false;
  const a = list.indexOf(id);
  const b = list.indexOf(cards[j]);
  list[a] = cards[j];
  list[b] = id;
  return true;
}

/** Delete a card but keep what's under it: its children move up to its parent where they fit, else onto the board. */
export function deleteKeepIn(d: Doc, id: string) {
  const n = d.nodes[id];
  if (!n) return;
  const parent = n.parentId;
  const at = listOf(d, parent).indexOf(id);
  const kids = n.children.filter((c) => isOstCard(d.nodes[c]));
  const fits = kids.filter((c) => parent && !dropProblem(d, [c], parent));
  if (fits.length) reparentIn(d, fits, parent, at);
  const rest = kids.filter((c) => !fits.includes(c));
  if (rest.length) reparentIn(d, rest, null);
  const list = listOf(d, parent);
  list.splice(list.indexOf(id), 1);
  delete d.nodes[id];
}

/** Change a card's data; its layer name follows the title. */
export function updateCardIn(d: Doc, id: string, fn: (c: OstCard) => void) {
  const n = d.nodes[id];
  if (!isOstCard(n)) return;
  fn(n.meta.ost!);
  if (n.name !== n.meta.ost!.title) n.name = n.meta.ost!.title;
}

/** Make an opportunity the tree's target (there is one at a time); returns the title of the one it replaced. */
export function setTargetIn(d: Doc, id: string): string | null {
  const c = cardOf(d, id);
  const root = treeRootOf(d, id);
  if (!c || c.kind !== "opportunity" || !root) return null;
  let was: string | null = null;
  const walk = (cid: string) => {
    const k = cardOf(d, cid);
    if (k && cid !== id && k.kind === "opportunity" && k.stage === "target") {
      k.stage = "exploring";
      was = k.title;
    }
    for (const ch of d.nodes[cid]?.children ?? []) walk(ch);
  };
  walk(root);
  c.stage = "target";
  return was;
}

/** The kinds a card could be where it sits: its parent can hold it, and it can hold its children. */
export function kindsFor(doc: Doc, id: string): OstKind[] {
  const n = doc.nodes[id];
  const c = cardOf(doc, id);
  if (!n || !c) return [];
  const parent = cardOf(doc, n.parentId);
  const kids = n.children.map((k) => cardOf(doc, k)?.kind).filter((k): k is OstKind => !!k);
  return (["outcome", "opportunity", "solution", "test"] as OstKind[]).filter((k) => (parent ? canHold(parent.kind, k) : true) && kids.every((ck) => canHold(k, ck)));
}

/** Turn a card into another kind: its words and evidence stay, its stage starts over, fields of the old kind go. */
export function setKindIn(d: Doc, id: string, kind: OstKind) {
  if (!kindsFor(d, id).includes(kind)) return;
  updateCardIn(d, id, (c) => {
    if (c.kind === kind) return;
    c.kind = kind;
    c.stage = DEFAULT_STAGE[kind];
    if (kind !== "outcome") {
      delete c.metric;
      delete c.orientation;
    }
    if (kind !== "solution") {
      delete c.assumptions;
      delete c.designs;
    }
    if (kind !== "test") delete c.test;
  });
}

// ---------------------------------------------------------------------------
// For commands and panels (each one undo step)

/** A new card under `parentId` (its kind decided by what the parent holds unless given). Returns its id. */
export function addChild(parentId: string, kind?: OstKind, data: Partial<OstCard> = {}): string | null {
  const doc = studio().doc;
  const p = cardOf(doc, parentId);
  if (!p) return null;
  const childKinds = doc.nodes[parentId].children.map((c) => cardOf(doc, c)?.kind).filter((k): k is OstKind => !!k);
  const k = kind ?? defaultChildKind(p, childKinds);
  if (!k || !canHold(p.kind, k)) return null;
  const node = makeCardNode(newCard(k, data));
  studio().mutate((d) => addCardIn(d, node, parentId));
  return node.id;
}

/** A new card next to this one (same kind, same parent). On a tree's root: a child instead. */
export function addSibling(id: string): string | null {
  const doc = studio().doc;
  const n = doc.nodes[id];
  const c = cardOf(doc, id);
  if (!n || !c) return null;
  if (!n.parentId || !isOstCard(doc.nodes[n.parentId])) return c.kind === "test" ? null : addChild(id);
  const node = makeCardNode(newCard(c.kind));
  const at = doc.nodes[n.parentId].children.indexOf(id) + 1;
  studio().mutate((d) => addCardIn(d, node, n.parentId, at));
  return node.id;
}

export function setStage(ids: string[], stage: OstStage) {
  studio().mutate((d) => {
    for (const id of ids) updateCardIn(d, id, (c) => void (c.stage = stage));
  });
}

export function setTitle(id: string, title: string) {
  studio().mutate((d) => updateCardIn(d, id, (c) => void (c.title = title)));
}

export function toggleCollapsed(ids: string[]) {
  const doc = studio().doc;
  const live = ids.filter((id) => cardOf(doc, id) && doc.nodes[id].children.some((c) => isOstCard(doc.nodes[c])));
  if (!live.length) return 0;
  // Folding a mix: all fold; only folded ones: all unfold.
  const fold = live.some((id) => !cardOf(doc, id)!.collapsed);
  studio().mutate((d) => {
    for (const id of live) updateCardIn(d, id, (c) => (fold ? (c.collapsed = true) : delete c.collapsed));
  });
  return live.length;
}

/** Unfold every folded card above this one, so it shows. */
export function revealCard(id: string) {
  const doc = studio().doc;
  const folded: string[] = [];
  let p = doc.nodes[id]?.parentId;
  while (p && isOstCard(doc.nodes[p])) {
    if (cardOf(doc, p)!.collapsed) folded.push(p);
    p = doc.nodes[p].parentId;
  }
  if (folded.length) studio().mutate((d) => folded.forEach((f) => updateCardIn(d, f, (c) => void delete c.collapsed)));
}
