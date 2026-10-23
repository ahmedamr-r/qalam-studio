/**
 * Deterministic raw-value extraction for the Token Detective.
 * The model only names and classifies; counting and normalising happen here.
 */
import postcss from "postcss";
import { parse as parseColor } from "culori";
import { normalizeHex } from "./resolve";

export interface RawValue {
  id: string;
  value: string;
  kind: "color" | "dimension" | "font" | "shadow";
  count: number;
  contexts: string[];
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const DIM_PROPS = /^(border-radius|border-(top|bottom)-(left|right)-radius|gap|row-gap|column-gap|padding(-\w+)?|margin(-\w+)?|font-size|line-height|letter-spacing|width|height|min-height|top|left|right|bottom|inset)$/;
const DIM_RE = /(-?\d*\.?\d+)(px|rem)\b/g;

class Collector {
  private map = new Map<string, RawValue>();
  add(kind: RawValue["kind"], value: string, context: string) {
    const key = `${kind}:${value}`;
    let v = this.map.get(key);
    if (!v) {
      v = { id: `v${this.map.size + 1}`, value, kind, count: 0, contexts: [] };
      this.map.set(key, v);
    }
    v.count++;
    if (v.contexts.length < 12 && !v.contexts.includes(context)) v.contexts.push(context);
  }
  values(): RawValue[] {
    return [...this.map.values()].sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind.localeCompare(b.kind)));
  }
}

function colorOf(s: string): string | null {
  const c = parseColor(s);
  return c ? normalizeHex(s) : null;
}

export function extractFromCSS(css: string): RawValue[] {
  const col = new Collector();
  const root = postcss.parse(css);
  // Resolve simple custom properties so var(--x) usages count toward the value.
  const vars = new Map<string, string>();
  root.walkDecls(/^--/, (d) => {
    vars.set(d.prop, d.value);
  });
  root.walkDecls((d) => {
    const selector = d.parent && "selector" in d.parent ? String((d.parent as { selector: string }).selector) : d.parent?.type === "atrule" ? "@rule" : ":root";
    let value = d.value.replace(/var\((--[\w-]+)[^)]*\)/g, (m, name: string) => vars.get(name) ?? m);
    const ctx = `${selector.slice(0, 80)} { ${d.prop} }`;
    if (d.prop === "box-shadow") {
      col.add("shadow", value.trim(), ctx);
      value = value.replace(COLOR_RE, "");
    }
    for (const m of value.match(COLOR_RE) ?? []) {
      const hex = colorOf(m);
      if (hex) col.add("color", hex, ctx);
    }
    if (/^(color|background(-color)?|border(-\w+)?-color|fill|stroke|outline-color)$/.test(d.prop)) {
      for (const word of value.split(/\s+/)) {
        if (/^[a-z]+$/.test(word) && !["transparent", "inherit", "currentcolor", "none", "initial", "solid", "dashed"].includes(word.toLowerCase())) {
          const hex = colorOf(word);
          if (hex) col.add("color", hex, ctx);
        }
      }
    }
    if (DIM_PROPS.test(d.prop)) {
      for (const m of value.matchAll(DIM_RE)) {
        const px = m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
        if (px !== 0) col.add("dimension", `${Math.round(px * 100) / 100}px`, ctx);
      }
    }
    if (d.prop === "font-family") col.add("font", value.split(",")[0].replace(/["']/g, "").trim(), ctx);
  });
  return col.values();
}

export function extractFromJSON(text: string): RawValue[] {
  const col = new Collector();
  const data = JSON.parse(text) as unknown;
  const walk = (node: unknown, path: string[]) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string" || typeof node === "number") {
      const key = path.join(".");
      const s = String(node);
      if (/^\{.+\}$/.test(s)) return; // alias
      const hex = typeof node === "string" ? colorOf(s) : null;
      if (hex && (/#|rgb|hsl/.test(s) || /colou?r|fill|bg|background|text|border/i.test(key))) {
        col.add("color", hex, key.replace(/\.\$?value$/, ""));
        return;
      }
      if (/radius|space|spacing|gap|padding|size|height|width|font-?size|line-?height/i.test(key)) {
        const n = typeof node === "number" ? node : parseFloat(s);
        if (Number.isFinite(n) && n !== 0) col.add("dimension", `${n}px`, key.replace(/\.\$?value$/, ""));
      }
      if (/font-?family/i.test(key)) col.add("font", s, key);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...path, String(i)]));
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // Figma variables export: { name, resolvedValuesByMode | valuesByMode }
      if (typeof obj.name === "string" && (obj.valuesByMode || obj.resolvedValuesByMode)) {
        const modes = (obj.resolvedValuesByMode ?? obj.valuesByMode) as Record<string, unknown>;
        for (const v of Object.values(modes)) {
          const val = (v as Record<string, unknown>)?.resolvedValue ?? v;
          if (val && typeof val === "object" && "r" in (val as object)) {
            const { r, g, b, a } = val as { r: number; g: number; b: number; a?: number };
            const hex = normalizeHex(`rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a ?? 1})`);
            if (hex) col.add("color", hex, obj.name);
          } else walk(val, [obj.name]);
        }
        return;
      }
      for (const [k, v] of Object.entries(obj)) if (k !== "$description") walk(v, [...path, k]);
    }
  };
  walk(data, []);
  return col.values();
}

// ---------------------------------------------------------------------------
// Images

export interface PreparedImage {
  mediaType: "image/jpeg" | "image/png";
  data: string; // base64 without prefix
  dataUrl: string;
  /** Size as sent (after downscaling). */
  width: number;
  height: number;
  /** Size of the original file. */
  sourceWidth: number;
  sourceHeight: number;
  palette: string[];
  /** Pixels of the prepared image, for measuring colours inside regions the model points at. */
  pixels?: ImageData;
}

/** The largest image the vision models read without resizing it again: 2576 px on the long side, 3.75 MP. */
export const MAX_IMAGE_SIDE = 2576;
const MAX_IMAGE_PIXELS = 3_750_000;

/**
 * Downscale to ≤maxSide (and ≤3.75 MP) and measure dominant flat colours. JPEG by default;
 * `lossless` keeps PNG when it fits the budget, because JPEG smears 1px borders and soft shadows.
 * `maxBytes` caps the base64 size (requests carry several images and must stay small enough for
 * serverless request limits): quality, then size, give way until it fits.
 */
export async function prepareImage(file: Blob, maxSide = 1568, opts: { lossless?: boolean; maxBytes?: number } = {}): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file);
  const budget = opts.maxBytes ?? 3_200_000;
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height), Math.sqrt(MAX_IMAGE_PIXELS / (bmp.width * bmp.height)));
  for (let attempt = 0; ; attempt++) {
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const png = opts.lossless && attempt === 0 ? canvas.toDataURL("image/png") : "";
    let dataUrl = png && png.length < budget ? png : "";
    for (const q of opts.lossless ? [0.94, 0.88, 0.8] : [0.88, 0.8]) {
      if (dataUrl) break;
      const jpg = canvas.toDataURL("image/jpeg", q);
      if (jpg.length < budget) dataUrl = jpg;
    }
    if (!dataUrl && attempt < 4) {
      scale *= 0.8;
      continue;
    }
    dataUrl ||= canvas.toDataURL("image/jpeg", 0.75);
    const pixels = ctx.getImageData(0, 0, w, h);
    const usePng = dataUrl.startsWith("data:image/png");
    return {
      mediaType: usePng ? "image/png" : "image/jpeg",
      data: dataUrl.split(",")[1],
      dataUrl,
      width: w,
      height: h,
      sourceWidth: bmp.width,
      sourceHeight: bmp.height,
      palette: dominantColors(pixels),
      pixels,
    };
  }
}

/**
 * Dominant colour of a region given in 0–1 image coordinates [x0, y0, x1, y1], with the share of
 * the region it covers (1 = perfectly flat). Null if the region is empty.
 */
export function sampleRegion(img: ImageData, box: number[]): { hex: string; coverage: number } | null {
  if (box.length !== 4) return null;
  const [x0, y0, x1, y1] = box.map((v) => Math.min(1, Math.max(0, Number(v) || 0)));
  const L = Math.floor(Math.min(x0, x1) * img.width), R = Math.ceil(Math.max(x0, x1) * img.width);
  const T = Math.floor(Math.min(y0, y1) * img.height), B = Math.ceil(Math.max(y0, y1) * img.height);
  if (R - L < 1 || B - T < 1) return null;
  // Mode of 4-bit buckets, so text or icons inside the region don't pull the average.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const step = Math.max(1, Math.floor(((R - L) * (B - T)) / 40000));
  let i = 0;
  for (let y = T; y < B; y++)
    for (let x = L; x < R; x++, i++) {
      if (i % step) continue;
      const o = (y * img.width + x) * 4;
      const d = img.data;
      const key = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
      const b = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      b.r += d[o];
      b.g += d[o + 1];
      b.b += d[o + 2];
      b.n++;
      buckets.set(key, b);
    }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  let total = 0;
  for (const b of buckets.values()) {
    total += b.n;
    if (!best || b.n > best.n) best = b;
  }
  if (!best) return null;
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
  return { hex: `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toUpperCase(), coverage: best.n / total };
}

/** Flat-UI colour quantizer: 5-bit buckets, averaged, top distinct colours by area. */
export function dominantColors(img: ImageData, max = 12): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const d = img.data;
  const step = Math.max(1, Math.floor((img.width * img.height) / 120000));
  for (let i = 0; i < d.length; i += 4 * step) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    const bkt = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bkt.r += d[i];
    bkt.g += d[i + 1];
    bkt.b += d[i + 2];
    bkt.n++;
    buckets.set(key, bkt);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const out: { r: number; g: number; b: number }[] = [];
  const total = sorted.reduce((s, b) => s + b.n, 0);
  for (const bk of sorted) {
    if (bk.n / total < 0.002) break;
    const c = { r: bk.r / bk.n, g: bk.g / bk.n, b: bk.b / bk.n };
    if (out.some((o) => Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 36)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return out.map((c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`.toUpperCase());
}

export const SAMPLE_CSS = `/* Legacy checkout – exported from an old web build */
:root {
  --green: #00A651;
  --green-2: #00a650;
  --grey-text: #8A8A8A;
}
.header { background: #FFFFFF; padding: 16px 20px; border-bottom: 1px solid #E6E6E6; }
.header h1 { font-size: 22px; color: #111; }
.btn-primary { background: var(--green); color: #fff; border-radius: 14px; padding: 14px 24px; font-size: 16px; }
.btn-primary:hover { background: var(--green-2); }
.toast--success { border-left: 4px solid #00A651; background: #E8F8EF; color: #0B5D32; border-radius: 12px; padding: 12px 16px; }
.price-tag { color: #00A651; font-weight: 700; font-size: 18px; }
.caption, .meta { color: var(--grey-text); font-size: 14px; }
.card { background: #F2F2F2; border-radius: 10px; padding: 16px; gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.chip { border-radius: 999px; padding: 6px 14px; border: 1px solid #E6E6E6; font-size: 13px; }
.error { color: #E53935; font-size: 13px; }
.input { border: 1px solid #E6E6E6; border-radius: 12px; height: 48px; }
.link { color: #0B5D32; text-decoration: underline; }
.promo--plus { background: #004D40; color: #34D399; border-radius: 24px; }
`;
