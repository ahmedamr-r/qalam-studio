/**
 * SVG path data, checked in code before anything draws it. The model writes a path's `d`; this
 * parses it (every command, absolute and relative, arcs included), refuses what isn't a path or is
 * too big, and normalises it to absolute moves, lines and cubics, so bounds are exact and the
 * renderer gets one simple form.
 */

export type Seg =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | { c: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: "Z" };

export interface ParsedPath {
  segs: Seg[];
  error?: string;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** More segments than this isn't artwork a screen needs; bigger coordinates aren't on a screen. */
export const PATH_LIMITS = { segments: 300, coord: 4096 } as const;

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Read the path's commands with their numbers; arc flags may be written without separators ("a1 1 0 01.5.5"). */
function tokenize(d: string): { cmd: string; args: number[] }[] | string {
  const out: { cmd: string; args: number[] }[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = (): number | null => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 64));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number | null => {
    skip();
    if (d[i] === "0" || d[i] === "1") return Number(d[i++]);
    return null;
  };
  let cmd = "";
  while (true) {
    skip();
    if (i >= d.length) break;
    const ch = d[i];
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toUpperCase() in ARGS)) return `"${ch}" isn't a path command`;
      cmd = ch;
      i++;
    } else if (!cmd) return "a path starts with a move (M)";
    else if (cmd.toUpperCase() === "Z") return `unexpected "${ch}" after Z`;
    const up = cmd.toUpperCase();
    const n = ARGS[up];
    if (!n) {
      out.push({ cmd, args: [] });
      continue;
    }
    // A command's numbers can repeat ("L1 2 3 4" is two lines); a move's extra pairs are lines.
    let first = true;
    while (true) {
      skip();
      if (!first && (i >= d.length || /[a-zA-Z]/.test(d[i]))) break;
      const args: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = up === "A" && (k === 3 || k === 4) ? flag() : number();
        if (v === null) return i >= d.length ? `"${cmd}" needs ${n} numbers` : `unexpected "${d[i]}" in "${cmd}"`;
        args.push(v);
      }
      out.push({ cmd: first ? cmd : cmd === "M" ? "L" : cmd === "m" ? "l" : cmd, args });
      first = false;
    }
  }
  return out;
}

/** An elliptical arc as cubics (SVG implementation notes, F.6), at most 90° each. */
function arcToCubics(x0: number, y0: number, rx: number, ry: number, angle: number, large: number, sweep: number, x: number, y: number): Seg[] {
  if (x0 === x && y0 === y) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [{ c: "L", x, y }];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi),
    sin = Math.sin(phi);
  const dx = (x0 - x) / 2,
    dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy,
    y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry,
    cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2,
    cy = sin * cx1 + cos * cy1 + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number) => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    dx: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    dy: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });
  const out: Seg[] = [];
  for (let s = 0; s < n; s++) {
    const a = at(t1 + s * step),
      b = at(t1 + (s + 1) * step);
    const end = s === n - 1 ? { x, y } : { x: b.x, y: b.y };
    out.push({ c: "C", x1: a.x + k * a.dx, y1: a.y + k * a.dy, x2: b.x - k * b.dx, y2: b.y - k * b.dy, x: end.x, y: end.y });
  }
  return out;
}

/** Parse path data into absolute moves, lines and cubics, or say what's wrong with it. */
export function parsePath(d: string): ParsedPath {
  if (typeof d !== "string" || !d.trim()) return { segs: [], error: "the path is empty" };
  const tokens = tokenize(d);
  if (typeof tokens === "string") return { segs: [], error: tokens };
  if (tokens[0]?.cmd.toUpperCase() !== "M") return { segs: [], error: "a path starts with a move (M)" };
  const segs: Seg[] = [];
  let cx = 0,
    cy = 0,
    sx = 0,
    sy = 0;
  // The last control point, for the smooth commands (S reflects a cubic's, T a quadratic's).
  type Pt = { x: number; y: number } | null;
  let lastC: Pt = null;
  let lastQ: Pt = null;
  const quad = (qx: number, qy: number, x: number, y: number): Seg => ({ c: "C", x1: cx + (2 / 3) * (qx - cx), y1: cy + (2 / 3) * (qy - cy), x2: x + (2 / 3) * (qx - x), y2: y + (2 / 3) * (qy - y), x, y });
  for (const { cmd, args: a } of tokens) {
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0,
      oy = rel ? cy : 0;
    const up = cmd.toUpperCase();
    let nextC: Pt = null;
    let nextQ: Pt = null;
    switch (up) {
      case "M":
        cx = sx = ox + a[0];
        cy = sy = oy + a[1];
        segs.push({ c: "M", x: cx, y: cy });
        break;
      case "L":
        cx = ox + a[0];
        cy = oy + a[1];
        segs.push({ c: "L", x: cx, y: cy });
        break;
      case "H":
        cx = ox + a[0];
        segs.push({ c: "L", x: cx, y: cy });
        break;
      case "V":
        cy = oy + a[0];
        segs.push({ c: "L", x: cx, y: cy });
        break;
      case "C": {
        const s: Seg = { c: "C", x1: ox + a[0], y1: oy + a[1], x2: ox + a[2], y2: oy + a[3], x: ox + a[4], y: oy + a[5] };
        segs.push(s);
        nextC = { x: s.x2, y: s.y2 };
        cx = s.x;
        cy = s.y;
        break;
      }
      case "S": {
        const c: Pt = lastC;
        const x1: number = c ? 2 * cx - c.x : cx,
          y1: number = c ? 2 * cy - c.y : cy;
        const s: Seg = { c: "C", x1, y1, x2: ox + a[0], y2: oy + a[1], x: ox + a[2], y: oy + a[3] };
        segs.push(s);
        nextC = { x: s.x2, y: s.y2 };
        cx = s.x;
        cy = s.y;
        break;
      }
      case "Q": {
        const qx = ox + a[0],
          qy = oy + a[1],
          x = ox + a[2],
          y = oy + a[3];
        segs.push(quad(qx, qy, x, y));
        nextQ = { x: qx, y: qy };
        cx = x;
        cy = y;
        break;
      }
      case "T": {
        const q: Pt = lastQ;
        const qx: number = q ? 2 * cx - q.x : cx,
          qy: number = q ? 2 * cy - q.y : cy;
        const x = ox + a[0],
          y = oy + a[1];
        segs.push(quad(qx, qy, x, y));
        nextQ = { x: qx, y: qy };
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        const x = ox + a[5],
          y = oy + a[6];
        segs.push(...arcToCubics(cx, cy, a[0], a[1], a[2], a[3], a[4], x, y));
        cx = x;
        cy = y;
        break;
      }
      case "Z":
        segs.push({ c: "Z" });
        cx = sx;
        cy = sy;
        break;
    }
    lastC = nextC;
    lastQ = nextQ;
    if (segs.length > PATH_LIMITS.segments) return { segs: [], error: `more than ${PATH_LIMITS.segments} segments` };
  }
  for (const s of segs) {
    if (s.c === "Z") continue;
    const vals = s.c === "C" ? [s.x1, s.y1, s.x2, s.y2, s.x, s.y] : [s.x, s.y];
    if (vals.some((v) => !Number.isFinite(v) || Math.abs(v) > PATH_LIMITS.coord)) return { segs: [], error: `a coordinate is out of range (±${PATH_LIMITS.coord})` };
  }
  if (!segs.some((s) => s.c !== "M" && s.c !== "Z")) return { segs: [], error: "the path draws nothing" };
  return { segs };
}

/** Where a cubic's coordinate on one axis turns (0 < t < 1). */
function turns(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3,
    b = 2 * (p0 - 2 * p1 + p2),
    c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      ts.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** The exact box the path covers (curves by their extremes, not their control points). */
export function pathBounds(segs: Seg[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let cx = 0,
    cy = 0;
  for (const s of segs) {
    if (s.c === "Z") continue;
    if (s.c === "C") {
      for (const t of turns(cx, s.x1, s.x2, s.x)) add(cubicAt(cx, s.x1, s.x2, s.x, t), cubicAt(cy, s.y1, s.y2, s.y, t));
      for (const t of turns(cy, s.y1, s.y2, s.y)) add(cubicAt(cx, s.x1, s.x2, s.x, t), cubicAt(cy, s.y1, s.y2, s.y, t));
    }
    add(s.x, s.y);
    cx = s.x;
    cy = s.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Move a path by dx, dy. */
export function translatePath(segs: Seg[], dx: number, dy: number): Seg[] {
  return segs.map((s) => (s.c === "Z" ? s : s.c === "C" ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, x: s.x + dx, y: s.y + dy } : { ...s, x: s.x + dx, y: s.y + dy }));
}

const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Path data for the normalised segments. */
export function toD(segs: Seg[]): string {
  return segs.map((s) => (s.c === "Z" ? "Z" : s.c === "C" ? `C${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)}` : `${s.c}${num(s.x)} ${num(s.y)}`)).join("");
}
