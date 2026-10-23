import type { Platform } from "../platform";
import type { Knobs } from "./knobs";

/**
 * Knobs → everything that isn't a colour role: radii, spacing and heights, the type scale,
 * shadows, and the recipes the "controls" and "depth" knobs choose between. Pure tables, so a
 * knob's effect can be read here and tested. Paths not set here are completed from the contract's
 * neutral defaults (never the built-in system's look).
 */

export type Entry = [path: string, node: { $type?: string; $value: unknown; $description?: string }];

const RADIUS_FACTOR = { none: 0, small: 0.75, medium: 1, large: 1.5, full: 1.5 } as const;
export const DENSITY_SCALE = { compact: 0.9, snug: 0.95, regular: 1, comfortable: 1.05, spacious: 1.1 } as const;

const px = (n: number) => `${n}px`;
const r2 = (n: number) => Math.round(n / 2) * 2;
const r4 = (n: number) => Math.round(n / 4) * 4;
const ref = (p: string) => `{${p}}`;
const dim = (path: string, n: number): Entry => [path, { $type: "dimension", $value: px(n) }];
const alias = (path: string, to: string): Entry => [path, { $value: ref(to) }];
const str = (path: string, v: string): Entry => [path, { $type: "string", $value: v }];

function radii(k: Knobs): Entry[] {
  const f = RADIUS_FACTOR[k.radius];
  const pills = k.radius === "full";
  const roundish = k.radius === "large" || k.radius === "full" || k.radius === "medium";
  return [
    dim("radius.none", 0),
    dim("radius.xs", Math.round(4 * f)),
    dim("radius.sm", Math.round(8 * f)),
    dim("radius.md", Math.round(12 * f)),
    dim("radius.lg", Math.round(16 * f)),
    dim("radius.xl", Math.round(24 * f)),
    dim("radius.pill", 999),
    alias("component.button.radius", pills ? "radius.pill" : "radius.sm"),
    alias("component.icon-button.radius", pills ? "radius.pill" : "radius.sm"),
    alias("component.input.radius", pills ? "radius.md" : "radius.sm"),
    alias("component.chip.radius", roundish ? "radius.pill" : "radius.xs"),
    alias("component.tag.radius", k.radius === "large" || pills ? "radius.pill" : "radius.xs"),
    alias("component.segmented.radius", roundish ? "radius.pill" : "radius.sm"),
    alias("component.tabs.pill-radius", roundish ? "radius.pill" : "radius.sm"),
    alias("component.list-item.leading-radius", k.radius === "none" ? "radius.none" : k.radius === "small" ? "radius.sm" : "radius.pill"),
    alias("component.tile.icon-radius", k.radius === "none" ? "radius.none" : k.radius === "small" ? "radius.md" : "radius.pill"),
    alias("component.card.radius", "radius.md"),
    alias("component.tile.radius", "radius.md"),
    alias("component.media.radius", "radius.md"),
    alias("component.table.radius", "radius.sm"),
    alias("component.alert.radius", "radius.sm"),
    alias("component.banner.radius", "radius.lg"),
    alias("component.sheet.radius", "radius.lg"),
    alias("component.chart.bar-radius", "radius.xs"),
    alias("component.nav-bar.radius", "radius.pill"),
  ];
}

const SPACE = [["200", 8], ["300", 12], ["400", 16], ["500", 20], ["600", 24], ["800", 32], ["1000", 40], ["1200", 48]] as const;

function density(k: Knobs, platform?: Platform): Entry[] {
  const s = DENSITY_SCALE[k.density];
  const touch = platform === "mobile" ? 44 : 32;
  const out: Entry[] = [dim("space.0", 0), dim("space.50", 2), dim("space.100", 4)];
  let last = 4;
  for (const [step, base] of SPACE) {
    const v = Math.max(last + 2, r2(base * s));
    out.push(dim(`space.${step}`, v));
    last = v;
  }
  const md = Math.max(touch, r4(44 * s));
  out.push(
    dim("size.touch-min", 44),
    dim("component.button.height-sm", Math.max(28, Math.min(md - 4, r4(36 * s)))),
    dim("component.button.height-md", md),
    dim("component.button.height-lg", Math.max(md + 4, 44, r4(52 * s))),
    dim("component.input.height", Math.max(40, r4(48 * s))),
    dim("component.chip.height", r2(36 * s)),
    dim("component.tag.height", r2(24 * s)),
    dim("component.list-item.min-height", Math.max(48, r4(56 * s))),
    dim("component.table.row-height", Math.max(36, r4(52 * s))),
    dim("component.top-bar.height", Math.max(48, r4(56 * s))),
    dim("component.nav-bar.height", Math.max(48, r4(52 * s))),
    dim("component.tile.height", r4(92 * s)),
    dim("component.tabs.height", Math.max(40, r4(44 * s))),
    s < 1 ? dim("component.icon-button.size", platform === "mobile" ? 44 : 40) : alias("component.icon-button.size", "size.touch-min"),
    alias("component.search.height", "component.input.height"),
    alias("layout.gutter", "space.400"),
    alias("layout.section-gap", s < 0.97 ? "space.500" : s > 1.02 ? "space.800" : "space.600"),
    alias("layout.footer-gap", "space.300"),
  );
  return out;
}

/** Body size × ratio^n, rounded to whole pixels (even from 20 up). */
function typeScale(k: Knobs): Entry[] {
  const b = Number(k.bodySize);
  const r = Number(k.typeRatio);
  const size = (n: number) => {
    const v = Math.round(b * r ** n);
    return v >= 20 ? r2(v) : v;
  };
  const heading = r <= 1.2 ? 600 : 700;
  const lh = (s: number, f: number) => r2(s * f);
  const style = (family: string, weight: number, fontSize: number, lineHeight: number, tracking = 0) => ({
    $type: "typography",
    $value: { fontFamily: ref(family), fontWeight: weight, fontSize: px(fontSize), lineHeight: px(lineHeight), letterSpacing: px(Math.round(tracking * 10) / 10) },
  });
  const caption = Math.max(11, Math.round(b / r));
  const label = Math.round(b / Math.sqrt(r));
  const display = size(4);
  return [
    ["font.family.latin", { $type: "fontFamily", $value: k.font }],
    ["font.family.arabic", { $type: "fontFamily", $value: k.arabicFont }],
    ["font.family.fallback", { $type: "fontFamily", $value: k.font }],
    ["font.family.display", k.displayFont === "same" ? { $value: ref("font.family.latin") } : { $type: "fontFamily", $value: k.displayFont }],
    ["type.display", style("font.family.display", 700, display, lh(display, 1.2), -0.02 * display)],
    ["type.title-lg", style("font.family.display", heading, size(3), lh(size(3), 1.25), -0.01 * size(3))],
    ["type.title", style("font.family.display", heading, size(2), lh(size(2), 1.3))],
    ["type.headline", style("font.family.latin", heading, size(1), lh(size(1), 1.35))],
    ["type.body", style("font.family.latin", 400, b, lh(b, 1.5))],
    ["type.body-strong", style("font.family.latin", 600, b, lh(b, 1.5))],
    ["type.label", style("font.family.latin", 600, label, lh(label, 1.4))],
    ["type.caption", style("font.family.latin", 400, caption, lh(caption, 1.4))],
    ["type.caption-strong", style("font.family.latin", 600, caption, lh(caption, 1.4))],
  ];
}

/** Shadow layers tinted with the system's ink (never pure black). */
function shadows(k: Knobs, ink: string, focus: string): Entry[] {
  const layer = (y: number, blur: number, alpha: number, extra: object = {}) => ({
    color: `${ink}${Math.round(alpha * 255).toString(16).padStart(2, "0").toUpperCase()}`,
    offsetX: "0px",
    offsetY: px(y),
    blur: px(blur),
    spread: "0px",
    ...extra,
  });
  const sets = {
    flat: { sm: [layer(1, 2, 0.04)], md: [layer(4, 12, 0.08)], lg: [layer(8, 24, 0.1)] },
    hairline: { sm: [layer(1, 2, 0.05)], md: [layer(4, 16, 0.08)], lg: [layer(12, 32, 0.12)] },
    soft: { sm: [layer(2, 8, 0.08)], md: [layer(8, 24, 0.12)], lg: [layer(16, 40, 0.14)] },
    layered: { sm: [layer(1, 2, 0.06), layer(2, 8, 0.06)], md: [layer(2, 4, 0.06), layer(8, 24, 0.1)], lg: [layer(4, 8, 0.06), layer(16, 40, 0.14)] },
  }[k.elevation];
  return [
    ["shadow.none", { $type: "shadow", $value: [] }],
    ["shadow.sm", { $type: "shadow", $value: sets.sm }],
    ["shadow.md", { $type: "shadow", $value: sets.md }],
    ["shadow.lg", { $type: "shadow", $value: sets.lg }],
    ["shadow.inset", { $type: "shadow", $value: [layer(1, 2, 0.06, { inset: true })] }],
    ["shadow.focus", { $type: "shadow", $value: [{ color: `${focus}3D`, offsetX: "0px", offsetY: "0px", blur: "0px", spread: "3px" }] }],
  ];
}

/** How surfaces separate: borders (hairline), shadows (soft, layered) or fills alone (flat). */
function depth(k: Knobs): Entry[] {
  const e = k.elevation;
  const lined = e === "hairline";
  const shadowed = e === "soft" || e === "layered";
  return [
    alias("component.card.raised.shadow", shadowed ? "shadow.sm" : "shadow.none"),
    alias("component.card.raised.border-width", lined ? "border-width.hairline" : "border-width.none"),
    alias("component.card.raised.border", "border.subtle"),
    alias("component.card.flat.border-width", lined ? "border-width.hairline" : "border-width.none"),
    alias("component.card.flat.shadow", "shadow.none"),
    alias("component.top-bar.border-width", lined ? "border-width.hairline" : "border-width.none"),
    alias("component.top-bar.shadow", e === "layered" ? "shadow.sm" : "shadow.none"),
    alias("component.top-bar.fill", "bg.canvas"),
    alias("component.nav-bar.border-width", shadowed ? "border-width.none" : "border-width.hairline"),
    alias("component.nav-bar.shadow", e === "layered" ? "shadow.md" : "shadow.none"),
    alias("component.nav-bar.fill", e === "layered" ? "bg.surface-raised" : "bg.canvas"),
    alias("component.segmented.selected.shadow", shadowed ? "shadow.sm" : "shadow.none"),
    alias("component.tile.fill", shadowed ? "bg.surface-raised" : "bg.surface"),
    alias("component.tile.shadow", e === "layered" ? "shadow.sm" : "shadow.none"),
    alias("component.tile.border-width", lined ? "border-width.hairline" : "border-width.none"),
    alias("component.button.shadow", "shadow.none"),
    alias("component.input.shadow", "shadow.none"),
    alias("component.sheet.shadow", "shadow.md"),
    alias("component.banner.shadow", e === "layered" ? "shadow.sm" : "shadow.none"),
  ];
}

/** Secondary controls: a quiet fill (solid), a brand tint (tonal) or a border (outline). The primary button is always the solid brand fill. */
function fills(k: Knobs): Entry[] {
  const f = k.fill;
  const tonal = f === "tonal";
  const outline = f === "outline";
  return [
    alias("component.button.primary.fill", "bg.brand-strong"),
    alias("component.button.primary.label", "text.on-brand-strong"),
    alias("component.button.primary.icon", "icon.on-brand-strong"),
    alias("component.button.secondary.fill", tonal ? "bg.brand-subtle" : outline ? "bg.canvas" : "bg.surface"),
    alias("component.button.secondary.label", tonal ? "text.link" : "text.primary"),
    alias("component.button.secondary.icon", tonal ? "icon.brand" : "icon.primary"),
    alias("component.button.secondary.border", "border.default"),
    alias("component.button.secondary.border-width", outline ? "border-width.default" : "border-width.none"),
    alias("component.chip.fill", outline ? "bg.canvas" : "bg.surface"),
    alias("component.chip.label", "text.primary"),
    alias("component.chip.border", "border.default"),
    alias("component.chip.border-width", outline ? "border-width.default" : "border-width.none"),
    alias("component.chip.selected.fill", tonal ? "bg.brand-subtle" : "bg.brand-strong"),
    alias("component.chip.selected.label", tonal ? "text.link" : "text.on-brand-strong"),
    alias("component.icon-button.outline-fill", tonal ? "bg.brand-subtle" : outline ? "bg.canvas" : "bg.surface"),
    alias("component.icon-button.icon", tonal ? "icon.brand" : "icon.primary"),
    alias("component.icon-button.border", "border.default"),
    alias("component.icon-button.border-width", outline ? "border-width.default" : "border-width.none"),
    alias("component.icon-button.brand-fill", "bg.brand-strong"),
    alias("component.icon-button.brand-icon", "icon.on-brand-strong"),
    alias("component.tabs.indicator", "bg.brand-strong"),
    alias("component.tabs.pill-fill", tonal ? "bg.brand-subtle" : "bg.surface"),
    str("component.tabs.style.indicator", tonal ? "pill" : "underline"),
    alias("component.nav-bar.active", "icon.brand"),
    alias("component.nav-bar.inactive", "icon.secondary"),
    alias("component.nav-bar.indicator-fill", "bg.brand-subtle"),
    str("component.nav-bar.style.indicator", tonal ? "pill" : outline ? "line" : "none"),
    str("component.list-item.style.leading", outline ? "bare" : "contained"),
    alias("component.list-item.leading-fill", tonal ? "bg.brand-subtle" : "bg.surface"),
    alias("component.tile.icon-fill", tonal ? "bg.brand-subtle" : outline ? "bg.canvas" : "bg.surface-raised"),
    alias("component.tile.icon", "icon.brand"),
    alias("component.input.fill", "bg.canvas"),
    alias("component.input.border", "border.default"),
    alias("component.input.border-width", "border-width.default"),
    alias("component.media.fill", "bg.brand-subtle"),
    alias("component.card.brand-fill", "bg.brand-strong"),
    alias("component.banner.brand.fill", "bg.brand-strong"),
    alias("component.banner.brand.title", "text.on-brand-strong"),
    alias("component.banner.brand.body", "text.on-brand-strong"),
    alias("component.tag.promo-fill", "feedback.error"),
    alias("component.tag.promo-label", "text.inverse"),
    alias("component.empty.art-fill", "bg.brand-subtle"),
    alias("component.empty.art-icon", "icon.brand"),
  ];
}

export interface RecipeContext {
  platform?: Platform;
  /** Shadow ink (the darkest neutral) and focus ring colour. */
  ink: string;
  focus: string;
}

export function recipeEntries(k: Knobs, ctx: RecipeContext): Entry[] {
  return [
    ...radii(k),
    ...density(k, ctx.platform),
    ...typeScale(k),
    ...shadows(k, ctx.ink.slice(0, 7), ctx.focus.slice(0, 7)),
    ...depth(k),
    ...fills(k),
    ["border-width.none", { $type: "dimension", $value: "0px" }],
    ["border-width.hairline", { $type: "dimension", $value: "1px" }],
    ["border-width.default", { $type: "dimension", $value: "1px" }],
    ["border-width.strong", { $type: "dimension", $value: "2px" }],
  ];
}

/** Font weights the type scale uses (to warn when a family lacks one). */
export const USED_WEIGHTS = [400, 600, 700] as const;
