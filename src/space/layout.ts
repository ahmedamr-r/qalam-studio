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
/** The column of problems no goal covers: one under another. */
const COLUMN_GAP = 24;

export function layoutSpace(doc: Doc, o: LayoutOptions = {}): { doc: Doc; slots: Map<string, Box> } {
  const slots = new Map<string, Box>();
  const out = produce(doc, (d) => {
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
      const kids = n.meta.ost!.collapsed ? [] : own(id).map(layoutNode);
      const rows = o.lanes?.get(id) ?? 0;
      // The lane's column, first among its children: the goal's own cards start right of it.
      if (rows && kids.length) kids.unshift({ id: `lane:${id}`, w: LANE_ROOM, h: Math.max(rows * (LANE_ITEM_H + LANE_ROW_GAP), depthOf(id)), kids: [] });
      return { id, w: box.w, h: box.h, kids };
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
      const at = layoutTree(t, { orientation: "tb" });
      let x0 = Infinity;
      let x1 = -Infinity;
      const span = (n: LayoutNode) => {
        x0 = Math.min(x0, at.get(n.id)!.x);
        x1 = Math.max(x1, at.get(n.id)!.x + n.w);
        n.kids.forEach(span);
      };
      span(t);
      const r = d.nodes[root] as FrameNode;
      if (r.x !== x - x0) r.x = x - x0;
      if (r.y !== 0) r.y = 0;
      write(d, t, at, { x: 0, y: 0 }, null, slots, { x: r.x, y: r.y });
      x += x1 - x0 + TREE_GAP;
    }
    let y = 0;
    for (const id of column) {
      const n = d.nodes[id] as FrameNode;
      const box = cardBox(n.meta.ost!);
      if (n.w !== box.w) n.w = box.w;
      if (n.h !== box.h) n.h = box.h;
      if (n.x !== x) n.x = x;
      if (n.y !== y) n.y = y;
      if (!n.visible) n.visible = true;
      y += box.h + COLUMN_GAP;
    }
  });
  return { doc: out, slots };
}

/** Sizes, positions relative to each parent card, what's folded away hidden; a lane's column into `slots` (world). */
function write(d: Doc, t: LayoutNode, at: Map<string, { x: number; y: number }>, abs: { x: number; y: number }, parentAbs: { x: number; y: number } | null, slots: Map<string, Box>, origin: { x: number; y: number }) {
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
  for (const k of t.kids) {
    const p = at.get(k.id)!;
    if (k.id.startsWith("lane:")) slots.set(k.id.slice(5), { x: origin.x + p.x, y: origin.y + p.y, w: LANE_W, h: k.h });
    else write(d, k, at, p, abs, slots, origin);
  }
  // Everything under a fold is hidden (and keeps its last place).
  if (n.meta.ost!.collapsed) for (const c of n.children) if (isOstCard(d.nodes[c])) hide(d, c);
}

function hide(d: Doc, id: string) {
  const n = d.nodes[id] as FrameNode;
  if (n.visible) n.visible = false;
  for (const c of n.children) if (isOstCard(d.nodes[c])) hide(d, c);
}
