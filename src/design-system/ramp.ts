import { clampChroma, converter, formatHex, type Oklch } from "culori";
import { contrastRatio, normalizeHex } from "./resolve";

/**
 * Colour ramps for generated systems: 12 steps in OKLCH with Radix's meanings (1–2 backgrounds,
 * 3–5 component backgrounds, 6–8 borders, 9–10 solid fills, 11–12 text). Each step is found by
 * the contrast it must reach against step 1 (Leonardo-style), so every hue at the same step reads
 * the same, and text steps pass WCAG by construction. A brand colour, when given, is step 9 exactly.
 */

export type Ramp = readonly string[];

/** WCAG contrast of each step against step 1; null = the solid steps (9, 10), placed separately. */
export const TARGETS = {
  hue: {
    standard: [1, 1.04, 1.09, 1.15, 1.24, 1.38, 1.65, 3.0, null, null, 5.2, 13],
    high: [1, 1.04, 1.09, 1.15, 1.24, 1.38, 1.65, 3.3, null, null, 6.0, 15],
  },
  neutral: {
    standard: [1, 1.03, 1.08, 1.13, 1.2, 1.33, 1.55, 3.0, 3.3, 5.0, 6.2, 15],
    high: [1, 1.03, 1.08, 1.13, 1.2, 1.33, 1.55, 3.3, 3.6, 5.5, 7.5, 17],
  },
} as const satisfies Record<string, Record<"standard" | "high", readonly (number | null)[]>>;

/** Share of the chroma cap each step may use: quiet backgrounds, full colour at the solid steps. */
export const CHROMA_CURVE = [0.02, 0.05, 0.12, 0.2, 0.3, 0.4, 0.55, 0.75, 1, 0.95, 0.85, 0.45] as const;

const toOklch = converter("oklch");
const WHITE = "#FFFFFF";

/** An OKLCH colour as hex, chroma reduced (hue and lightness kept) until it fits sRGB. */
export function okHex(l: number, c: number, h: number): string {
  const fit = clampChroma({ mode: "oklch", l: Math.min(1, Math.max(0, l)), c: Math.max(0, c), h }, "oklch") as Oklch;
  return (formatHex(fit) ?? "#000000").toUpperCase();
}

export const oklchOf = (hex: string): Oklch | undefined => toOklch(hex) as Oklch | undefined;

/** Lightness of a colour in OKLCH (0–1). */
const lightness = (hex: string) => oklchOf(hex)?.l ?? 1;

/** The hue of a colour, or null when it is a grey (no hue worth keeping). */
export function hueOf(hex: string): number | null {
  const c = oklchOf(hex);
  return c && c.c >= 0.02 && Number.isFinite(c.h) ? (c.h as number) : null;
}

/**
 * The colour of hue `h`, chroma `c` (less where the gamut is narrower) that reaches `ratio`
 * contrast against `bg`, darker than it. Never falls short of the ratio.
 */
export function toneFor(h: number, c: number, bg: string, ratio: number): string {
  if (ratio <= 1) return okHex(lightness(bg), c, h);
  let lo = 0;
  let hi = lightness(bg);
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(okHex(mid, c, h), bg) >= ratio) lo = mid;
    else hi = mid;
  }
  let l = lo;
  let hex = okHex(l, c, h);
  // Rounding to hex can cost a hair of contrast: step down until the ratio holds.
  while (contrastRatio(hex, bg) < ratio && l > 0) hex = okHex((l -= 0.002), c, h);
  return hex;
}

/** The most chroma sRGB allows at this lightness and hue. */
const maxChroma = (l: number, h: number) => oklchOf(okHex(l, 0.4, h))?.c ?? 0;

const cusps = new Map<number, number>();
/** Lightness where hue `h` reaches its most saturated colour in sRGB (per whole degree, cached). */
function cuspL(hue: number): number {
  const h = Math.round(hue) % 360;
  const known = cusps.get(h);
  if (known !== undefined) return known;
  let best = 0.6;
  let most = -1;
  for (let l = 0.3; l <= 0.95; l += 0.01) {
    const c = maxChroma(l, h);
    if (c > most) {
      most = c;
      best = l;
    }
  }
  cusps.set(h, best);
  return best;
}

/** Yellows, ambers and limes: hues whose most vivid colour is light and takes dark text. */
export const isLightHue = (h: number) => h >= 75 && h <= 125;

/**
 * A solid fill (step 9): as saturated as the cap and gamut allow, dark enough for the light text
 * `on` (white by default) to reach 4.5:1. Yellow-ish hues stay at their vivid light point and take
 * dark text instead, unless `white` asks for light text regardless (banner accents).
 */
export function solidStep(h: number, cap: number, opts: { white?: boolean; on?: string } = {}): string {
  const on = opts.on ?? WHITE;
  let l = cuspL(h);
  const at = (x: number) => okHex(x, Math.min(cap, maxChroma(x, h)), h);
  if (contrastRatio(on, at(l)) >= 4.5 || (!opts.white && isLightHue(h) && l >= 0.78)) return at(l);
  while (l > 0.2 && contrastRatio(on, at(l)) < 4.5) l -= 0.01;
  return at(l);
}

export interface RampOptions {
  hue: number;
  /** Chroma cap (OKLCH C) at full colour; steps use a share of it (`curve`). */
  chroma: number;
  /** Step 1, what every target is measured against. */
  background: string;
  targets: readonly (number | null)[];
  /** The brand colour: placed at step 9 exactly. */
  anchor?: string;
  curve?: readonly number[];
  /** Solid steps must carry light text (banner accents). */
  white?: boolean;
  /** The light text colour solid steps are measured with (white by default). */
  on?: string;
}

export function makeRamp(o: RampOptions): Ramp {
  const curve = o.curve ?? CHROMA_CURVE;
  const bg = normalizeHex(o.background) ?? WHITE;
  const steps: string[] = [];
  for (let i = 0; i < 12; i++) {
    const t = o.targets[i];
    if (i === 0) steps.push(bg);
    else if (t != null) steps.push(toneFor(o.hue, o.chroma * curve[i], bg, t));
    else steps.push(""); // solid steps, below
  }
  const nine = (o.anchor && normalizeHex(o.anchor)?.slice(0, 7)) || solidStep(o.hue, o.chroma, { white: o.white, on: o.on });
  const n = oklchOf(nine);
  if (o.targets[8] == null) steps[8] = nine;
  if (o.targets[9] == null) steps[9] = n ? okHex(n.l > 0.5 ? n.l - 0.04 : n.l + 0.04, n.c, n.h ?? o.hue) : nine;
  return steps;
}

/** Turn `hue` toward `toward` by half their difference, at most `max` degrees (Material's harmonize). */
export function harmonize(hue: number, toward: number, max = 15, amount = 0.5): number {
  const diff = ((toward - hue + 540) % 360) - 180;
  const turn = Math.max(-max, Math.min(max, diff * amount));
  return (hue + turn + 360) % 360;
}

/** The first of `prefs` that reaches `min` on `fill`; else black or white, whichever reads better (one always passes 4.5). */
export function onColor(fill: string, prefs: readonly string[], min = 4.5): string {
  const hit = prefs.find((p) => contrastRatio(p, fill) >= min);
  if (hit) return hit;
  return contrastRatio("#000000", fill) >= contrastRatio(WHITE, fill) ? "#000000" : WHITE;
}

/** Angular distance between two hues (0–180). */
export const hueDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
