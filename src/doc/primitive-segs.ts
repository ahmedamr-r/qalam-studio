import type { Seg } from "@/design-system/svg-path";

/*
 * Outlines of the primitive shapes as path segments (absolute moves, lines and cubics). Pure, so
 * layout (composed shapes) and the vector tools share them without pulling in anything else.
 */

/** Cubic handle length for a quarter ellipse (the usual 4/3·(√2 − 1)). */
const K = 0.5522847498;

/** An ellipse in the box, clockwise from its right-most point (four cubics). */
export function ovalSegs(l: number, t: number, r: number, b: number): Seg[] {
  const cx = (l + r) / 2,
    cy = (t + b) / 2,
    rx = (r - l) / 2,
    ry = (b - t) / 2;
  const kx = rx * K,
    ky = ry * K;
  return [
    { c: "M", x: r, y: cy },
    { c: "C", x1: r, y1: cy + ky, x2: cx + kx, y2: b, x: cx, y: b },
    { c: "C", x1: cx - kx, y1: b, x2: l, y2: cy + ky, x: l, y: cy },
    { c: "C", x1: l, y1: cy - ky, x2: cx - kx, y2: t, x: cx, y: t },
    { c: "C", x1: cx + kx, y1: t, x2: r, y2: cy - ky, x: r, y: cy },
    { c: "Z" },
  ];
}

/**
 * A rounded rect, clockwise from the top-left corner's end. `radii` = [tl rx, tl ry, tr rx, tr ry,
 * br rx, br ry, bl rx, bl ry]; scaled down together when two corners overlap on a side, like Skia's RRect.
 */
export function rrectSegs(l: number, t: number, r: number, b: number, radii: number[]): Seg[] {
  const w = r - l,
    h = b - t;
  let [tlx, tly, trx, try_, brx, bry, blx, bly] = Array.from({ length: 8 }, (_, i) => Math.max(0, radii[i] || 0));
  const room = (side: number, a: number, b: number) => (a + b > side ? side / (a + b) : 1);
  const fit = Math.min(room(w, tlx, trx), room(w, blx, brx), room(h, tly, bly), room(h, try_, bry));
  if (fit < 1) [tlx, tly, trx, try_, brx, bry, blx, bly] = [tlx, tly, trx, try_, brx, bry, blx, bly].map((v) => v * fit);
  const segs: Seg[] = [{ c: "M", x: l + tlx, y: t }];
  const line = (x: number, y: number) => segs.push({ c: "L", x, y });
  /** A quarter from the current point to (x, y), bulging towards the corner (cx, cy). */
  const corner = (rx: number, ry: number, sx: number, sy: number, cx: number, cy: number, x: number, y: number) => {
    if (!rx || !ry) return line(cx, cy);
    segs.push({ c: "C", x1: sx + (cx - sx) * K, y1: sy + (cy - sy) * K, x2: x + (cx - x) * K, y2: y + (cy - y) * K, x, y });
  };
  line(r - trx, t);
  corner(trx, try_, r - trx, t, r, t, r, t + try_);
  line(r, b - bry);
  corner(brx, bry, r, b - bry, r, b, r - brx, b);
  line(l + blx, b);
  corner(blx, bly, l + blx, b, l, b, l, b - bly);
  line(l, t + tly);
  corner(tlx, tly, l, t + tly, l, t, l + tlx, t);
  segs.push({ c: "Z" });
  // Square corners leave zero-length lines behind.
  return segs.filter((s, i) => i === 0 || s.c !== "L" || !samePoint(segs[i - 1], s));
}

const samePoint = (a: Seg, b: Seg) => a.c !== "Z" && b.c !== "Z" && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
