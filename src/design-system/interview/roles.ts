import { contrastRatio } from "../resolve";
import { harmonize, hueDistance, hueOf, makeRamp, okHex, oklchOf, onColor, solidStep, TARGETS, toneFor, type Ramp } from "../ramp";
import type { Knobs } from "./knobs";

/**
 * Knobs → colours. Every ramp is measured against the same step 1 (the canvas), so one step means
 * one contrast everywhere. Each colour role then takes the first ramp step that passes its gates,
 * written as an alias into the palette; text and borders pass WCAG 2.2 by construction.
 */

export type RampName = "neutral" | "brand" | "success" | "warning" | "error" | "info";
export type AccentName = "go" | "get" | "eat" | "pay";

export interface Palette {
  ramps: Record<RampName, Ramp>;
  accents: Record<AccentName, string>;
  /** The canvas every ramp was measured against. */
  background: string;
  hue: number;
}

/** Peak chroma for each "colour" setting, or the share of the brand colour's own chroma when there is one. */
const CAP = { muted: 0.07, balanced: 0.12, vivid: 0.17, bold: 0.23 } as const;
const OF_BRAND = { muted: 0.5, balanced: 0.75, vivid: 1, bold: 1.15 } as const;
const TINT = { pure: { c: 0, h: null }, cool: { c: 0.012, h: 250 }, warm: { c: 0.012, h: 75 }, brand: { c: 0.018, h: null } } as const;
const FLAT = Array(12).fill(1) as number[];
const SEMANTIC: Record<Exclude<RampName, "neutral" | "brand">, number> = { success: 150, warning: 80, error: 27, info: 245 };
const ACCENT: Record<AccentName, number> = { go: 240, get: 300, eat: 80, pay: 170 };

const memo = new Map<string, Palette>();

export function palette(k: Knobs): Palette {
  const key = JSON.stringify([k.hue, k.brandHex, k.chroma, k.neutralTint, k.contrast]);
  const hit = memo.get(key);
  if (hit) return hit;

  const anchor = k.brandHex ?? undefined;
  const hue = (anchor ? hueOf(anchor) : null) ?? k.hue;
  const brandC = anchor ? (oklchOf(anchor)?.c ?? 0) : 0;
  // A grey brand colour makes a grey brand ramp; otherwise the setting scales the brand's own colour.
  const cap = !anchor ? CAP[k.chroma] : brandC < 0.02 ? brandC : Math.min(0.32, brandC * OF_BRAND[k.chroma]);
  const tint = TINT[k.neutralTint];
  const nh = tint.h ?? hue;
  const background = k.neutralTint === "pure" ? "#FFFFFF" : okHex(0.99, tint.c * 0.6, nh);
  const neutral = makeRamp({ hue: nh, chroma: tint.c, background, targets: TARGETS.neutral[k.contrast], curve: FLAT });
  // Solid steps are measured against the system's own white (step 1), which may be tinted.
  const ramp = (h: number, c: number, a?: string) => makeRamp({ hue: h, chroma: c, background, targets: TARGETS.hue[k.contrast], anchor: a, on: background });
  // Status colours stay recognisable however quiet the brand is.
  const semC = Math.min(0.17, Math.max(0.12, cap));
  const accentC = Math.max(0.1, cap);
  const ramps: Record<RampName, Ramp> = {
    neutral,
    brand: ramp(hue, cap, anchor),
    success: ramp(harmonize(SEMANTIC.success, hue), semC),
    warning: ramp(harmonize(SEMANTIC.warning, hue), semC),
    error: ramp(harmonize(SEMANTIC.error, hue), semC),
    info: ramp(harmonize(SEMANTIC.info, hue), semC),
  };
  const accents = Object.fromEntries(
    (Object.keys(ACCENT) as AccentName[]).map((name) => {
      let h = harmonize(ACCENT[name], hue);
      if (hueDistance(h, hue) < 30) h = (h + 40) % 360;
      const c = accentC;
      return [name, name === "eat" ? toneFor(h, c * 0.45, background, 1.24) : solidStep(h, c, { white: true, on: background })];
    }),
  ) as Record<AccentName, string>;
  const out: Palette = { ramps, accents, background, hue };
  memo.set(key, out);
  if (memo.size > 64) memo.delete(memo.keys().next().value!);
  return out;
}

/** A step of a ramp: [ramp, step 1–12]. */
type Ref = readonly [RampName, number];
export const stepPath = ([r, i]: Ref) => `color.${r}.${i}`;

export interface RoleValue {
  /** Alias target ("color.brand.11"), or a literal when no step passes. */
  ref: string | null;
  hex: string;
  note: string;
}

const LIGHT_TEXT = 4.5;

/** Colour roles for the knobs: alias into the palette where a step passes its gates. */
export function colourRoles(k: Knobs, p: Palette): Record<string, RoleValue> {
  const R = p.ramps;
  const hexOf = ([r, i]: Ref) => R[r][i - 1];
  const out: Record<string, RoleValue> = {};
  const set = (role: string, ref: Ref, why = "") => (out[role] = { ref: stepPath(ref), hex: hexOf(ref), note: `${ref[0]} step ${ref[1]}${why}` });
  const val = (role: string) => out[role].hex;
  /** The first candidate that passes every gate (the last one otherwise: the darkest, closest to passing). */
  const pick = (role: string, cands: Ref[], gates: (hex: string) => boolean) => set(role, cands.find((c) => gates(hexOf(c))) ?? cands[cands.length - 1]);
  const lit = (role: string, hex: string, note: string) => (out[role] = { ref: null, hex, note });

  // Surfaces
  set("bg.canvas", ["neutral", k.elevation === "layered" ? 2 : 1]);
  set("bg.surface", ["neutral", 3]);
  set("bg.surface-raised", ["neutral", k.elevation === "flat" ? 2 : 1]);

  // Brand: the primary action carries light text, unless the brand colour is a light one (yellows,
  // limes) that reads better with dark text, as the brand itself would use it.
  const light = hexOf(["neutral", 1]);
  const nine = hexOf(["brand", 9]);
  const lightBrand = (oklchOf(nine)?.l ?? 0) >= 0.75 && contrastRatio(light, nine) < LIGHT_TEXT;
  if (lightBrand) set("bg.brand-strong", ["brand", 9], " (light brand: dark labels)");
  else pick("bg.brand-strong", [["brand", 9], ["brand", 10], ["brand", 11], ["brand", 12]], (h) => contrastRatio(light, h) >= LIGHT_TEXT);
  set("bg.brand", ["brand", 9]);
  set("bg.brand-subtle", ["brand", 3]);
  set("bg.inverse", k.chroma === "vivid" || k.chroma === "bold" ? ["brand", 12] : ["neutral", 12]);
  set("bg.sky", ["info", 3]);
  for (const a of ["go", "get", "eat", "pay"] as const) out[`bg.${a}`] = { ref: `color.accent.${a}`, hex: p.accents[a], note: `${a} accent` };

  // Text
  const surfaces = () => [val("bg.canvas"), val("bg.surface"), val("bg.surface-raised")];
  pick("text.primary", [["neutral", 12]], () => true);
  pick("text.secondary", [["neutral", 11], ["neutral", 12]], (h) => surfaces().every((b) => contrastRatio(h, b) >= 4.5));
  pick("text.tertiary", [["neutral", 10], ["neutral", 11], ["neutral", 12]], (h) => surfaces().every((b) => contrastRatio(h, b) >= 4.5));
  set("text.inverse", ["neutral", 1]);
  pick("text.link", [["brand", 11], ["brand", 12]], (h) => [val("bg.canvas"), val("bg.surface")].every((b) => contrastRatio(h, b) >= 4.5));
  for (const [role, ramp] of [["success", "success"], ["error", "error"], ["warning", "warning"], ["info", "info"]] as const) {
    pick(`text.${role}`, [[ramp, 11], [ramp, 12]], (h) => [val("bg.canvas"), hexOf([ramp, 3])].every((b) => contrastRatio(h, b) >= 4.5));
  }
  const strong = val("bg.brand-strong");
  const onStrong = contrastRatio(light, strong) >= LIGHT_TEXT && !lightBrand ? (["neutral", 1] as Ref) : (["neutral", 12] as Ref);
  set("text.on-brand-strong", onStrong);
  const onBrand = onColor(val("bg.brand"), [hexOf(["neutral", 1]), hexOf(["brand", 12]), hexOf(["neutral", 12])]);
  const onBrandRef = ([["neutral", 1], ["brand", 12], ["neutral", 12]] as Ref[]).find((r) => hexOf(r) === onBrand);
  if (onBrandRef) set("text.on-brand", onBrandRef);
  else lit("text.on-brand", onBrand, "black or white on the brand fill");

  // Borders (3:1 for the ones that carry meaning: WCAG 1.4.11)
  set("border.subtle", ["neutral", 6]);
  pick("border.default", [["neutral", 8], ["neutral", 9], ["neutral", 10]], (h) => contrastRatio(h, val("bg.canvas")) >= 3);
  set("border.strong", ["neutral", 11]);
  pick("border.focus", [["brand", 9], ["brand", 10], ["brand", 11]], (h) => contrastRatio(h, val("bg.canvas")) >= 3);
  pick("border.error", [["error", 9], ["error", 10], ["error", 11]], (h) => contrastRatio(h, val("bg.canvas")) >= 3);

  // Feedback fills
  set("feedback.success", ["success", 9]);
  set("feedback.warning", ["warning", 9]);
  set("feedback.info", ["info", 9]);
  pick("feedback.error", [["error", 9], ["error", 10], ["error", 11]], (h) => contrastRatio(val("text.inverse"), h) >= LIGHT_TEXT);
  for (const r of ["success", "warning", "error", "info"] as const) set(`feedback.${r}-subtle`, [r, 3]);

  // Icons (3:1)
  set("icon.primary", ["neutral", 12]);
  set("icon.secondary", ["neutral", 11]);
  pick("icon.brand", [["brand", 11], ["brand", 12]], (h) => [val("bg.canvas"), val("bg.brand-subtle")].every((b) => contrastRatio(h, b) >= 3));
  set("icon.on-brand-strong", onStrong);
  set("icon.inverse", ["neutral", 1]);
  return out;
}

/** Primitive tokens: every ramp step and accent. */
export function primitives(p: Palette): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, ramp] of Object.entries(p.ramps)) ramp.forEach((hex, i) => out.push([`color.${name}.${i + 1}`, hex]));
  for (const [name, hex] of Object.entries(p.accents)) out.push([`color.accent.${name}`, hex]);
  return out;
}
