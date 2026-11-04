import { produce } from "immer";
import type { Doc, FrameNode } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import type { Box } from "@/doc/geometry";
import { GAPS, layoutTree, type LayoutNode } from "@/discovery/layout";
import { LANE_GAP, LANE_ITEM_H, LANE_ROW_GAP, LANE_W } from "@/discovery/lane";
import { cardBox } from "@/discovery/metrics";
import { TREE_GAP } from "@/discovery/pass";

/*
 * Where everything on a space's canvas goes (pure): each tree laid out as a board lays its trees
 * out (sizes from the cards, the same tidy tree), the trees side by side from the left, the
 * problems no goal covers in a column on the right. Worked out after every edit and never kept,
 * so a board's file never changes for where a card sits on the canvas. With `lanes` (how many
 * sources each goal's lane holds), each goal keeps a column at the left of its own cards for its
 * lane, so no lane lands on another tree; `slots` says where each one is.
 */

export interface LayoutOptions {
  /** Cards that go in the column on the right (problems no goal covers). */
  column?: (id: string) => boolean;
  /** Goals' cards: a goal's lane runs only as deep as its own cards, not its sub-goals'. */
  isGoal?: (id: string) => boolean;
  lanes?: ReadonlyMap<string, number>;
}

/** What a goal's sources lane takes on its left, as the layout keeps room for it. */
const LANE_ROOM = LANE_W + LANE_GAP - GAPS.tb.branchGap;
/** The same beside a goal with no cards under it: the two are siblings with nothing under them, so a closer gap. */
const LANE_ROOM_BESIDE = LANE_W + LANE_GAP - GAPS.tb.siblingGap;
const laneHeight = (rows: number) => rows * (LANE_ITEM_H + LANE_ROW_GAP);
/** The column of problems no goal covers: one under another. */
const COLUMN_GAP = 24;

type Place = { x?: number; y?: number; w?: number; h?: number; visible: boolean };

export function layoutSpace(doc: Doc, o: LayoutOptions = {}): { doc: Doc; slots: Map<string, Box> } {
  const slots = new Map<string, Box>();
  // Worked out on the document as it is (plain reads are cheap), then only the cards whose place
  // changed are written (a draft per node changed, not per node read).
  const want = new Map<string, Place>();
  const d = doc;
  const own = (id: string) => (d.nodes[id] as FrameNode).children.filter((c) => isOstCard(d.nodes[c]));
  const sized = (id: string, kids: (id: string) => string[]): LayoutNode => {
    const n = d.nodes[id] as FrameNode;
    const box = cardBox(n.meta.ost!);
    return { id, w: box.w, h: box.h, kids: n.meta.ost!.collapsed ? [] : kids(id).map((c) => sized(c, kids)) };
  };
  /** How deep a goal's own cards go (not its sub-goals'): its lane's column runs that far. */
  const depthOf = (id: string) => {
    const t = sized(id, (x) => own(x).filter((c) => x !== id || !o.isGoal?.(c)));
    const at = layoutTree(t, { orientation: "tb" });
    let bottom = 0;
    const walk = (n: LayoutNode) => {
      bottom = Math.max(bottom, at.get(n.id)!.y + n.h);
      n.kids.forEach(walk);
    };
    walk(t);
    return bottom - t.h - GAPS.tb.levelGap;
  };
  const layoutNode = (id: string): LayoutNode => {
    const n = d.nodes[id] as FrameNode;
    const box = cardBox(n.meta.ost!);
    const kids = n.meta.ost!.collapsed
      ? []
      : own(id).flatMap((c) => {
          const kid = layoutNode(c);
          const rows = o.lanes?.get(c) ?? 0;
          // A goal with nothing under it has no children to lead: its lane goes beside it, among its siblings.
          return rows && !kid.kids.length ? [{ id: `lane:${c}`, w: LANE_ROOM_BESIDE, h: laneHeight(rows), kids: [] }, kid] : [kid];
        });
    const rows = o.lanes?.get(id) ?? 0;
    // The lane's column, first among its children: the goal's own cards start right of it.
    if (rows && kids.length) kids.unshift({ id: `lane:${id}`, w: LANE_ROOM, h: Math.max(laneHeight(rows), depthOf(id)), kids: [] });
    return { id, w: box.w, h: box.h, kids };
  };
  /** Sizes, positions relative to each parent card, what's folded away hidden; a lane's column into `slots` (world). */
  const place = (t: LayoutNode, at: Map<string, { x: number; y: number }>, abs: { x: number; y: number }, parentAbs: { x: number; y: number } | null, origin: { x: number; y: number }) => {
    want.set(t.id, { ...(want.get(t.id) ?? {}), w: t.w, h: t.h, visible: true, ...(parentAbs ? { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y } : {}) });
    for (const k of t.kids) {
      const p = at.get(k.id)!;
      if (k.id.startsWith("lane:")) slots.set(k.id.slice(5), { x: origin.x + p.x, y: origin.y + p.y, w: LANE_W, h: k.h });
      else place(k, at, p, abs, origin);
    }
    // Everything under a fold is hidden (and keeps its last place).
    const hide = (id: string) => {
      want.set(id, { visible: false });
      for (const c of d.nodes[id].children) if (isOstCard(d.nodes[c])) hide(c);
    };
    if (d.nodes[t.id].meta.ost!.collapsed) for (const c of d.nodes[t.id].children) if (isOstCard(d.nodes[c])) hide(c);
  };
  let x = 0;
  const column: string[] = [];
  for (const root of d.roots) {
    if (!isOstCard(d.nodes[root])) continue;
    if (o.column?.(root)) {
      column.push(root);
      continue;
    }
    const t = layoutNode(root);
    // A tree of one card: its lane goes left of it, clear of the tree before.
    const rows = o.lanes?.get(root) ?? 0;
    if (rows && !t.kids.length) {
      slots.set(root, { x, y: 0, w: LANE_W, h: laneHeight(rows) });
      x += LANE_W + LANE_GAP;
    }
    const at = layoutTree(t, { orientation: "tb" });
    let x0 = Infinity;
    let x1 = -Infinity;
    const span = (n: LayoutNode) => {
      x0 = Math.min(x0, at.get(n.id)!.x);
      x1 = Math.max(x1, at.get(n.id)!.x + n.w);
      n.kids.forEach(span);
    };
    span(t);
    const r = { x: x - x0, y: 0 };
    want.set(root, { x: r.x, y: r.y, visible: true });
    place(t, at, { x: 0, y: 0 }, null, r);
    x += x1 - x0 + TREE_GAP;
  }
  let y = 0;
  for (const id of column) {
    const box = cardBox(d.nodes[id].meta.ost!);
    want.set(id, { x, y, w: box.w, h: box.h, visible: true });
    y += box.h + COLUMN_GAP;
  }
  const changed = [...want].filter(([id, p]) => {
    const n = d.nodes[id];
    return (p.x !== undefined && n.x !== p.x) || (p.y !== undefined && n.y !== p.y) || (p.w !== undefined && n.w !== p.w) || (p.h !== undefined && n.h !== p.h) || n.visible !== p.visible;
  });
  if (!changed.length) return { doc, slots };
  const out = produce(doc, (draft) => {
    for (const [id, p] of changed) {
      const n = draft.nodes[id];
      if (p.x !== undefined) n.x = p.x;
      if (p.y !== undefined) n.y = p.y;
      if (p.w !== undefined) n.w = p.w;
      if (p.h !== undefined) n.h = p.h;
      n.visible = p.visible;
    }
  });
  return { doc: out, slots };
}

/**
 * Each goal's own cards (its board's and the problems behind it, not its sub-goals'), and each
 * tree no goal heads: one sources lane each, at the head's column.
 */
export function groupsOf(doc: Doc, isGoal: (id: string) => boolean): { head: string; cards: string[] }[] {
  const out: { head: string; cards: string[] }[] = [];
  const own = (head: string) => {
    const cards = [head];
    const walk = (id: string) => {
      for (const c of (doc.nodes[id] as FrameNode).children) {
        if (!isOstCard(doc.nodes[c])) continue;
        if (isGoal(c)) heads.push(c);
        else {
          cards.push(c);
          walk(c);
        }
      }
    };
    walk(head);
    out.push({ head, cards });
  };
  const heads = doc.roots.filter((id) => isOstCard(doc.nodes[id]));
  while (heads.length) own(heads.shift()!);
  return out;
}

/** How many sources each head's lane holds. */
export function laneRows(items: readonly { root: string }[]): Map<string, number> {
  const rows = new Map<string, number>();
  for (const it of items) rows.set(it.root, (rows.get(it.root) ?? 0) + 1);
  return rows;
}

/**
 * Under a goal's card its own cards come first, then the problems no board has, then the goals
 * under it, as the canvas is composed (./compose.ts): a card added under a goal joins its own.
 */
export function goalsLast(doc: Doc, isGoal: (id: string) => boolean): Doc {
  const rank = (id: string) => (isGoal(id) ? 2 : id.startsWith("topic:") ? 1 : 0);
  const wrong = Object.keys(doc.nodes).filter((id) => {
    if (!isGoal(id)) return false;
    const r = (doc.nodes[id] as FrameNode).children.map(rank);
    return r.some((x, i) => i > 0 && x < r[i - 1]);
  });
  if (!wrong.length) return doc;
  return produce(doc, (d) => {
    for (const id of wrong) {
      const n = d.nodes[id] as FrameNode;
      n.children = [...n.children].map((c, i) => [c, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);
    }
  });
}
