import type { ElementBox } from "@/ai/ds-schemas";
import { measureElement, toLogical, type Capture, type Measured } from "./pixels";

/**
 * Reading component structure in the pixels of the screenshots the model pointed at: whether the
 * tab bar floats or is docked, which tabs carry labels, the shape marking the active tab, where the
 * title sits and how big it is, the selected-tab marker, and how list rows and tiles are built.
 * Every detector returns only what the pixels show clearly; anything unclear is left out and the
 * model's answer stands (see structure.ts).
 */

type RGB = [number, number, number];
interface Rect {
  L: number;
  T: number;
  R: number;
  B: number;
}

export interface NavEvidence {
  /** Logical px from the image's left and right edges to the bar. */
  insetStart: number;
  insetEnd: number;
  width: number;
  height: number;
  radius: number;
  pill: boolean;
  fill: string;
  logicalWidth: number;
  /** Which tab columns carry a second line of ink (a label) under the icon. */
  labels?: "all" | "active" | "none";
}

export interface MarkEvidence {
  w: number;
  h: number;
  radius: number;
  pill: boolean;
  fill: string;
}

export interface TitleEvidence {
  /** Ink bounds in logical px. */
  x: number;
  w: number;
  inkH: number;
  logicalWidth: number;
}

export interface ListEvidence {
  rows: number;
  /** Each row's height as the model boxed it (top to just above the next row), logical px. */
  heights: number[];
  /** Per row, what each detector saw (undefined = unclear). */
  leading: ("contained" | "bare" | undefined)[];
  leadingBox?: MarkEvidence;
  divider: ("none" | "full" | "inset" | undefined)[];
  chevron: ("shown" | "hidden" | undefined)[];
}

export interface StructureEvidence {
  nav?: NavEvidence;
  navActive?: MarkEvidence;
  title?: TitleEvidence;
  tabsActive?: MarkEvidence;
  list?: ListEvidence;
  tile?: ("card" | "bare" | undefined)[];
}

// ---------------------------------------------------------------------------
// Pixel helpers (image px unless noted)

function rectOf(img: ImageData, box: number[]): Rect | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [x0, y0, x1, y1] = box.map((v) => Math.min(1, Math.max(0, Number(v) || 0)));
  const r = { L: Math.floor(Math.min(x0, x1) * img.width), T: Math.floor(Math.min(y0, y1) * img.height), R: Math.ceil(Math.max(x0, x1) * img.width) - 1, B: Math.ceil(Math.max(y0, y1) * img.height) - 1 };
  return r.R - r.L >= 2 && r.B - r.T >= 2 ? r : null;
}

const px = (img: ImageData, x: number, y: number): RGB => {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
const dist = (a: RGB, b: RGB) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** The most common colour in a rectangle (4-bit buckets) and its share of the samples. */
function dominant(img: ImageData, r: Rect): { color: RGB; share: number } | null {
  const buckets = new Map<number, { s: RGB; n: number }>();
  let total = 0;
  const step = Math.max(1, Math.floor(((r.R - r.L + 1) * (r.B - r.T + 1)) / 20000));
  for (let y = Math.max(0, r.T); y <= Math.min(img.height - 1, r.B); y += step)
    for (let x = Math.max(0, r.L); x <= Math.min(img.width - 1, r.R); x += step) {
      const c = px(img, x, y);
      const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const e = buckets.get(k) ?? { s: [0, 0, 0] as RGB, n: 0 };
      e.s = [e.s[0] + c[0], e.s[1] + c[1], e.s[2] + c[2]];
      e.n++;
      total++;
      buckets.set(k, e);
    }
  let best: { s: RGB; n: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best && total ? { color: [best.s[0] / best.n, best.s[1] / best.n, best.s[2] / best.n], share: best.n / total } : null;
}

/** The most common colour on a thin ring just outside a rectangle: what it sits on. */
function around(img: ImageData, r: Rect, gap: number): RGB | null {
  const L = Math.max(0, r.L - gap),
    T = Math.max(0, r.T - gap),
    R = Math.min(img.width - 1, r.R + gap),
    B = Math.min(img.height - 1, r.B + gap);
  const counts = new Map<number, { c: RGB; n: number }>();
  const add = (x: number, y: number) => {
    const c = px(img, x, y);
    const k = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
    const e = counts.get(k) ?? { c, n: 0 };
    e.n++;
    counts.set(k, e);
  };
  for (let x = L; x <= R; x++) {
    if (T < r.T) add(x, T);
    if (B > r.B) add(x, B);
  }
  for (let y = T; y <= B; y++) {
    if (L < r.L) add(L, y);
    if (R > r.R) add(R, y);
  }
  let best: { c: RGB; n: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best?.c ?? null;
}

/** Tight bounds of the pixels in a rectangle that differ from `bg` by more than `thr`. */
function inkBox(img: ImageData, r: Rect, bg: RGB, thr = 48): Rect | null {
  let L = Infinity,
    T = Infinity,
    R = -1,
    B = -1;
  for (let y = Math.max(0, r.T); y <= Math.min(img.height - 1, r.B); y++)
    for (let x = Math.max(0, r.L); x <= Math.min(img.width - 1, r.R); x++)
      if (dist(px(img, x, y), bg) > thr) {
        if (x < L) L = x;
        if (x > R) R = x;
        if (y < T) T = y;
        if (y > B) B = y;
      }
  return R < 0 ? null : { L, T, R, B };
}

/** Runs of indices where `on` holds, merged across gaps shorter than `gap`. */
function runs(n: number, on: (i: number) => boolean, gap: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!on(i)) continue;
    const last = out[out.length - 1];
    if (last && i - last[1] <= gap) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

const markOf = (m: Measured): MarkEvidence => ({ w: m.w, h: m.h, radius: m.radius, pill: m.pill, fill: m.fill });

// ---------------------------------------------------------------------------
// Detectors

/**
 * The tab bar: its measured box (flood fill of its colour) gives the insets from the screen edges
 * and its corners; within it, the tab columns (clusters of ink across x) and how many lines of ink
 * each has (icon only, or icon and label).
 */
export function measureNav(img: ImageData, box: number[], cap: Capture): NavEvidence | null {
  const f = toLogical(cap);
  const imgW = img.width * f;
  const m = measureElement(img, box, f);
  let out: NavEvidence;
  let bar: Rect;
  if (m) {
    out = { insetStart: m.x, insetEnd: imgW - (m.x + m.w), width: m.w, height: m.h, radius: m.radius, pill: m.pill, fill: m.fill, logicalWidth: imgW };
    bar = { L: Math.round(m.x / f), T: Math.round(m.y / f), R: Math.round((m.x + m.w) / f) - 1, B: Math.round((m.y + m.h) / f) - 1 };
  } else {
    // A bar docked to the bottom edge has no corners to read: it's docked when its colour reaches
    // both edges of the screen across its middle rows.
    const r = rectOf(img, box);
    const dom = r && dominant(img, r);
    if (!r || !dom || dom.share < 0.5) return null;
    const mid = [0.35, 0.5, 0.65].map((k) => Math.round(r.T + (r.B - r.T) * k));
    const reaches = (x: number) => mid.every((y) => dist(px(img, x, y), dom.color) <= 6);
    if (!reaches(0) || !reaches(img.width - 1)) return null;
    out = { insetStart: 0, insetEnd: 0, width: imgW, height: (r.B - r.T + 1) * f, radius: 0, pill: false, fill: hex(dom.color), logicalWidth: imgW };
    bar = { L: 0, T: r.T, R: img.width - 1, B: r.B };
  }
  const bg = dominant(img, bar)?.color;
  if (!bg) return out;
  // Stay clear of the bar's rounded ends and edges.
  const end = Math.round(Math.min(out.radius, out.height / 2) / f / 2);
  const inner: Rect = { L: bar.L + end, T: bar.T + 2, R: bar.R - end, B: bar.B - 2 };
  const colInk = (x: number) => {
    for (let y = inner.T; y <= inner.B; y++) if (dist(px(img, x, y), bg) > 48) return true;
    return false;
  };
  const cols = runs(inner.R - inner.L + 1, (i) => colInk(inner.L + i), Math.max(2, Math.round(10 / f))).filter(([a, b]) => (b - a + 1) * f >= 8);
  if (cols.length < 2 || cols.length > 6) return out;
  const bands = cols.map(([a, b]) => {
    const rowInk = (y: number) => {
      for (let x = inner.L + a; x <= inner.L + b; x++) if (dist(px(img, x, y), bg) > 48) return true;
      return false;
    };
    return runs(inner.B - inner.T + 1, (i) => rowInk(inner.T + i), Math.max(1, Math.round(2 / f))).filter(([s, e]) => (e - s + 1) * f >= 3).length;
  });
  const two = bands.filter((n) => n >= 2).length;
  if (bands.every((n) => n === 1)) out.labels = "none";
  else if (two === bands.length) out.labels = "all";
  else if (two === 1) out.labels = "active";
  return out;
}

/** A shape marking the active tab or selected tab: its measured size, corners and fill. */
export function measureMark(img: ImageData, box: number[], cap: Capture): MarkEvidence | null {
  const f = toLogical(cap);
  const m = measureElement(img, box, f);
  if (m) return markOf(m);
  // A thin underline: too thin to flood fill reliably; its ink box is enough.
  const r = rectOf(img, box);
  const bg = r && around(img, r, 3);
  const ink = r && bg ? inkBox(img, r, bg, 40) : null;
  if (!ink) return null;
  const c = dominant(img, ink);
  return { w: (ink.R - ink.L + 1) * f, h: (ink.B - ink.T + 1) * f, radius: 0, pill: false, fill: c ? hex(c.color) : "" };
}

/** The screen title: the bounds of its ink against what it sits on. */
export function measureTitle(img: ImageData, box: number[], cap: Capture): TitleEvidence | null {
  const f = toLogical(cap);
  const r = rectOf(img, box);
  const bg = r && around(img, r, 3);
  const ink = r && bg ? inkBox(img, r, bg) : null;
  if (!ink) return null;
  return { x: ink.L * f, w: (ink.R - ink.L + 1) * f, inkH: (ink.B - ink.T + 1) * f, logicalWidth: img.width * f };
}

/**
 * One list row: whether its leading icon sits in a filled shape, whether a line runs under it and
 * where the line starts, and whether it ends in a small glyph (a chevron) at either end.
 */
export function measureListRow(img: ImageData, row: number[], leading: number[] | undefined, cap: Capture): { leading?: "contained" | "bare"; leadingBox?: MarkEvidence; divider?: "none" | "full" | "inset"; chevron?: "shown" | "hidden" } {
  const f = toLogical(cap);
  const r = rectOf(img, row);
  if (!r) return {};
  const bg = dominant(img, r)?.color;
  if (!bg) return {};
  const out: ReturnType<typeof measureListRow> = {};

  if (leading) {
    const lr = rectOf(img, leading);
    const inside = lr && dominant(img, lr);
    if (lr && inside) {
      if (dist(inside.color, bg) <= 6) out.leading = "bare";
      else {
        const m = measureElement(img, leading, f);
        if (m && m.w >= 20 && m.w <= 72 && m.h >= 20 && m.h <= 72 && Math.abs(m.w - m.h) <= Math.max(4, m.w * 0.2)) {
          out.leading = "contained";
          out.leadingBox = markOf(m);
        }
      }
    }
  }

  // A divider: a line of 1–3 px just above the next row, across most of the row.
  const width = r.R - r.L + 1;
  const lo = Math.max(r.T, r.B - Math.round(8 / f)),
    hi = Math.min(img.height - 1, r.B + Math.round(3 / f));
  let found: number | null = null;
  for (let y = lo; y <= hi && found === null; y++) {
    const on = runs(width, (i) => dist(px(img, r.L + i, y), bg) > 8, 1);
    const longest = on.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
    if (longest && longest[1] - longest[0] + 1 >= width * 0.55) {
      // A line, not the next row's content: thin.
      const thick = (y2: number) => y2 <= hi && runs(width, (i) => dist(px(img, r.L + i, y2), bg) > 8, 1).some(([a, b]) => b - a + 1 >= width * 0.55);
      if (!thick(y + Math.round(4 / f))) found = longest[0] * f;
    }
  }
  const lineStart = found;
  out.divider = lineStart === null ? "none" : lineStart <= 4 ? "full" : lineStart >= 24 ? "inset" : undefined;

  // A chevron: a small, narrow glyph in the last 44px at either end of the row.
  const end = Math.round(44 / f);
  const glyph = (a: Rect) => {
    const ink = inkBox(img, a, bg);
    if (!ink) return false;
    const w = (ink.R - ink.L + 1) * f,
      h = (ink.B - ink.T + 1) * f;
    return w <= 14 && h >= 6 && h <= 20;
  };
  const right: Rect = { L: Math.max(r.L, r.R - end), T: r.T + 2, R: r.R, B: r.B - Math.round(6 / f) };
  const left: Rect = { L: r.L, T: r.T + 2, R: Math.min(r.R, r.L + end), B: r.B - Math.round(6 / f) };
  out.chevron = glyph(right) || glyph(left) ? "shown" : "hidden";
  return out;
}

/** A service tile: a filled card, or the page showing through (bare). */
export function measureTile(img: ImageData, box: number[]): "card" | "bare" | undefined {
  const r = rectOf(img, box);
  const inside = r && dominant(img, r);
  const bg = r && around(img, r, 4);
  if (!inside || !bg || inside.share < 0.35) return undefined;
  return dist(inside.color, bg) <= 6 ? "bare" : dist(inside.color, bg) >= 10 ? "card" : undefined;
}

/**
 * Everything the elements the model pointed at say about structure. List rows pair each row with
 * the leading box inside it.
 */
export function measureStructure(elements: ElementBox[] | undefined, images: ImageData[], captures: Capture[]): StructureEvidence {
  const ev: StructureEvidence = {};
  if (!Array.isArray(elements) || !images.length) return ev;
  const imgOf = (e: ElementBox) => Math.max(0, Math.min(images.length - 1, Math.round(Number(e?.image) || 1) - 1));
  const of = (kind: string) => elements.filter((e) => e?.kind === kind).slice(0, 6);
  const first = <T,>(kind: string, fn: (img: ImageData, box: number[], cap: Capture) => T | null): T | undefined => {
    for (const e of of(kind)) {
      const i = imgOf(e);
      if (!captures[i]) continue;
      const r = fn(images[i], e.bbox, captures[i]);
      if (r) return r;
    }
    return undefined;
  };
  ev.nav = first("nav-bar", measureNav);
  ev.navActive = first("nav-active", measureMark);
  ev.title = first("top-bar-title", measureTitle);
  ev.tabsActive = first("tabs-active", measureMark);
  const rows = of("list-item");
  const leads = of("list-leading");
  if (rows.length) {
    const list: ListEvidence = { rows: 0, heights: [], leading: [], divider: [], chevron: [] };
    for (const row of rows) {
      const i = imgOf(row);
      if (!captures[i]) continue;
      const [x0, y0, x1, y1] = row.bbox;
      const lead = leads.find((l) => imgOf(l) === i && l.bbox[1] >= y0 - 0.01 && l.bbox[3] <= y1 + 0.01 && l.bbox[0] >= Math.min(x0, x1) - 0.01 && l.bbox[2] <= Math.max(x0, x1) + 0.01);
      const r = measureListRow(images[i], row.bbox, lead?.bbox, captures[i]);
      list.rows++;
      list.heights.push(Math.abs(y1 - y0) * images[i].height * toLogical(captures[i]));
      list.leading.push(r.leading);
      list.divider.push(r.divider);
      list.chevron.push(r.chevron);
      if (r.leadingBox && !list.leadingBox) list.leadingBox = r.leadingBox;
    }
    if (list.rows) ev.list = list;
  }
  const tiles = of("tile").map((e) => measureTile(images[imgOf(e)], e.bbox));
  if (tiles.length) ev.tile = tiles;
  return ev;
}
