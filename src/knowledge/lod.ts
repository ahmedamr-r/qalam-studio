/**
 * Which labels the graph shows at a zoom, and keyboard walking between nodes (pure). Labels must
 * never overlap: the selected, hovered and traced nodes are labelled first, then the facts doing
 * the most work, while room is left on screen.
 */

export interface View {
  /** Screen = world × k + (x, y). */
  x: number;
  y: number;
  k: number;
}

export interface LabelItem {
  ref: string;
  x: number;
  y: number;
  r: number;
  label: string;
  /** Higher first (usage, or a group's weight). */
  weight: number;
}

const CHAR_W = 6.2;
const LABEL_H = 15;

/** Screen rectangle of a node's label, to the right of its dot. */
export function labelRect(it: LabelItem, v: View): { x: number; y: number; w: number; h: number } {
  const sx = it.x * v.k + v.x;
  const sy = it.y * v.k + v.y;
  const w = Math.min(it.label.length, 40) * CHAR_W + 8;
  return { x: sx + it.r * v.k + 4, y: sy - LABEL_H / 2, w, h: LABEL_H };
}

/**
 * Labels to draw: `must` first (always, even when they collide), then by weight while the label
 * fits on screen without touching another. The budget grows with the zoom.
 */
export function pickLabels(items: LabelItem[], v: View, size: { w: number; h: number }, must: ReadonlySet<string>, budget = Math.round(18 + 30 * v.k)): Set<string> {
  const out = new Set<string>();
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const hit = (a: (typeof taken)[number]) => taken.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  for (const it of items)
    if (must.has(it.ref)) {
      out.add(it.ref);
      taken.push(labelRect(it, v));
    }
  const rest = items.filter((it) => !must.has(it.ref)).sort((a, b) => b.weight - a.weight || (a.ref < b.ref ? -1 : 1));
  for (const it of rest) {
    if (out.size >= budget + must.size) break;
    const rc = labelRect(it, v);
    if (rc.x > size.w || rc.x + rc.w < 0 || rc.y > size.h || rc.y + rc.h < 0) continue;
    if (hit(rc)) continue;
    out.add(it.ref);
    taken.push(rc);
  }
  return out;
}

export type Direction = "up" | "down" | "left" | "right";

/** The nearest node in a direction (within a 45° cone first, else the half-plane), for arrow keys. */
export function nearestInDirection(from: { x: number; y: number }, items: { ref: string; x: number; y: number }[], dir: Direction, self?: string): string | null {
  const [ux, uy] = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
  let best: string | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (it.ref === self) continue;
    const dx = it.x - from.x;
    const dy = it.y - from.y;
    const along = dx * ux + dy * uy;
    if (along <= 0.5) continue;
    const across = Math.abs(dx * uy - dy * ux);
    // Off-axis distance counts double, and more outside the cone.
    const score = along + across * (across > along ? 4 : 2);
    if (score < bestScore) {
      bestScore = score;
      best = it.ref;
    }
  }
  return best;
}
