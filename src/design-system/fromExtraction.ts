import { nanoid } from "nanoid";
import { differenceCiede2000, parse } from "culori";
import type { FoundationsResult, GuideResult, ColorRole, ShadowLayer, ElementBox, MeasuredKind } from "@/ai/ds-schemas";
import { CATALOG, CATALOG_BY_NAME } from "./components";
import { ROLE_SPECS, completeTree, isValid, setToken, validateTree } from "./contract";
import { BUILTIN, TokenSet, contrastRatio, isRolePath, normalizeHex, type Tree } from "./resolve";
import { ROLE_CONTRAST_PAIRS, fixContrast, fixRecipeContrast } from "./contrast";

export { fixRecipeContrast };
import { BUILTIN_LANGUAGE, BUILTIN_LAYOUT, emptyGuide, type ComponentGuide, type DesignDocs, type Pattern } from "./docs";
import { sampleRegion } from "./extract";
import { measureElement, toLogical, type Capture, type Measured } from "./pixels";
import type { Inst } from "./builders";
import { withProps } from "./component-props";
import { cleanProps } from "./custom";
import { STYLED_GROUPS } from "./recipes";
import { isStylePath } from "./styles";
import { neutralOf } from "./neutral";
import { applyStructure } from "./structure";
import { measureStructure, type StructureEvidence } from "./structure-pixels";
import type { DesignSystem, FontRef } from "./registry";

/**
 * Turn the model's extraction into a complete, standalone design system. The model names and
 * estimates; the code measures and enforces: colours are re-sampled from the pixels where the model
 * pointed, numbers are clamped, text roles are nudged to pass contrast, and every contract path is
 * filled so any screen can be built with the result.
 */

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const pxv = (n: number) => `${Math.round(n * 10) / 10}px`;
const kebab = (s: string) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
const FONT_NAME = /^[A-Za-z0-9 ]{1,40}$/;
const deltaE = differenceCiede2000();

function get(obj: unknown, path: string): unknown {
  let n = obj;
  for (const k of path.split(".")) {
    if (!n || typeof n !== "object") return undefined;
    n = (n as Record<string, unknown>)[k];
  }
  return n;
}


export interface ConvertInput {
  foundations: FoundationsResult;
  guide?: GuideResult | null;
  /** Pixels of each image as sent, in order. */
  pixels?: ImageData | ImageData[];
  /** What the studio read from each capture's size, in order. */
  captures?: Capture[];
  thumbnail?: string;
  /** "asset:" references of the source screenshots, kept as the system's visual reference. */
  sources?: string[];
  /**
   * Recipe groups (`component.<group>`) to take from the model; groups of other catalog components
   * keep the default recipe. Undefined = every group.
   */
  recipeGroups?: string[];
  /** Component structure read from the pixels; measured from `pixels` when omitted. */
  evidence?: StructureEvidence;
}

export function designSystemFromExtraction({ foundations: raw, guide, pixels, captures = [], thumbnail, sources, recipeGroups, evidence }: ConvertInput): DesignSystem {
  const notes: string[] = [];
  const images = pixels ? (Array.isArray(pixels) ? pixels : [pixels]) : [];
  const imageAt = (n: unknown) => images[Math.max(0, Math.min(images.length - 1, Math.round(Number(n) || 1) - 1))];
  // The studio read the scale from the capture size; a model that assumed another one reported
  // every px value off by the ratio, so bring them back.
  const cap0 = captures[0];
  const modelScale = Number(raw.scale);
  const f =
    cap0?.confident && Number.isFinite(modelScale) && modelScale > 0 && Math.abs(modelScale / cap0.scale - 1) > 0.05 ? rescaleFoundations(raw, modelScale / cap0.scale) : raw;
  if (f !== raw) notes.push(`The model measured at ${modelScale}× but the capture is ${cap0!.scale}×; every size was rescaled by ${Math.round((modelScale / cap0!.scale) * 100) / 100}.`);
  const tree: Tree = { $description: `Extracted from a screenshot. ${String(f.summary ?? "").slice(0, 400)}` };
  const set = (path: string, type: string, value: unknown, description?: string) =>
    setToken(tree, path, { $type: type, $value: value, ...(description ? { $description: description } : {}) });

  // Primitive ramps
  const prim = new Map<string, string>(); // hex -> path
  for (const p of Array.isArray(f.primitives) ? f.primitives : []) {
    const hex = normalizeHex(String(p?.hex ?? ""));
    const [group, ...rest] = kebab(p?.name ?? "").split(".");
    const step = rest.join("-") || "base";
    if (!hex || !group) continue;
    const path = `color.${group}.${step}`;
    if (prim.has(hex)) continue;
    set(path, "color", hex);
    prim.set(hex, path);
  }

  // Colour roles: snap to measured pixels, then alias the matching primitive.
  const colorRoles = ROLE_SPECS.filter((r) => r.type === "color" && isRolePath(r.path));
  const picked = new Map<string, string>();
  let snapped = 0;
  for (const r of colorRoles) {
    const role = get(f.colors, r.path) as ColorRole | undefined;
    let hex = normalizeHex(String(role?.hex ?? "")) ?? BUILTIN.color(r.path)!;
    if (role?.source === "observed" && images.length && Array.isArray(role.bbox) && role.bbox.length === 4 && hex.length === 7) {
      // Trust the pixels when the region is flat (the model pointed at a solid fill) or close anyway.
      const m = sampleRegion(imageAt(role.image), role.bbox);
      const a = parse(m?.hex ?? ""), b = parse(hex);
      if (m && a && b && m.hex !== hex) {
        const d = deltaE(a, b);
        if (d < 3 || (m.coverage >= 0.6 && d < 15)) {
          hex = m.hex;
          snapped++;
        }
      }
    }
    picked.set(r.path, hex);
  }
  if (snapped) notes.push(`Snapped ${snapped} colour${snapped > 1 ? "s" : ""} to the exact pixel values in the screenshot.`);

  // Text and icon roles must stay legible on the surfaces they're used on.
  const pairs = ROLE_CONTRAST_PAIRS;
  for (const [fg, bg, min] of pairs) {
    const before = picked.get(fg)!, after = fixContrast(before, picked.get(bg)!, min);
    if (after !== before) {
      picked.set(fg, after);
      notes.push(`Adjusted ${fg} ${before} → ${after} to reach ${min}:1 on ${bg}.`);
    }
  }
  // Accents the screenshots didn't show were invented to fill the system: make them dark enough
  // for white banner text (as the built-in accents are), rather than bending every banner's text.
  for (const accent of ["bg.go", "bg.get", "bg.pay"]) {
    if ((get(f.colors, accent) as ColorRole | undefined)?.source === "observed") continue;
    const before = picked.get(accent)!, after = fixContrast(before, picked.get("text.inverse")!, 4.5);
    if (after !== before) {
      picked.set(accent, after);
      notes.push(`Darkened the inferred accent ${accent} ${before} → ${after} so white text reads on it.`);
    }
  }
  // A colour snapped to the pixels usually sits a hair off the palette entry the model named: move
  // that entry to the measured value (when no other role uses it as it was) so the role stays an
  // alias into the palette.
  const usedExactly = new Set(colorRoles.map((r) => picked.get(r.path)!).filter((h) => prim.has(h)));
  for (const r of colorRoles) {
    const hex = picked.get(r.path)!;
    if (prim.has(hex) || hex.length !== 7) continue;
    const c = parse(hex);
    let near: [string, string, number] | null = null;
    for (const [ph, path] of prim) {
      const pc = parse(ph);
      const dE = c && pc ? deltaE(c, pc) : Infinity;
      if (dE < 2.5 && (!near || dE < near[2])) near = [ph, path, dE];
    }
    if (!near || usedExactly.has(near[0])) continue;
    prim.delete(near[0]);
    prim.set(hex, near[1]);
    set(near[1], "color", hex);
  }
  for (const r of colorRoles) {
    const hex = picked.get(r.path)!;
    const role = get(f.colors, r.path) as ColorRole | undefined;
    const desc = role?.source === "observed" ? `Observed: ${String(role.evidence ?? "").slice(0, 160)}` : "Inferred";
    set(r.path, "color", prim.has(hex) ? `{${prim.get(hex)}}` : hex, desc);
  }

  // Fonts: tokens name families we can render (the Google match); the identified face is noted.
  const font = (g: FoundationsResult["fonts"]["latin"] | undefined, fallback: string) => {
    const name = String(g?.googleFont ?? "").trim();
    if (g?.identified && name && g.identified !== name) notes.push(`Identified “${g.identified}”; rendering with ${name}, the closest Google Font.`);
    return FONT_NAME.test(name) ? name : fallback;
  };
  const latin = font(f.fonts?.latin, "Inter");
  const display = f.fonts?.display?.googleFont?.trim() === latin ? latin : font(f.fonts?.display, latin);
  const arabic = FONT_NAME.test(String(f.fonts?.arabic ?? "").trim()) ? String(f.fonts.arabic).trim() : "IBM Plex Sans Arabic";
  set("font.family.latin", "fontFamily", latin);
  set("font.family.display", "fontFamily", display);
  set("font.family.arabic", "fontFamily", arabic);
  set("font.family.fallback", "fontFamily", latin);
  const fonts: FontRef[] = [...new Set([latin, display, arabic])].map((family) => ({ family, googleFont: family }));

  // Type scale
  for (const r of ROLE_SPECS.filter((x) => x.type === "typography")) {
    const t = get(f.type, r.path.slice(5)) as Record<string, unknown> | undefined;
    const b = BUILTIN.typography(r.path)!;
    const size = clamp(t?.size, 9, 96, b.fontSize);
    set(r.path, "typography", {
      fontFamily: t?.family === "display" ? "{font.family.display}" : "{font.family.latin}",
      fontWeight: Math.round(clamp(t?.weight, 100, 900, b.fontWeight) / 100) * 100,
      fontSize: pxv(size),
      lineHeight: pxv(Math.round(clamp(t?.lineHeight, size * 1.1, size * 2.2, Math.max(size * 1.3, b.lineHeight)))),
      letterSpacing: pxv(clamp(t?.letterSpacing, -3, 3, 0)),
    });
  }

  // Dimensions
  const dims = (group: Record<string, unknown> | undefined, prefix: string, lo: number, hi: number) => {
    for (const r of ROLE_SPECS.filter((x) => x.path.startsWith(prefix) && x.type === "dimension")) {
      const key = r.path.slice(prefix.length);
      set(r.path, "dimension", pxv(clamp(group?.[key], lo, hi, BUILTIN.dimension(r.path)!)));
    }
  };
  dims(f.radius, "radius.", 0, 999);
  if (clamp(f.radius?.pill, 0, 999, 999) >= 64) set("radius.pill", "dimension", "999px");
  set("radius.none", "dimension", "0px");
  dims(f.space, "space.", 0, 160);
  set("space.0", "dimension", "0px");
  orderScale(tree, ["radius.xs", "radius.sm", "radius.md", "radius.lg", "radius.xl"], notes, "radius");
  const base = clamp(f.space?.baseUnit, 2, 16, 0);
  const spaceSteps = ROLE_SPECS.filter((r) => r.path.startsWith("space.") && r.path !== "space.0" && r.type === "dimension")
    .map((r) => r.path)
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  if (base) snapToGrid(tree, spaceSteps, base, notes);
  orderScale(tree, spaceSteps, notes, "spacing");
  dims(f.size, "size.", 12, 64);
  dims(f.borderWidth, "border-width.", 0, 8);
  set("border-width.none", "dimension", "0px");

  // Shadows, layer by layer
  const layer = (l: ShadowLayer) => ({
    color: normalizeHex(String(l?.color ?? "")) ?? "#0000001A",
    offsetX: pxv(clamp(l?.x, -80, 80, 0)),
    offsetY: pxv(clamp(l?.y, -80, 80, 0)),
    blur: pxv(clamp(l?.blur, 0, 160, 0)),
    spread: pxv(clamp(l?.spread, -40, 40, 0)),
    ...(l?.inset ? { inset: true } : {}),
  });
  for (const r of ROLE_SPECS.filter((x) => x.type === "shadow" && x.path.startsWith("shadow."))) {
    if (r.path === "shadow.none") {
      set(r.path, "shadow", []);
      continue;
    }
    const s = f.shadows?.[r.path.slice(7)];
    const layers = Array.isArray(s?.layers) ? s.layers.slice(0, 4).map(layer) : neutralShadow(r.path, picked.get("text.primary")!);
    set(r.path, "shadow", layers, s?.source === "observed" ? `Observed: ${String(s.evidence ?? "").slice(0, 160)}` : f.shadows ? "Inferred" : "Default (not extracted at this depth)");
  }

  // Gradients (a brand gradient always exists; synthesised from the brand colours if none is seen)
  let brandGradient = false;
  for (const g of Array.isArray(f.gradients) ? f.gradients.slice(0, 8) : []) {
    const name = kebab(g?.name ?? "").replace(/\./g, "-");
    const stops = (Array.isArray(g?.stops) ? g.stops : [])
      .map((s) => ({ color: normalizeHex(String(s?.hex ?? "")), position: clamp(s?.position, 0, 1, 0) }))
      .filter((s): s is { color: string; position: number } => !!s.color);
    if (!name || stops.length < 2) continue;
    set(`gradient.${name}`, "gradient", { kind: g.kind === "radial" ? "radial" : "linear", angle: clamp(g.angle, 0, 360, 180), stops }, String(g.usage ?? "").slice(0, 160));
    if (name === "brand") brandGradient = true;
  }
  if (!brandGradient)
    set("gradient.brand", "gradient", { kind: "linear", angle: 135, stops: [{ color: picked.get("bg.brand-strong"), position: 0 }, { color: picked.get("bg.brand"), position: 1 }] }, "Synthesised from the brand colours");

  // Layout metrics
  for (const k of ["gutter", "section-gap", "footer-gap"]) set(`layout.${k}`, "dimension", pxv(clamp(f.layout?.[k], 4, 48, BUILTIN.dimension(`layout.${k}`)!)));

  // Component recipes: references to roles in this tree, or literals; anything else keeps the
  // built-in recipe, which references roles (so it resolves against this system's values).
  const partial = new TokenSet(tree);
  let kept = 0;
  // Components the designer didn't choose keep the default recipe, whatever the model returned.
  const chosen = recipeGroups ? new Set(recipeGroups) : null;
  const defaulted = new Set<string>();
  for (const r of ROLE_SPECS.filter((x) => x.path.startsWith("component."))) {
    // The default recipe: the built-in one, or its neutral value where the built-in is specific to its own look.
    const builtin = { authored: neutralOf(r.path) ?? BUILTIN.get(r.path)!.authored };
    const group = r.path.split(".").slice(0, 2).join(".");
    if (chosen && STYLED_GROUPS.has(group) && !chosen.has(group)) {
      defaulted.add(group.slice(10));
      setToken(tree, r.path, typeof builtin.authored === "string" && builtin.authored.startsWith("{") ? { $value: builtin.authored } : { $type: r.type, $value: builtin.authored });
      continue;
    }
    // Structure comes from its own section (applyStructure, below); start from the default.
    if (isStylePath(r.path)) {
      setToken(tree, r.path, { $type: "string", $value: builtin.authored });
      continue;
    }
    const v = String(get(f.components, r.path.slice(10)) ?? "").trim();
    const alias = v.match(/^\{([^}]+)\}$/)?.[1];
    let value: unknown;
    if (alias) {
      const target = partial.get(alias);
      const ok = target && (target.type === r.type || (r.type === "color" && target.type === "gradient"));
      if (ok) value = v;
    } else if (r.type === "color") {
      const hex = normalizeHex(v);
      if (hex) value = hex;
    } else if (r.type === "dimension" && /^-?\d+(\.\d+)?(px)?$/.test(v)) {
      value = pxv(clamp(parseFloat(v), 0, 999, 0));
    }
    // A backdrop gradient seen in the screenshots is the system's backdrop.
    if (value === undefined && r.path === "component.backdrop.fill" && partial.get("gradient.backdrop")?.type === "gradient") value = "{gradient.backdrop}";
    if (value === undefined) {
      value = builtin.authored;
      kept++;
    }
    setToken(tree, r.path, typeof value === "string" && value.startsWith("{") ? { $value: value } : { $type: r.type, $value: value });
  }
  // Measured beats estimated: heights, corner radii and side margins read from the pixels.
  applyMeasurements(tree, f.elements, images, captures, notes);
  // How components are built: the model's reading, corrected where the pixels are clear.
  applyStructure(tree, { model: f.structure, evidence: evidence ?? (images.length ? measureStructure(f.elements, images, captures) : undefined), chosen }, notes);

  if (defaulted.size) notes.push(`Kept the default styling for ${defaulted.size} component famil${defaulted.size > 1 ? "ies" : "y"} you didn't choose (${[...defaulted].join(", ")}); they resolve with this system's colours, radii and shadows.`);
  if (!f.components) notes.push("Other component styling uses the default recipes, resolved with this system's colours, radii and shadows (component styling wasn't extracted at this depth).");
  else if (kept) notes.push(`${kept} component recipe value${kept > 1 ? "s" : ""} fell back to the default recipe (resolved with this system's roles).`);
  const skipped = (["borderWidth", "shadows", "gradients", "layout"] as const).filter((k) => !f[k]);
  if (skipped.length) notes.push(`Not extracted at this depth, so neutral defaults were used: ${skipped.map((k) => ({ borderWidth: "border widths", shadows: "shadows", gradients: "gradients", layout: "screen gutters" })[k]).join(", ")}.`);

  const { tree: complete, filled } = completeTree(tree);
  if (filled.length) notes.push(`Filled ${filled.length} missing token${filled.length > 1 ? "s" : ""} with defaults: ${filled.slice(0, 6).join(", ")}${filled.length > 6 ? "…" : ""}`);
  fixRecipeContrast(complete, notes);
  const v = validateTree(complete);
  if (!isValid(v)) throw new Error(`Extracted system is incomplete: ${[...v.missing, ...v.wrongType, ...v.unresolved].slice(0, 5).join(", ")}`);

  const now = Date.now();
  return {
    id: `ds-${nanoid(8)}`,
    name: String(f.name || "Extracted system").slice(0, 60),
    source: "extracted",
    tree: complete,
    docs: guide ? docsFromGuide(guide, notes) : docsFromFoundations(f),
    fonts,
    thumbnail,
    ...(sources?.length ? { sources } : {}),
    notes,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Checks on the model's numbers

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

/** Every px value in the foundations multiplied by `k` (a model that assumed the wrong scale). */
export function rescaleFoundations(f: FoundationsResult, k: number): FoundationsResult {
  const out = structuredClone(f);
  const SKIP = new Set(["weight", "confidence", "image", "bbox", "position", "angle", "scale", "hex", "color"]);
  const walk = (o: unknown): unknown => {
    if (typeof o === "number") return Math.round(o * k * 10) / 10;
    if (typeof o === "string") return /^-?\d+(\.\d+)?px$/.test(o.trim()) ? `${Math.round(parseFloat(o) * k * 10) / 10}px` : o;
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([key, v]) => [key, SKIP.has(key) ? v : walk(v)]));
    return o;
  };
  for (const key of ["type", "radius", "space", "size", "borderWidth", "layout", "shadows", "components"] as const) {
    if (out[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = walk(out[key]);
  }
  // Pills stay pills.
  if (Number(f.radius?.pill) >= 64) out.radius.pill = f.radius.pill;
  return out;
}

/** Steps of a scale must not shrink (radius.sm ≤ radius.md…): if they do, sort the values into the steps. */
function orderScale(tree: Tree, paths: string[], notes: string[], label: string) {
  const ts = new TokenSet(tree);
  const vals = paths.map((p) => ts.dimension(p) ?? 0);
  if (vals.every((v, i) => i === 0 || v >= vals[i - 1])) return;
  const sorted = [...vals].sort((a, b) => a - b);
  paths.forEach((p, i) => setToken(tree, p, { $type: "dimension", $value: pxv(sorted[i]) }));
  notes.push(`Reordered the ${label} scale so each step is at least the one before (${sorted.map((v) => Math.round(v)).join(", ")}px).`);
}

/** Values within 1px of the base grid (the base unit, or half of it for small steps) are snapped onto it. */
function snapToGrid(tree: Tree, paths: string[], base: number, notes: string[]) {
  const ts = new TokenSet(tree);
  let n = 0;
  for (const p of paths) {
    const v = ts.dimension(p);
    if (!v) continue;
    const grid = v >= base * 2 ? base : base / 2;
    const target = Math.round(v / grid) * grid;
    if (target > 0 && target !== v && Math.abs(target - v) <= 1) {
      setToken(tree, p, { $type: "dimension", $value: pxv(target) });
      n++;
    }
  }
  if (n) notes.push(`Snapped ${n} spacing step${n > 1 ? "s" : ""} onto the ${base}px grid.`);
}

const ELEMENT_LABEL: Record<MeasuredKind, string> = {
  "primary-button": "primary button",
  "secondary-button": "secondary button",
  "text-field": "text field",
  card: "card",
  chip: "chip",
  tag: "tag",
  "icon-button": "icon button",
  tile: "tile",
  banner: "banner",
};
/** Measured heights and the recipe each one sets (with a plausible range in px). */
const HEIGHTS: [MeasuredKind, string, number, number][] = [
  ["primary-button", "component.button.height-lg", 28, 72],
  ["text-field", "component.input.height", 32, 72],
  ["chip", "component.chip.height", 20, 56],
  ["tag", "component.tag.height", 14, 40],
  ["tile", "component.tile.height", 48, 180],
];
/** Measured corner radii and the recipe each one sets (the first kind that was measured wins). */
const RADII: [MeasuredKind[], string][] = [
  [["primary-button", "secondary-button"], "component.button.radius"],
  [["text-field"], "component.input.radius"],
  [["card"], "component.card.radius"],
  [["chip"], "component.chip.radius"],
  [["tag"], "component.tag.radius"],
  [["icon-button"], "component.icon-button.radius"],
  [["tile"], "component.tile.radius"],
  [["banner"], "component.banner.radius"],
];
const RADIUS_ROLES = ["radius.none", "radius.xs", "radius.sm", "radius.md", "radius.lg", "radius.xl"];

/**
 * Measure the elements the model pointed at and write what the pixels say into the recipes and the
 * screen gutter. Radii become references to the radius scale when one is within 1.5px.
 */
export function applyMeasurements(tree: Tree, elements: ElementBox[] | undefined, images: ImageData[], captures: Capture[], notes: string[]) {
  if (!Array.isArray(elements) || !elements.length || !images.length || !captures.length) return;
  const by = new Map<MeasuredKind, Measured[]>();
  const gutters: number[] = [];
  for (const e of elements.slice(0, 40)) {
    const i = Math.max(0, Math.min(images.length - 1, Math.round(Number(e?.image) || 1) - 1));
    const cap = captures[i];
    const kind = e.kind as MeasuredKind;
    if (!cap || !ELEMENT_LABEL[kind]) continue;
    const m = measureElement(images[i], e.bbox, toLogical(cap));
    if (!m) continue;
    by.set(kind, [...(by.get(kind) ?? []), m]);
    // Side margins: a full-width element on a phone screen, inset equally on both sides.
    if (cap.kind === "phone" && ["card", "text-field", "primary-button", "secondary-button", "banner"].includes(e.kind)) {
      const left = m.x,
        right = cap.logicalWidth - (m.x + m.w);
      if (m.w >= cap.logicalWidth * 0.6 && Math.abs(left - right) <= 2 && left >= 4 && left <= 48) gutters.push((left + right) / 2);
    }
  }
  if (!by.size && !gutters.length) return;
  const ts = new TokenSet(tree);
  const said: string[] = [];
  const write = (path: string, value: string, label: string) => {
    const before = ts.get(path);
    const beforeText = before ? (typeof before.authored === "string" ? before.authored : `${ts.dimension(path)}px`) : "";
    setToken(tree, path, value.startsWith("{") ? { $value: value } : { $type: "dimension", $value: value });
    if (beforeText !== value) said.push(`${label} ${value}${beforeText ? ` (was ${beforeText})` : ""}`);
  };
  for (const [kind, path, lo, hi] of HEIGHTS) {
    const ms = by.get(kind);
    if (!ms?.length) continue;
    const h = Math.round(median(ms.map((m) => m.h)));
    if (h >= lo && h <= hi) write(path, `${h}px`, `${ELEMENT_LABEL[kind]} height`);
  }
  const icon = by.get("icon-button");
  if (icon?.length) {
    const size = Math.round(median(icon.map((m) => Math.max(m.w, m.h))));
    if (size >= 28 && size <= 64) write("component.icon-button.size", `${size}px`, "icon button size");
  }
  for (const [kinds, path] of RADII) {
    const ms = kinds.map((k) => by.get(k)).find((x) => x?.length);
    if (!ms) continue;
    const label = `${ELEMENT_LABEL[kinds[0]].replace("primary ", "")} corners`;
    if (ms.filter((m) => m.pill).length > ms.length / 2) {
      write(path, "{radius.pill}", label);
      continue;
    }
    const r = median(ms.map((m) => m.radius));
    const role = RADIUS_ROLES.map((p) => [p, ts.dimension(p)] as const)
      .filter((x): x is readonly [string, number] => x[1] !== undefined)
      .sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0];
    write(path, role && Math.abs(role[1] - r) <= 1.5 ? `{${role[0]}}` : `${Math.round(r)}px`, label);
  }
  if (gutters.length) write("layout.gutter", `${Math.round(median(gutters))}px`, "side margins");
  // The measured large button is the ceiling: smaller sizes stay below it.
  const lg = new TokenSet(tree).dimension("component.button.height-lg");
  if (by.get("primary-button")?.length && lg) {
    const t2 = new TokenSet(tree);
    const md = Math.min(t2.dimension("component.button.height-md") ?? lg, lg - 4);
    const sm = Math.min(t2.dimension("component.button.height-sm") ?? md, md - 4);
    if (md !== t2.dimension("component.button.height-md")) setToken(tree, "component.button.height-md", { $type: "dimension", $value: pxv(Math.max(28, md)) });
    if (sm !== t2.dimension("component.button.height-sm")) setToken(tree, "component.button.height-sm", { $type: "dimension", $value: pxv(Math.max(24, sm)) });
  }
  if (said.length) notes.push(`Measured in the pixels: ${said.join("; ")}.`);
}


/** Built-in shadow geometry tinted with this system's ink colour, for depths that skip shadows. */
function neutralShadow(path: string, ink: string) {
  const layers = BUILTIN.shadowLayers(path) ?? [];
  const rgb = ink.slice(0, 7);
  return layers.map((l) => ({
    color: `${rgb}${l.color.length === 9 ? l.color.slice(7) : "FF"}`,
    offsetX: pxv(l.x),
    offsetY: pxv(l.y),
    blur: pxv(l.blur),
    spread: pxv(l.spread),
    ...(l.kind === "inner" ? { inset: true } : {}),
  }));
}

/** Until the written guide arrives (or if it fails), docs come from the foundations pass. */
export function docsFromFoundations(f: FoundationsResult): DesignDocs {
  return {
    language: { ...BUILTIN_LANGUAGE, name: String(f.name || "Extracted"), summary: String(f.summary ?? ""), personality: [], principles: [], dos: [], donts: [], color: "", typography: "", shape: "", depth: "", density: "", iconography: "", imagery: "", voice: "" },
    layout: { ...BUILTIN_LAYOUT, summary: "", templates: [], rules: [] },
    components: CATALOG.map((c) => emptyGuide(c.name, c.description)),
    patterns: [],
  };
}

const strList = (v: unknown, n = 12) => (Array.isArray(v) ? v.slice(0, n).map((x) => String(x).slice(0, 300)) : []);

function cleanGuide(g: Partial<ComponentGuide> | undefined, component: string): ComponentGuide {
  return {
    component,
    observed: !!g?.observed,
    purpose: String(g?.purpose ?? "").slice(0, 600),
    whenToUse: strList(g?.whenToUse),
    whenNotToUse: strList(g?.whenNotToUse),
    anatomy: strList(g?.anatomy),
    variants: (Array.isArray(g?.variants) ? g.variants : []).slice(0, 10).map((v) => ({ name: String(v?.name ?? "").slice(0, 60), usage: String(v?.usage ?? "").slice(0, 300) })),
    content: String(g?.content ?? "").slice(0, 600),
    placement: String(g?.placement ?? "").slice(0, 600),
    states: String(g?.states ?? "").slice(0, 600),
    dos: strList(g?.dos),
    donts: strList(g?.donts),
    tokens: strList(g?.tokens, 20),
  };
}

/** Every component in a composition must be in the catalog (patterns are built from it). */
function validComposition(i: Inst | undefined, depth = 0): boolean {
  if (!i || typeof i !== "object" || depth > 4 || !CATALOG_BY_NAME.has(i.component)) return false;
  return (i.children ?? []).every((c) => validComposition(c, depth + 1));
}

/**
 * Merge the written guide into `base`: sections the designer skipped (or the model left out) keep
 * the base version.
 */
export function docsFromGuide(g: GuideResult, notes: string[] = [], base?: DesignDocs): DesignDocs {
  const byName = new Map((Array.isArray(g.components) ? g.components : []).map((c) => [c.component, c]));
  const patterns: Pattern[] = [];
  for (const p of Array.isArray(g.patterns) ? g.patterns.slice(0, 6) : []) {
    const name = String(p?.name ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
    if (!name) continue;
    if (!validComposition(p.composition)) {
      notes.push(`Dropped pattern ${name}: its composition uses components outside the catalog.`);
      continue;
    }
    // Props make it a component screens place by name (a copy of its parts drifts); read from its parts when the model gave none.
    patterns.push(withProps({ name, purpose: String(p.purpose ?? "").slice(0, 300), guide: cleanGuide(p.guide, name), props: cleanProps(p.props), composition: p.composition }));
  }
  const fallback = base ?? { ...BUILTIN_DOCS_EMPTY };
  const l = g.language;
  const lay = g.layout;
  return {
    language: !l ? fallback.language : {
      name: String(l.name ?? "").slice(0, 80),
      summary: String(l.summary ?? "").slice(0, 1200),
      personality: strList(l.personality, 6),
      principles: (Array.isArray(l.principles) ? l.principles : []).slice(0, 8).map((p) => ({ title: String(p?.title ?? "").slice(0, 80), body: String(p?.body ?? "").slice(0, 400) })),
      color: String(l.color ?? "").slice(0, 800),
      typography: String(l.typography ?? "").slice(0, 800),
      shape: String(l.shape ?? "").slice(0, 800),
      depth: String(l.depth ?? "").slice(0, 800),
      density: String(l.density ?? "").slice(0, 800),
      iconography: String(l.iconography ?? "").slice(0, 600),
      imagery: String(l.imagery ?? "").slice(0, 600),
      voice: String(l.voice ?? "").slice(0, 600),
      dos: strList(l.dos),
      donts: strList(l.donts),
    },
    layout: !lay ? fallback.layout : {
      summary: String(lay.summary ?? "").slice(0, 1200),
      density: lay.density === "compact" || lay.density === "airy" ? lay.density : "regular",
      grid: String(lay.grid ?? "").slice(0, 600),
      rhythm: String(lay.rhythm ?? "").slice(0, 600),
      navigation: String(lay.navigation ?? "").slice(0, 600),
      hierarchy: String(lay.hierarchy ?? "").slice(0, 600),
      templates: (Array.isArray(lay.templates) ? lay.templates : []).slice(0, 6).map((t) => ({
        name: String(t?.name ?? "").slice(0, 60),
        whenToUse: String(t?.whenToUse ?? "").slice(0, 300),
        regions: (Array.isArray(t?.regions) ? t.regions : []).slice(0, 4).map((r) => ({
          region: r?.region === "header" || r?.region === "hero" || r?.region === "footer" ? r.region : "body",
          components: strList(r?.components, 10).filter((c) => CATALOG_BY_NAME.has(c)),
          notes: String(r?.notes ?? "").slice(0, 200),
        })),
      })),
      rules: strList(lay.rules),
    },
    components: CATALOG.map((c) => (byName.has(c.name) ? cleanGuide(byName.get(c.name), c.name) : (fallback.components.find((x) => x.component === c.name) ?? emptyGuide(c.name, c.description)))),
    patterns: g.patterns ? patterns : fallback.patterns,
  };
}

const BUILTIN_DOCS_EMPTY: DesignDocs = {
  language: { ...BUILTIN_LANGUAGE, name: "", summary: "", personality: [], principles: [], color: "", typography: "", shape: "", depth: "", density: "", iconography: "", imagery: "", voice: "", dos: [], donts: [] },
  layout: { ...BUILTIN_LAYOUT, summary: "", templates: [], rules: [] },
  components: CATALOG.map((c) => emptyGuide(c.name, c.description)),
  patterns: [],
};

/** Pass-2 input: the extracted tokens as "path = value" lines, including component recipes. */
export function foundationsText(tree: Tree): string {
  const ts = new TokenSet(tree);
  return ts.tokens
    .filter((t) => !t.path.startsWith("color."))
    .map((t) => `${t.path} = ${typeof t.authored === "string" ? t.authored : JSON.stringify(t.authored)}${t.aliasOf || typeof t.value !== "string" ? ` (${typeof t.value === "string" ? t.value : JSON.stringify(t.value)})` : ""}`)
    .join("\n");
}
