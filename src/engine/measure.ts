import type { Box, Pt } from "@/doc/geometry";

/*
 * ⌥ measure (Figma: select, hold ⌥, hover another layer): red distance lines with value pills
 * between the selection and the hovered layer, or its parent. Pure geometry in world units.
 */

/** A distance along one axis: the segment from `from` to `to`, drawn at `at` on the other axis. */
export interface MeasureLine {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  /** Length in world px (always > 0). */
  value: number;
}

export interface Measurement {
  lines: MeasureLine[];
  /** Dashed lines that carry the target's edge out to a distance line it doesn't reach. */
  extensions: [Pt, Pt][];
}

const EPS = 1e-6;
const right = (b: Box) => b.x + b.w;
const bottom = (b: Box) => b.y + b.h;
const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - EPS && inner.y >= outer.y - EPS && right(inner) <= right(outer) + EPS && bottom(inner) <= bottom(outer) + EPS;

function line(axis: "x" | "y", at: number, a: number, b: number): MeasureLine | null {
  const from = Math.min(a, b), to = Math.max(a, b);
  return to - from > EPS ? { axis, at, from, to, value: to - from } : null;
}

/** Distances from each edge of `inner` out to the same edge of `outer`. */
function inside(inner: Box, outer: Box): MeasureLine[] {
  const cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2;
  return [
    line("x", cy, outer.x, inner.x),
    line("x", cy, right(inner), right(outer)),
    line("y", cx, outer.y, inner.y),
    line("y", cx, bottom(inner), bottom(outer)),
  ].filter((l): l is MeasureLine => !!l);
}

/**
 * How far `sel` (the selection) is from `target` (the hovered layer):
 * - one holds the other: the four edge-to-edge distances, drawn through the inner box's centre;
 * - apart on an axis: the gap, drawn through the middle of what they share on the other axis, or
 *   from the selection's centre with a dashed extension of the target's edge when they share nothing;
 * - overlapping: the differences between their matching edges.
 */
export function measureBetween(sel: Box, target: Box): Measurement {
  if (contains(target, sel)) return { lines: inside(sel, target), extensions: [] };
  if (contains(sel, target)) return { lines: inside(target, sel), extensions: [] };

  const lines: MeasureLine[] = [];
  const extensions: [Pt, Pt][] = [];
  const ox0 = Math.max(sel.x, target.x), ox1 = Math.min(right(sel), right(target));
  const oy0 = Math.max(sel.y, target.y), oy1 = Math.min(bottom(sel), bottom(target));
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
  const apartX = right(sel) <= target.x || right(target) <= sel.x;
  const apartY = bottom(sel) <= target.y || bottom(target) <= sel.y;

  if (apartX) {
    const leftOf = right(sel) <= target.x;
    const a = leftOf ? right(sel) : sel.x;
    const edge = leftOf ? target.x : right(target);
    const at = oy1 > oy0 ? (oy0 + oy1) / 2 : cy;
    const l = line("x", at, a, edge);
    if (l) lines.push(l);
    if (oy1 <= oy0) extensions.push([{ x: edge, y: at < target.y ? target.y : bottom(target) }, { x: edge, y: at }]);
  }
  if (apartY) {
    const above = bottom(sel) <= target.y;
    const a = above ? bottom(sel) : sel.y;
    const edge = above ? target.y : bottom(target);
    const at = ox1 > ox0 ? (ox0 + ox1) / 2 : cx;
    const l = line("y", at, a, edge);
    if (l) lines.push(l);
    if (ox1 <= ox0) extensions.push([{ x: at < target.x ? target.x : right(target), y: edge }, { x: at, y: edge }]);
  }
  if (!apartX && !apartY) {
    // Overlapping: how far each edge is from its partner, through the shared area.
    const my = (oy0 + oy1) / 2, mx = (ox0 + ox1) / 2;
    for (const l of [line("x", my, sel.x, target.x), line("x", my, right(sel), right(target)), line("y", mx, sel.y, target.y), line("y", mx, bottom(sel), bottom(target))]) {
      if (l) lines.push(l);
    }
  }
  return { lines, extensions };
}
