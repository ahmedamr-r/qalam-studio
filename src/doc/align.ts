import type { Doc } from "./schema";
import { studio } from "./store";
import { apply, invert, selectionBounds, worldBounds, worldMatrix, type Box } from "./geometry";
import { topLevelOf } from "./ops";
import { inFlow } from "./autolayout";

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Figma-style alignment: one layer aligns to its parent frame, several align to their shared bounds. */
export function alignNodes(ids: string[], how: AlignKind) {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids);
  if (!tops.length) return;
  let target: Box | null;
  if (tops.length === 1) {
    const parent = doc.nodes[tops[0]].parentId;
    if (!parent) return;
    target = worldBounds(doc, parent);
  } else target = selectionBounds(doc, tops);
  if (!target) return;
  const t = target;
  studio().mutate((d) => {
    for (const id of tops) {
      const b = worldBounds(d, id);
      let dx = 0;
      let dy = 0;
      if (how === "left") dx = t.x - b.x;
      if (how === "hcenter") dx = t.x + t.w / 2 - (b.x + b.w / 2);
      if (how === "right") dx = t.x + t.w - (b.x + b.w);
      if (how === "top") dy = t.y - b.y;
      if (how === "vcenter") dy = t.y + t.h / 2 - (b.y + b.h / 2);
      if (how === "bottom") dy = t.y + t.h - (b.y + b.h);
      const n = d.nodes[id];
      // Convert the world-space delta into the parent's space.
      const pInv = n.parentId ? invert(worldMatrix(d, n.parentId)) : null;
      if (pInv) {
        const a = apply(pInv, { x: 0, y: 0 });
        const c = apply(pInv, { x: dx, y: dy });
        n.x = Math.round(n.x + c.x - a.x);
        n.y = Math.round(n.y + c.y - a.y);
      } else {
        n.x = Math.round(n.x + dx);
        n.y = Math.round(n.y + dy);
      }
    }
  });
}

/** Whether alignment is available for the selection (single top-level frames have nothing to align to). */
export function canAlign(ids: string[]): boolean {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids);
  return tops.length > 1 || (tops.length === 1 && !!doc.nodes[tops[0]]?.parentId);
}

/**
 * Distribute horizontal (or vertical) spacing: the outermost layers stay put and the gaps between
 * all of them become equal. Needs 3+ layers; layers placed by auto layout are left to the flow.
 */
export function distributeNodes(ids: string[], axis: "h" | "v") {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids);
  if (tops.length < 3) return;
  const boxes = tops.map((id) => ({ id, b: worldBounds(doc, id) }));
  const pos = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.w : b.h);
  boxes.sort((a, c) => pos(a.b) - pos(c.b));
  const first = boxes[0].b;
  const last = boxes[boxes.length - 1].b;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - boxes.reduce((sum, x) => sum + size(x.b), 0)) / (boxes.length - 1);
  let at = pos(first);
  const moves = boxes.map(({ id, b }) => {
    const delta = Math.round(at - pos(b));
    at += size(b) + gap;
    return { id, delta };
  });
  studio().mutate((d) => {
    for (const { id, delta } of moves) {
      const n = d.nodes[id];
      if (!delta || inFlow(d, n)) continue;
      const w = axis === "h" ? { x: delta, y: 0 } : { x: 0, y: delta };
      const pInv = n.parentId ? invert(worldMatrix(d, n.parentId)) : null;
      if (pInv) {
        const a = apply(pInv, { x: 0, y: 0 });
        const c = apply(pInv, w);
        n.x = Math.round(n.x + c.x - a.x);
        n.y = Math.round(n.y + c.y - a.y);
      } else {
        n.x += w.x;
        n.y += w.y;
      }
    }
  });
}

/** Median of the non-negative values (0 when there are none), rounded to whole px. */
function medianGap(gaps: number[]): number {
  const g = gaps.filter((x) => x >= 0).sort((a, b) => a - b);
  if (!g.length) return 0;
  const m = g.length % 2 ? g[(g.length - 1) / 2] : (g[g.length / 2 - 1] + g[g.length / 2]) / 2;
  return Math.round(m);
}

/**
 * Tidy up (⌃⌥T), as pure geometry: boxes are sorted into rows (a box whose centre falls within a
 * row's height joins it), then into a grid whose columns are as wide as their widest box. Gaps
 * become the median of today's gaps. Returns each box's new top-left corner (world space).
 */
export function tidyLayout(items: { id: string; b: Box }[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!items.length) return out;
  const rows: { top: number; bottom: number; items: { id: string; b: Box }[] }[] = [];
  for (const it of [...items].sort((a, c) => a.b.y + a.b.h / 2 - (c.b.y + c.b.h / 2))) {
    const cy = it.b.y + it.b.h / 2;
    const row = rows.find((r) => cy >= r.top && cy <= r.bottom);
    if (row) {
      row.items.push(it);
      row.top = Math.min(row.top, it.b.y);
      row.bottom = Math.max(row.bottom, it.b.y + it.b.h);
    } else rows.push({ top: it.b.y, bottom: it.b.y + it.b.h, items: [it] });
  }
  rows.sort((a, c) => a.top - c.top);
  for (const r of rows) r.items.sort((a, c) => a.b.x - c.b.x);
  const cols = Math.max(...rows.map((r) => r.items.length));
  const colW = Array.from({ length: cols }, (_, j) => Math.max(0, ...rows.map((r) => r.items[j]?.b.w ?? 0)));
  const rowH = rows.map((r) => Math.max(...r.items.map((it) => it.b.h)));
  const hgap = medianGap(rows.flatMap((r) => r.items.slice(1).map((it, j) => it.b.x - (r.items[j].b.x + r.items[j].b.w))));
  const vgap = medianGap(rows.slice(1).map((r, i) => r.top - rows[i].bottom));
  const x0 = Math.min(...items.map((it) => it.b.x));
  const y0 = Math.min(...items.map((it) => it.b.y));
  let y = y0;
  rows.forEach((r, i) => {
    let x = x0;
    r.items.forEach((it, j) => {
      out.set(it.id, { x: Math.round(x), y: Math.round(y) });
      x += colW[j] + hgap;
    });
    y += rowH[i] + vgap;
  });
  return out;
}

/** ⌃⌥T: tidy the selection into an evenly spaced grid. Layers placed by auto layout stay with the flow. */
export function tidyUp(ids: string[]): number {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked && !inFlow(doc, doc.nodes[id]));
  if (tops.length < 2) return 0;
  const boxes = tops.map((id) => ({ id, b: worldBounds(doc, id) }));
  const spots = tidyLayout(boxes);
  studio().mutate((d) => {
    for (const { id, b } of boxes) {
      const to = spots.get(id)!;
      moveWorld(d, id, to.x - b.x, to.y - b.y);
    }
  });
  return tops.length;
}

/** Move a layer by a world-space delta (mutates a draft), whatever its parent's rotation. */
function moveWorld(d: Doc, id: string, dx: number, dy: number) {
  if (!dx && !dy) return;
  const n = d.nodes[id];
  const pInv = n.parentId ? invert(worldMatrix(d, n.parentId)) : null;
  if (!pInv) {
    n.x = Math.round(n.x + dx);
    n.y = Math.round(n.y + dy);
    return;
  }
  const a = apply(pInv, { x: 0, y: 0 });
  const c = apply(pInv, { x: dx, y: dy });
  n.x = Math.round(n.x + c.x - a.x);
  n.y = Math.round(n.y + c.y - a.y);
}
