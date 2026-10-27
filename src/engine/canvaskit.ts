import type { CanvasKit, Path, TypefaceFontProvider } from "canvaskit-wasm";
import ckScript from "canvaskit-wasm/bin/canvaskit.js?url";
import ckWasm from "canvaskit-wasm/bin/canvaskit.wasm?url";
import type { Seg } from "@/design-system/svg-path";
import { type Area, type BoolOp, type PathOps, setPathOps } from "@/doc/path-ops";

// CanvasKit ships with the app (bundled from canvaskit-wasm), so the canvas works offline.

export const FONT_FILES: { family: string; file: string }[] = [
  ...[400, 500, 600, 700].map((w) => ({ family: "Inter", file: `/fonts/Inter-${w}.ttf` })),
  ...[400, 500, 600, 700].map((w) => ({ family: "IBM Plex Sans Arabic", file: `/fonts/IBMPlexSansArabic-${w}.ttf` })),
  ...[400, 600, 700].map((w) => ({ family: "Plus Jakarta Sans", file: `/fonts/PlusJakartaSans-${w}.ttf` })),
];

export const FONT_FAMILIES = ["Inter", "Plus Jakarta Sans", "IBM Plex Sans Arabic"];

export interface Engine {
  ck: CanvasKit;
  fonts: TypefaceFontProvider;
}

declare global {
  interface Window {
    CanvasKitInit?: (opts: { locateFile: (file: string) => string }) => Promise<CanvasKit>;
  }
}

let enginePromise: Promise<Engine> | null = null;
let engine: Engine | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.CanvasKitInit) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export function loadEngine(): Promise<Engine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const fontBuffers = Promise.all(
      FONT_FILES.map(async (f) => ({ family: f.family, bytes: await (await fetch(f.file)).arrayBuffer() })),
    );
    await loadScript(ckScript);
    const ck = await window.CanvasKitInit!({ locateFile: () => ckWasm });
    const fonts = ck.TypefaceFontProvider.Make();
    for (const f of await fontBuffers) fonts.registerFont(f.bytes, f.family);
    setPathOps(makePathOps(ck));
    engine = { ck, fonts };
    return engine;
  })();
  return enginePromise;
}

export function getEngine(): Engine {
  if (!engine) throw new Error("CanvasKit engine not loaded yet");
  return engine;
}

/** "#RRGGBB" / "#RRGGBBAA" → CanvasKit Color4f. */
export function hexToColor(ck: CanvasKit, hex: string, alphaMul = 1): Float32Array {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return ck.Color4f(r || 0, g || 0, b || 0, (a || 0) * alphaMul);
}

// ---------------------------------------------------------------------------
// Path ops for src/doc (booleans, flatten, outline stroke): Skia's PathOps and stroker.

/** Absolute moves, lines and cubics → a CanvasKit path (the caller deletes it). */
function pathOf(ck: CanvasKit, segs: Seg[], evenOdd = false): Path | null {
  const cmds: number[] = [];
  for (const s of segs) {
    if (s.c === "M") cmds.push(ck.MOVE_VERB, s.x, s.y);
    else if (s.c === "L") cmds.push(ck.LINE_VERB, s.x, s.y);
    else if (s.c === "C") cmds.push(ck.CUBIC_VERB, s.x1, s.y1, s.x2, s.y2, s.x, s.y);
    else cmds.push(ck.CLOSE_VERB);
  }
  const p = ck.Path.MakeFromCmds(cmds);
  if (p && evenOdd) p.setFillType(ck.FillType.EvenOdd);
  return p;
}

/**
 * A path's verbs as moves, lines and cubics. Quads are raised exactly; conics (Skia's round caps,
 * joins and ovals, ≤ 90° each) become the usual cubic arc, so a round cap is two anchors, not dozens.
 */
export function segsOfPath(ck: CanvasKit, p: Path): Seg[] {
  const c = p.toCmds();
  const out: Seg[] = [];
  let x = 0,
    y = 0;
  for (let i = 0; i < c.length; ) {
    const verb = c[i++];
    if (verb === ck.MOVE_VERB) {
      x = c[i++];
      y = c[i++];
      out.push({ c: "M", x, y });
    } else if (verb === ck.LINE_VERB) {
      x = c[i++];
      y = c[i++];
      out.push({ c: "L", x, y });
    } else if (verb === ck.QUAD_VERB || verb === ck.CONIC_VERB) {
      const qx = c[i++],
        qy = c[i++],
        ex = c[i++],
        ey = c[i++];
      const w = verb === ck.CONIC_VERB ? c[i++] : 1;
      // Control points at k of the way to the conic's control point: 2/3 for a quad, 0.5523 for a quarter circle.
      const k = (4 * w) / (3 * (1 + w));
      out.push({ c: "C", x1: x + k * (qx - x), y1: y + k * (qy - y), x2: ex + k * (qx - ex), y2: ey + k * (qy - ey), x: ex, y: ey });
      x = ex;
      y = ey;
    } else if (verb === ck.CUBIC_VERB) {
      const s: Seg = { c: "C", x1: c[i++], y1: c[i++], x2: c[i++], y2: c[i++], x: c[i++], y: c[i++] };
      out.push(s);
      x = s.x;
      y = s.y;
    } else if (verb === ck.CLOSE_VERB) out.push({ c: "Z" });
    else break;
  }
  return out;
}

export function makePathOps(ck: CanvasKit): PathOps {
  const OPS: Record<BoolOp, typeof ck.PathOp.Union> = {
    union: ck.PathOp.Union,
    subtract: ck.PathOp.Difference,
    intersect: ck.PathOp.Intersect,
    exclude: ck.PathOp.XOR,
  };
  const combine = (a: Path, b: Path, op: BoolOp): Area | null => {
    const r = ck.Path.MakeFromOp(a, b, OPS[op]);
    if (!r) return null;
    // PathOps answer with even-odd contours (makeAsWinding can't rewind ones that touch, as an
    // exclude's do), so results keep that rule, like Figma's flattened booleans.
    const out: Area = { segs: segsOfPath(ck, r), evenOdd: r.getFillType() === ck.FillType.EvenOdd };
    r.delete();
    return out;
  };
  return {
    combine(a: Area, b: Area, op: BoolOp) {
      const pa = pathOf(ck, a.segs, a.evenOdd);
      const pb = pathOf(ck, b.segs, b.evenOdd);
      const out = pa && pb ? combine(pa, pb, op) : null;
      pa?.delete();
      pb?.delete();
      return out;
    },
    stroke(segs, style) {
      const p = pathOf(ck, segs);
      if (!p) return null;
      const stroked = p.makeStroked({
        width: style.width,
        miter_limit: style.miter ?? 4,
        cap: style.cap === "round" ? ck.StrokeCap.Round : style.cap === "square" ? ck.StrokeCap.Square : ck.StrokeCap.Butt,
        join: style.join === "round" ? ck.StrokeJoin.Round : style.join === "bevel" ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter,
      });
      p.delete();
      if (!stroked) return null;
      // The stroker's contours overlap at joins and self-crossings: a union with nothing resolves them.
      const empty = new ck.Path();
      const out = combine(stroked, empty, "union");
      stroked.delete();
      empty.delete();
      return out;
    },
  };
}
