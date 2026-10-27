import { produce } from "immer";
import type { Doc, FrameNode, SceneNode } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import { isNote, isOstCard, treeRootOf } from "@/doc/board";
import { reparentIn } from "@/doc/ops";
import { type Box, boxesIntersect } from "@/doc/geometry";
import { cardBox } from "./metrics";
import { layoutTree, type LayoutNode } from "./layout";

/*
 * Keeping the board's trees tidy, after every edit and in the same undo step (registered as a
 * document pass by the Discovery boot, see store.ts). It finds the trees an edit touched, puts
 * anything that ended up in the wrong place back (a sticky pasted into a card, a card pasted into
 * a sticky), sizes each card to its content and lays the tree out again. Moving a tree's root
 * alone needs nothing: its cards sit relative to it. Only what the edit changed is looked at, so
 * a drag stays cheap. A tree that grows into another pushes it aside; one dragged onto another
 * doesn't (that's where it was put).
 */

/** Same node but for its position? (a tree's root dragged: its cards move with it) */
function onlyMoved(a: SceneNode, b: SceneNode): boolean {
  const ka = Object.keys(a) as (keyof SceneNode)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k === "x" || k === "y" || a[k] === b[k]);
}

/** A card's node fields are the card's: no paints, corners, clipping, layout, turn or fade. */
const unsealed = (n: FrameNode) => !!(n.fill || n.stroke || n.radius || n.clip || n.effects?.length || n.layout || n.rotation || n.flipH || n.flipV || n.opacity !== 1);

interface Plan {
  /** Trees to lay out again, by root id (as the doc is after the edit). */
  roots: Set<string>;
  /** Layers to move back onto the board (out of a card, or a card out of something else). */
  lift: string[];
  seal: string[];
  /** Cards renamed in the Layers panel: the name becomes the title. */
  retitle: string[];
  /** Stickies left without a text. */
  drop: string[];
}

function plan(prev: Doc, next: Doc): Plan {
  const p: Plan = { roots: new Set(), lift: [], seal: [], retitle: [], drop: [] };
  const mark = (id: string | null | undefined) => {
    const r = id ? treeRootOf(next, id) : null;
    if (r) p.roots.add(r);
  };
  for (const id in next.nodes) {
    const n = next.nodes[id];
    const before = prev.nodes[id];
    if (n === before) continue;
    const parent = n.parentId ? next.nodes[n.parentId] : undefined;
    if (isOstCard(n)) {
      if (unsealed(n)) p.seal.push(id);
      if (n.name !== n.meta.ost!.title) p.retitle.push(id);
      if (parent && !isOstCard(parent)) {
        p.lift.push(id);
        continue;
      }
      if (before?.parentId && before.parentId !== n.parentId) mark(before.parentId);
      if (!(before && !n.parentId && !before.parentId && onlyMoved(before, n))) mark(id);
    } else {
      if (parent && isOstCard(parent)) p.lift.push(id);
      if (before?.parentId && before.parentId !== n.parentId) mark(before.parentId);
      if (isNote(n) && !n.children.length) p.drop.push(id);
    }
  }
  for (const id in prev.nodes) if (!next.nodes[id]) mark(prev.nodes[id].parentId);
  return p;
}

/** A tree for the layout: each card's size, its showing children (none when folded). */
function layoutNode(d: Doc, id: string): LayoutNode {
  const n = d.nodes[id] as FrameNode;
  const card = n.meta.ost!;
  const box = cardBox(card);
  const kids = card.collapsed ? [] : n.children.filter((c) => isOstCard(d.nodes[c])).map((c) => layoutNode(d, c));
  return { id, w: box.w, h: box.h, kids };
}

/** Lay one tree out in place (draft): sizes, positions relative to each parent card, what's folded away. */
function layoutOne(d: Doc, rootId: string) {
  const root = d.nodes[rootId] as FrameNode;
  const tree = layoutNode(d, rootId);
  const at = layoutTree(tree, { orientation: root.meta.ost!.orientation ?? "tb" });
  const write = (t: LayoutNode, abs: { x: number; y: number }, parentAbs: { x: number; y: number } | null) => {
    const n = d.nodes[t.id] as FrameNode;
    if (n.w !== t.w) n.w = t.w;
    if (n.h !== t.h) n.h = t.h;
    if (parentAbs) {
      const x = abs.x - parentAbs.x;
      const y = abs.y - parentAbs.y;
      if (n.x !== x) n.x = x;
      if (n.y !== y) n.y = y;
    }
    if (!n.visible) n.visible = true;
    for (const k of t.kids) write(k, at.get(k.id)!, abs);
  };
  write(tree, { x: 0, y: 0 }, null);
  // Everything under a folded card is hidden (and keeps its last place for when it unfolds).
  const hide = (id: string, hidden: boolean) => {
    const n = d.nodes[id] as FrameNode;
    const h = hidden || !!n.meta.ost!.collapsed;
    for (const c of n.children) {
      const child = d.nodes[c];
      if (!isOstCard(child)) continue;
      if (h && child.visible) child.visible = false;
      hide(c, h);
    }
  };
  hide(rootId, false);
}

/** Room kept between two trees when one grows into the other. */
export const TREE_GAP = 160;

/** The box a tree's showing cards cover (worked out on the spot: a draft has no cache). */
function boxOf(d: Doc, rootId: string): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const walk = (id: string, ax: number, ay: number) => {
    const n = d.nodes[id];
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, ax + n.w);
    y1 = Math.max(y1, ay + n.h);
    if (n.type !== "frame") return;
    for (const c of n.children) if (isOstCard(d.nodes[c]) && d.nodes[c].visible) walk(c, ax + d.nodes[c].x, ay + d.nodes[c].y);
  };
  const r = d.nodes[rootId];
  walk(rootId, r.x, r.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 });

/**
 * Trees an edit grew into pushed aside along the board, away from the tree that grew (and the
 * ones they then run into, in turn). The trees edited stay put, each tree moves once at most, and
 * a tree that was already that close before the edit, or a new one, is left where it was put.
 */
function separateTrees(prev: Doc, d: Doc, grown: Set<string>) {
  const trees = d.roots.filter((id) => isOstCard(d.nodes[id]));
  if (trees.length < 2) return;
  const boxes = new Map(trees.map((id) => [id, boxOf(d, id)]));
  const queue = trees.filter((id) => grown.has(id));
  const settled = new Set(queue);
  const pushed = new Set<string>();
  const wasTree = (id: string) => isOstCard(prev.nodes[id]) && !prev.nodes[id].parentId;
  while (queue.length) {
    const a = queue.shift()!;
    // A new tree (a card put on the board) sits where it was put.
    if (!pushed.has(a) && !wasTree(a)) continue;
    const A = boxes.get(a)!;
    const room = grow(A, TREE_GAP);
    const before = pushed.has(a) ? null : grow(boxOf(prev, a), TREE_GAP);
    for (const b of trees) {
      if (settled.has(b)) continue;
      const B = boxes.get(b)!;
      if (!boxesIntersect(room, B)) continue;
      if (before && wasTree(b) && boxesIntersect(before, boxOf(prev, b))) continue;
      const right = B.x + B.w / 2 >= A.x + A.w / 2;
      const dx = right ? A.x + A.w + TREE_GAP - B.x : A.x - TREE_GAP - (B.x + B.w);
      d.nodes[b].x += dx;
      boxes.set(b, { ...B, x: B.x + dx });
      settled.add(b);
      pushed.add(b);
      queue.push(b);
    }
  }
}

/** The document pass: tidy what this edit touched (returns `next` itself when there's nothing to do). */
export function ostPass(prev: Doc, next: Doc): Doc {
  if (prev.nodes === next.nodes) return next;
  const p = plan(prev, next);
  if (!p.roots.size && !p.lift.length && !p.seal.length && !p.retitle.length && !p.drop.length) return next;
  return produce(next, (d) => {
    for (const id of p.retitle) d.nodes[id].meta.ost!.title = d.nodes[id].name;
    for (const id of p.seal) {
      const n = d.nodes[id] as FrameNode;
      n.fill = null;
      n.stroke = null;
      n.radius = null;
      n.clip = false;
      n.rotation = 0;
      n.opacity = 1;
      delete n.effects;
      delete n.layout;
      delete n.flipH;
      delete n.flipV;
    }
    for (const id of p.lift) {
      const n = d.nodes[id];
      if (!n?.parentId) continue;
      const from = treeRootOf(d as Doc, n.parentId);
      // Back on the board where it showed (a card pasted into a sticky becomes a branch of its own).
      reparentIn(d as Doc, [id], null);
      if (from) p.roots.add(from);
      if (isOstCard(d.nodes[id])) p.roots.add(id);
    }
    for (const id of p.drop) {
      const n = d.nodes[id];
      if (!n || n.children.length) continue;
      const list = n.parentId ? d.nodes[n.parentId]?.children : d.roots;
      const i = list?.indexOf(id) ?? -1;
      if (list && i >= 0) list.splice(i, 1);
      delete d.nodes[id];
    }
    const laid = new Set<string>();
    for (const id of p.roots)
      if (isOstCard(d.nodes[id]) && !d.nodes[id].parentId) {
        layoutOne(d as Doc, id);
        laid.add(id);
      }
    if (laid.size) separateTrees(prev, d as Doc, laid);
  });
}

/** Every tree laid out again (fonts loaded, a document opened): call outside undo history. */
export function layoutDocTrees(doc: Doc): Doc {
  return ostPass(emptyDoc(), doc);
}
