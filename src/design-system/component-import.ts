import { differenceCiede2000, parse } from "culori";
import type { Inst } from "./builders";
import { CATALOG_BY_NAME, isReservedName } from "./components";
import { cleanProps, componentKey, patternFrom } from "./custom";
import { withProps } from "./component-props";
import type { ComponentDef, ComponentGuide, Pattern } from "./docs";
import type { TokenSet } from "./resolve";
import { measureText } from "@/doc/measure";
import type { SceneNode } from "@/doc/schema";

/**
 * A component read from a screenshot of just that component. Qalam AI composes it from catalog
 * parts in a design system's tokens; the studio measures what it can (the screenshot's colours
 * against the system's colour roles, how close the drawing comes to the screenshot) and keeps the
 * model's answer to what the catalog can draw.
 */

/** What the model answers (see COMPONENT_SCHEMA). */
export interface ComponentReading {
  read: string;
  /** "screen": the image is a whole screen or several different components. Build only. */
  scope?: "component" | "screen";
  name: string;
  purpose: string;
  /** The component's width at 1x, as the model judged it. */
  width: number;
  props: unknown;
  composition: Inst;
  guide: Partial<Pick<ComponentGuide, "whenToUse" | "whenNotToUse" | "content" | "placement" | "states" | "dos" | "donts">>;
  differences: { part: string; note: string }[];
}

/** Where the drawing can't match the screenshot (a colour, a font, an effect the system lacks). */
export interface Difference {
  part: string;
  note: string;
}

export interface CleanReading {
  def: ComponentDef;
  guide: ComponentReading["guide"];
  differences: Difference[];
  read: string;
  width: number;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const strs = (v: unknown, n = 8, len = 200) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);

/** Every part is a catalog component (a system's own components can't nest), at most five deep. */
export function catalogOnly(i: Inst | undefined, depth = 0): boolean {
  if (!i || typeof i !== "object" || depth > 4 || !CATALOG_BY_NAME.has(i.component)) return false;
  return (i.children ?? []).every((c) => catalogOnly(c, depth + 1));
}

/**
 * The name it joins the system under: the model's (the designer's, when the note gave one), never
 * a catalog component's, and not one the system already has (a number is added) unless `keep` is
 * that name (a revision replaces the component it revises).
 */
export function componentName(raw: string, taken: string[], opts: { systemName?: string; keep?: string } = {}): string {
  if (opts.keep) return opts.keep;
  let name = str(raw, 40).replace(/[^\p{L}\p{N} &'-]/gu, "").trim() || "Imported component";
  if (isReservedName(name)) name = str(`${opts.systemName ?? ""} ${name}`, 40).trim();
  if (isReservedName(name)) name = `${name} component`;
  const used = new Set(taken.map(componentKey));
  if (!used.has(componentKey(name))) return name;
  for (let n = 2; ; n++) if (!used.has(componentKey(`${name} ${n}`))) return `${name} ${n}`;
}

/**
 * The model's answer as a usable component, or why it can't be one: parts outside the catalog
 * (or a system's own component nested inside) can't be drawn, so they're refused rather than
 * silently dropped, which would change the design.
 */
export function cleanReading(raw: unknown, opts: { taken: string[]; systemName?: string; keep?: string }): CleanReading | { error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ComponentReading>;
  const composition = o.composition;
  if (!composition || typeof composition !== "object" || typeof composition.component !== "string") return { error: "Qalam AI didn't return a composition." };
  if (!catalogOnly(composition)) return { error: "The composition uses parts outside the component catalog." };
  const name = componentName(str(o.name, 60), opts.taken, opts);
  const def = withProps({ name, purpose: str(o.purpose, 300), props: cleanProps(o.props), composition: structuredClone(composition) });
  const g = (o.guide ?? {}) as ComponentReading["guide"];
  return {
    def,
    guide: {
      whenToUse: strs(g.whenToUse),
      whenNotToUse: strs(g.whenNotToUse),
      content: str(g.content, 600),
      placement: str(g.placement, 600),
      states: str(g.states, 600),
      dos: strs(g.dos),
      donts: strs(g.donts),
    },
    differences: (Array.isArray(o.differences) ? o.differences : [])
      .map((d) => ({ part: str(d?.part, 80), note: str(d?.note, 300) }))
      .filter((d) => d.note)
      .slice(0, 8),
    read: str(o.read, 500),
    width: Number(o.width) || 0,
  };
}

/** The component as one of a system's own: its guide from the reading, the screenshot kept as its reference. */
export function patternFromReading(r: Pick<CleanReading, "def" | "guide">, reference?: string): Pattern {
  const base = patternFrom(r.def);
  const g = r.guide;
  return {
    ...base,
    origin: "extraction",
    ...(reference ? { reference } : {}),
    guide: {
      ...base.guide,
      observed: true,
      whenToUse: g.whenToUse?.length ? g.whenToUse : base.guide.whenToUse,
      whenNotToUse: g.whenNotToUse ?? [],
      content: [g.content, base.guide.content].filter(Boolean).join("\n\n"),
      placement: g.placement ?? "",
      states: g.states ?? "",
      dos: g.dos ?? [],
      donts: g.donts ?? [],
    },
  };
}

// ---------------------------------------------------------------------------
// Measuring the screenshot

/** A measured colour and the system's closest colour role, by CIEDE2000. */
export interface RoleMatch {
  hex: string;
  role: string;
  roleHex: string;
  deltaE: number;
}

/** ΔE2000 under which two colours read as the same, and over which the system has nothing close. */
export const SAME_COLOUR = 3;
export const NO_CLOSE_COLOUR = 10;

/** The closest colour role (not a primitive or a recipe) for each measured colour. */
export function nearestRoles(palette: string[], ts: TokenSet): RoleMatch[] {
  const diff = differenceCiede2000();
  const roles = ts
    .semanticColors()
    .map((t) => ({ path: t.path, hex: String(t.value).slice(0, 7), c: parse(String(t.value).slice(0, 7)) }))
    .filter((r) => r.c);
  const out: RoleMatch[] = [];
  for (const hex of palette) {
    const c = parse(hex);
    if (!c) continue;
    let best: RoleMatch | null = null;
    for (const r of roles) {
      const d = diff(c, r.c!);
      if (!best || d < best.deltaE) best = { hex: hex.toUpperCase(), role: r.path, roleHex: r.hex.toUpperCase(), deltaE: Math.round(d * 10) / 10 };
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Colours the system has nothing close to, most area first, with near-duplicates (a gradient's
 * steps, anti-aliased edges) folded into the one already listed.
 */
export function missingColours(colours: RoleMatch[], max = 4): RoleMatch[] {
  const diff = differenceCiede2000();
  const out: RoleMatch[] = [];
  for (const c of colours) {
    const pc = parse(c.hex);
    if (c.deltaE <= NO_CLOSE_COLOUR || !pc || out.some((o) => diff(parse(o.hex)!, pc) < 15)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Snap the model's 1x width to what the screenshot can be: its content's width at 1x, 2x or 3x
 * (screenshots are taken at those scales). The model judges the scale from the text; the pixels
 * say which widths are possible.
 */
export function snapWidth(model: number, contentPx: number): { width: number; scale: number } {
  const candidates = [1, 2, 3].map((scale) => ({ scale, width: Math.round(contentPx / scale) })).filter((c) => c.width >= 24 && c.width <= 1440);
  if (!candidates.length) return { width: Math.max(24, Math.min(1440, Math.round(model) || 358)), scale: 1 };
  if (!(model > 0)) return candidates.find((c) => c.scale === 2) ?? candidates[0];
  return candidates.reduce((a, b) => (Math.abs(Math.log(b.width / model)) < Math.abs(Math.log(a.width / model)) ? b : a));
}

// ---------------------------------------------------------------------------
// How close the drawing is to the screenshot

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

type RGB = [number, number, number];

/** The screenshot's background: the commonest colour along its edges. */
export function edgeColor(img: Pixels): RGB {
  const { width: W, height: H, data: d } = img;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const add = (x: number, y: number) => {
    const o = (y * W + x) * 4;
    if (d[o + 3] < 128) return;
    const k = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
    const e = buckets.get(k) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += d[o];
    e.g += d[o + 1];
    e.b += d[o + 2];
    e.n++;
    buckets.set(k, e);
  };
  const sx = Math.max(1, Math.floor(W / 200)),
    sy = Math.max(1, Math.floor(H / 200));
  for (let x = 0; x < W; x += sx) (add(x, 0), add(x, H - 1));
  for (let y = 0; y < H; y += sy) (add(0, y), add(W - 1, y));
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}

/** A pixel over `bg` (transparent parts of a render show the screenshot's background). */
function px(img: Pixels, x: number, y: number, bg: RGB): RGB {
  const o = (y * img.width + x) * 4;
  const a = img.data[o + 3] / 255;
  return [img.data[o] * a + bg[0] * (1 - a), img.data[o + 1] * a + bg[1] * (1 - a), img.data[o + 2] * a + bg[2] * (1 - a)];
}

/** The box of what isn't background (margins around a cropped component trimmed). */
export function contentBox(img: Pixels, bg: RGB, tolerance = 24): { x: number; y: number; w: number; h: number } {
  const { width: W, height: H } = img;
  const differs = (x: number, y: number) => {
    const c = px(img, x, y, bg);
    return Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > tolerance;
  };
  const step = Math.max(1, Math.floor(Math.max(W, H) / 400));
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step)
      if (differs(x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < x0 || y1 < y0) return { x: 0, y: 0, w: W, h: H };
  return { x: x0, y: y0, w: Math.min(W, x1 + step) - x0, h: Math.min(H, y1 + step) - y0 };
}

/** sRGB (0–255) → OKLab, scaled ×100 so distances read like ΔE. */
function oklab([r, g, b]: RGB): RGB {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100, (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 100, (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 100];
}

const COLS = 32;

/** The content's mean colour per cell of a grid COLS wide (rows follow its shape), in OKLab. */
function grid(img: Pixels, box: { x: number; y: number; w: number; h: number }, bg: RGB, rows: number): RGB[] {
  const out: RGB[] = [];
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < COLS; gx++) {
      const x0 = box.x + Math.floor((gx * box.w) / COLS),
        x1 = Math.max(x0 + 1, box.x + Math.floor(((gx + 1) * box.w) / COLS));
      const y0 = box.y + Math.floor((gy * box.h) / rows),
        y1 = Math.max(y0 + 1, box.y + Math.floor(((gy + 1) * box.h) / rows));
      const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 6));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let y = y0; y < Math.min(y1, img.height); y += step)
        for (let x = x0; x < Math.min(x1, img.width); x += step) {
          const c = px(img, x, y, bg);
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      out.push(oklab(n ? [r / n, g / n, b / n] : bg));
    }
  return out;
}

export interface Fidelity {
  /** Lower is closer: colour plus a penalty for a different shape. */
  score: number;
  /** Mean OKLab distance (×100) between the two, cell by cell. */
  colour: number;
  /** |ln| of the ratio of their aspect ratios (0 = same shape). */
  aspect: number;
}

/**
 * How close a render of the component comes to the screenshot of it: both trimmed to their
 * content (on the screenshot's background), laid on one grid, compared cell by cell in OKLab,
 * plus how far apart their shapes are. Crude on text, but it ranks two drawings of one screenshot
 * reliably: a missing row, a wrong fill or a picture in the wrong place all cost.
 */
export function fidelity(source: Pixels, render: Pixels): Fidelity {
  const bg = edgeColor(source);
  const sb = contentBox(source, bg);
  const rb = contentBox(render, bg);
  const aspect = Math.abs(Math.log(sb.h / sb.w / (rb.h / rb.w)));
  const rows = Math.max(1, Math.min(96, Math.round((COLS * sb.h) / sb.w)));
  const a = grid(source, sb, bg, rows);
  const b = grid(render, rb, bg, rows);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
  const colour = sum / a.length;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { score: r(colour + 30 * aspect), colour: r(colour), aspect: r(aspect) };
}

/**
 * Copy the drawing cuts off: text truncated to its lines (an ellipsis) or taller than its box. A
 * picture comparison barely sees a cut-off label, so it's counted on its own.
 */
export function cutTexts(nodes: SceneNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "text" || !n.text.content.trim()) continue;
    const t = n.text;
    const line = t.lineHeight || t.fontSize * 1.3;
    const full = measureText({ ...t, maxLines: undefined }, t.autoSize === "width" ? null : n.w);
    if ((t.maxLines && full.h > t.maxLines * line + 1) || (t.autoSize === "fixed" && full.h > n.h + 1)) out.add(t.content.trim().slice(0, 60));
  }
  return [...out];
}

/**
 * Parts that stick out of the container laying them out (a row of buttons wider than its card).
 * Placed parts (absolute: badges, a Graphic's shapes) may overhang on purpose, so only parts in
 * the flow count.
 */
export function overflowing(nodes: SceneNode[]): { name: string; by: number }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: { name: string; by: number }[] = [];
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (!parent || n.absolute || parent.type !== "frame") continue;
    const by = Math.max(-n.x, n.x + n.w - parent.w, -n.y, n.y + n.h - parent.h);
    if (by > 1) out.push({ name: n.type === "text" ? `“${n.text.content.trim().slice(0, 40)}”` : n.name, by: Math.round(by) });
  }
  return out.slice(0, 6);
}

/** How a drawing of the component measures against the screenshot. */
export interface Measure {
  fit: Fidelity | null;
  /** Defects in it: copy cut off, parts sticking out of their container. */
  broken: number;
}

/**
 * A revision is kept only when it measures better than what it revises: fewer defects first (copy
 * cut off, parts sticking out: broken, whatever the picture says), then clearly closer to the
 * screenshot.
 */
export function keepRevision(before: Measure, after: Measure): boolean {
  if (!after.fit) return false;
  if (!before.fit) return true;
  if (after.broken !== before.broken) return after.broken < before.broken;
  return after.fit.score < before.fit.score - 0.5;
}
