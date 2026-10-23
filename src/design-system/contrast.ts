import { converter, formatHex } from "culori";
import { setToken } from "./contract";
import { TokenSet, contrastRatio, flatten, type Tree } from "./resolve";

/**
 * Legibility, shared by everything that makes a system (extraction and the brand interview):
 * nudging a colour until it reads, the role pairs every system must pass, and the component
 * text-on-fill pairs fixed inside recipes.
 */

/** Nudge a colour's lightness until it reaches `min` contrast on `bg` (toward black or white). */
export function fixContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const toOk = converter("oklch");
  const c = toOk(fg);
  if (!c) return fg;
  const darker = contrastRatio("#000000", bg) >= contrastRatio("#FFFFFF", bg);
  for (let i = 1; i <= 50; i++) {
    const l = Math.min(1, Math.max(0, c.l + (darker ? -0.02 : 0.02) * i));
    const hex = formatHex({ ...c, l })?.toUpperCase();
    if (hex && contrastRatio(hex, bg) >= min) return hex;
  }
  return darker ? "#000000" : "#FFFFFF";
}

/** Text and icon roles must stay legible on the surfaces they're used on. */
export const ROLE_CONTRAST_PAIRS: readonly [string, string, number][] = [
  ["text.primary", "bg.canvas", 4.5],
  ["text.secondary", "bg.canvas", 4.5],
  ["text.primary", "bg.surface", 4.5],
  ["text.on-brand-strong", "bg.brand-strong", 4.5],
  ["text.on-brand", "bg.brand", 4.5],
  ["text.inverse", "bg.inverse", 4.5],
  ["text.link", "bg.canvas", 4.5],
  ["text.error", "bg.canvas", 4.5],
  ["text.success", "bg.canvas", 4.5],
  ["text.warning", "bg.canvas", 4.5],
  ["text.info", "bg.canvas", 4.5],
  ["text.primary", "bg.surface-raised", 4.5],
  ["text.secondary", "bg.surface", 4.5],
  ["text.link", "bg.surface", 4.5],
  ["text.success", "feedback.success-subtle", 4.5],
  ["text.error", "feedback.error-subtle", 4.5],
  ["text.warning", "feedback.warning-subtle", 4.5],
  ["text.info", "feedback.info-subtle", 4.5],
  ["icon.on-brand-strong", "bg.brand-strong", 3],
  ["icon.primary", "bg.canvas", 3],
  ["icon.primary", "bg.surface", 3],
  ["icon.secondary", "bg.canvas", 3],
  ["icon.secondary", "bg.surface", 3],
  ["icon.secondary", "bg.surface-raised", 3],
  ["icon.brand", "bg.canvas", 3],
  ["icon.brand", "bg.brand-subtle", 3],
];

const TEXT_ROLES = ["text.primary", "text.inverse", "text.on-brand-strong", "text.on-brand", "text.secondary"];
const ICON_ROLES = ["icon.primary", "icon.inverse", "icon.on-brand-strong", "icon.brand", "icon.secondary"];
const BANNERS = ["brand", "go", "get", "eat", "pay"];
/**
 * Foreground recipe, the fill it sits on, the contrast it needs (3:1 for icons and large titles),
 * and what that fill sits on when it's translucent (the canvas unless named).
 */
const RECIPE_PAIRS: [string, string, number, string?][] = [
  ["component.button.primary.label", "component.button.primary.fill", 4.5],
  ["component.button.primary.icon", "component.button.primary.fill", 3],
  ["component.button.secondary.label", "component.button.secondary.fill", 4.5],
  ["component.button.danger.label", "component.button.danger.fill", 4.5],
  ["component.chip.label", "component.chip.fill", 4.5],
  ["component.chip.selected.label", "component.chip.selected.fill", 4.5],
  ["component.icon-button.icon", "component.icon-button.outline-fill", 3],
  ["component.icon-button.brand-icon", "component.icon-button.brand-fill", 3],
  ["component.tile.icon", "component.tile.icon-fill", 3],
  ["component.table.header-label", "component.table.header-fill", 4.5],
  ...BANNERS.flatMap((t): [string, string, number, string?][] => [
    [`component.banner.${t}.title`, `component.banner.${t}.fill`, 3],
    [`component.banner.${t}.body`, `component.banner.${t}.fill`, 4.5],
    // The call to action and the art circle sit on the banner, often as a translucent white.
    [`component.banner.${t}.cta-label`, `component.banner.${t}.cta-fill`, 4.5, `component.banner.${t}.fill`],
    [`component.banner.${t}.art-icon`, `component.banner.${t}.art-fill`, 3, `component.banner.${t}.fill`],
  ]),
];

/**
 * Contrast of a foreground on a fill, judged the way the linter judges a rendered screen: a
 * gradient by its average colour, translucent colours over the canvas.
 */
function fillContrast(ts: TokenSet, fg: string, bgPath: string, underPath?: string): { ratio: number; bg: string } | null {
  const fc = ts.color(fg);
  const paint = ts.paint(bgPath);
  if (!fc || !paint) return null;
  const canvas = ts.color("bg.canvas") ?? "#FFFFFF";
  const underPaint = underPath ? ts.paint(underPath)?.color : undefined;
  const under = underPaint ? (underPaint.length === 9 ? flatten(underPaint, canvas) : underPaint) : canvas;
  const bg = paint.color.length === 9 ? flatten(paint.color, under) : paint.color;
  return { ratio: contrastRatio(fc.length === 9 ? flatten(fc, bg) : fc, bg), bg };
}

/** Relative luminance of a hex colour (0 black – 1 white). */
const luminance = (hex: string) => {
  const c = converter("rgb")(hex);
  if (!c) return 0;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
};

/**
 * Text and icons inside components must be legible on the fills they sit on, fixed in the way that
 * keeps the design's intent: a translucent "glass" fill gets more transparent before its white
 * label changes; a label keeps its polarity (light stays light) when a role of that polarity
 * passes; only then does it flip to the clearest role, or get a nudged literal.
 */
export function fixRecipeContrast(tree: Tree, notes: string[]) {
  const fixed: string[] = [];
  for (const [fg, bg, min, under] of RECIPE_PAIRS) {
    let ts = new TokenSet(tree);
    const w = fillContrast(ts, fg, bg, under);
    if (!w || w.ratio >= min) continue;
    // 1. A translucent literal fill: lower its alpha until the label reads.
    const fillTok = ts.get(bg);
    const lit = fillTok && !fillTok.aliasOf && typeof fillTok.value === "string" && fillTok.value.length === 9 ? fillTok.value : null;
    if (lit) {
      const alpha = parseInt(lit.slice(7), 16);
      let done = false;
      for (let a = alpha - 8; a >= 0 && !done; a -= 8) {
        setToken(tree, bg, { $type: "color", $value: `${lit.slice(0, 7)}${a.toString(16).padStart(2, "0").toUpperCase()}` });
        ts = new TokenSet(tree);
        if ((fillContrast(ts, fg, bg, under)?.ratio ?? 0) >= min) done = true;
      }
      if (done) {
        fixed.push(`${bg.slice(10)} made more transparent`);
        continue;
      }
      setToken(tree, bg, { $type: "color", $value: lit });
      ts = new TokenSet(tree);
    }
    // 2–3. A role of the same polarity that passes, else the clearest role that does.
    const icon = /icon$/.test(fg);
    const light = luminance((ts.color(fg) ?? "#000000").slice(0, 7)) > 0.5;
    const passing = (icon ? ICON_ROLES : TEXT_ROLES)
      .map((role) => ({ role, c: fillContrast(ts, role, bg, under), light: luminance((ts.color(role) ?? "#000000").slice(0, 7)) > 0.5 }))
      .filter((x) => x.c && x.c.ratio >= min)
      .sort((a, b) => b.c!.ratio - a.c!.ratio);
    const pick = passing.find((x) => x.light === light) ?? passing[0];
    if (pick) setToken(tree, fg, { $value: `{${pick.role}}` });
    // 4. Nothing in the system passes: nudge the colour itself.
    else setToken(tree, fg, { $type: "color", $value: fixContrast(ts.color(fg)!.slice(0, 7), w.bg, min) });
    fixed.push(`${fg.slice(10)} → ${pick ? pick.role : "a darker/lighter shade"}`);
  }
  if (fixed.length) notes.push(`Made component text and icons legible on their fills (${fixed.length}): ${fixed.slice(0, 5).join(", ")}${fixed.length > 5 ? "…" : ""}.`);
}

/**
 * Pairs a generated system must also pass (the interview owns every colour, so it checks more
 * than extraction can fix): the search placeholder, 3:1 borders and focus rings (WCAG 1.4.11),
 * and white text on the banner accents.
 */
export const INTERVIEW_PAIRS: readonly [string, string, number][] = [
  ["text.tertiary", "bg.canvas", 4.5],
  ["text.tertiary", "bg.surface", 4.5],
  ["text.secondary", "bg.surface-raised", 4.5],
  ["border.default", "bg.canvas", 3],
  ["border.strong", "bg.canvas", 3],
  ["border.focus", "bg.canvas", 3],
  ["border.error", "bg.canvas", 3],
  ["text.inverse", "bg.go", 4.5],
  ["text.inverse", "bg.get", 4.5],
  ["text.inverse", "bg.pay", 4.5],
  ["text.primary", "bg.eat", 4.5],
  ["icon.inverse", "bg.inverse", 3],
];

export interface ContrastFailure {
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

/** Every role and recipe pair below its minimum (empty when the system is legible throughout). */
export function contrastFailures(tree: Tree, pairs: readonly (readonly [string, string, number, string?])[] = [...ROLE_CONTRAST_PAIRS, ...INTERVIEW_PAIRS, ...RECIPE_PAIRS]): ContrastFailure[] {
  const ts = new TokenSet(tree);
  const out: ContrastFailure[] = [];
  for (const [fg, bg, min, under] of pairs) {
    const c = fillContrast(ts, fg, bg, under);
    if (c && c.ratio < min - 1e-6) out.push({ fg, bg, ratio: Math.round(c.ratio * 100) / 100, min });
  }
  return out;
}
