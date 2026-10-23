import type { Pt } from "@/doc/geometry";

/*
 * Rotation handles: the ring just outside each corner of the selection box. Dragging there turns
 * the selection around its centre; ⇧ snaps to 15° steps. Pure geometry in screen or world units.
 */

/** Rotation zone, measured from a corner (screen px): inside the resize handle's reach it resizes. */
export const ROTATE_INNER = 7;
export const ROTATE_OUTER = 20;

/** Direction from `c` to `p`, in degrees clockwise from +x (screen space, y down). */
export const angleOf = (c: Pt, p: Pt) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;

/** An angle in (-180, 180], rounded to 2 decimals, without -0. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  const r = Math.round(d * 100) / 100;
  return Object.is(r, -0) || r === 0 ? 0 : r === -180 ? 180 : r;
}

/** Snap an angle to the nearest multiple of `step` degrees. */
export const snapAngle = (deg: number, step = 15) => normalizeDeg(Math.round(deg / step) * step);

/** `p` turned `deg` degrees clockwise around `c`. */
export function rotateAround(p: Pt, c: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Is `p` inside the convex polygon `poly` (any winding)? */
export function insidePolygon(poly: Pt[], p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/**
 * The corner (index into `corners`, the box's four corners in order) whose rotation zone holds
 * `p`: outside the box, beyond the resize handle and within `ROTATE_OUTER` of the corner.
 */
export function rotationCornerAt(corners: Pt[], p: Pt, inner = ROTATE_INNER, outer = ROTATE_OUTER): number | null {
  if (corners.length !== 4 || insidePolygon(corners, p)) return null;
  let best: { i: number; d: number } | null = null;
  corners.forEach((c, i) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d > inner && d <= outer && (!best || d < best.d)) best = { i, d };
  });
  return best ? (best as { i: number }).i : null;
}

/**
 * The turn a rotate drag has made: from the angle at the press to the angle now, around `center`,
 * snapped so the layer's own angle (`base` + turn) lands on 15° steps when `snap` is on.
 */
export function rotationDelta(center: Pt, start: Pt, now: Pt, base: number, snap: boolean): number {
  let delta = angleOf(center, now) - angleOf(center, start);
  if (snap) delta = snapAngle(base + delta) - base;
  return normalizeDeg(delta);
}
