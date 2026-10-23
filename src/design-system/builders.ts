import type { Flag } from "@/doc/schema";
import { CATALOG_BY_NAME, aspectRatio, type PropSpec } from "./components";
import { ICON_SETS, isDirectional, resolveIconIn, suggestIcons } from "./icons";
import { BUILTIN, type TokenSet } from "./resolve";
import { APP_PANEL_W, PLATFORMS, SIDEBAR_W, isPlatform, marginFor, type Platform } from "./platform";
import { styleOf } from "./styles";
import { parsePath, pathBounds, toD, translatePath } from "./svg-path";
import { CUSTOM, CUSTOM_SPEC, componentLookup, fillComposition, type ComponentLookup } from "./custom";
import type { ComponentDef } from "./docs";
import type { ShapePart, ShapeRecipe } from "@/doc/shape-recipe";
import { isDrawable, isImageRef } from "./crops";
import { buildSurface, type Surface } from "./surfaces";

/** Component instance as produced by the AI or the Components panel. */
export interface Inst {
  component: string;
  props?: Record<string, unknown>;
  children?: Inst[];
}

export type Size = number | "fill" | "hug";

/** Intermediate layout box: laid out by Yoga, then converted to scene nodes. */
export interface LBox {
  kind: "frame" | "text" | "rect" | "ellipse" | "icon" | "path" | "image";
  name: string;
  component?: string;
  direction?: "row" | "column";
  gap?: number;
  padding?: [number, number, number, number]; // top, end, bottom, start (logical)
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  width?: Size;
  height?: Size;
  /** Width ÷ height kept at any width (pictures); the height hugs. */
  aspect?: number;
  minHeight?: number;
  grow?: number;
  margin?: { start?: number; end?: number; top?: number; bottom?: number };
  absolute?: { top?: number; start?: number; end?: number; bottom?: number };
  fill?: string; // token path (colour or gradient)
  /** width: px, or a dimension token path (a stroke that resolves to 0 is dropped); dash: px lengths, repeating */
  stroke?: { token: string; width: number | string; dash?: number[] };
  /** token path, logical [ts, te, be, bs] px, or a token applied to some logical corners only */
  radius?: string | [number, number, number, number] | { token: string; corners: [boolean, boolean, boolean, boolean] };
  shadow?: string; // shadow token path
  clip?: boolean;
  text?: { content: string; type: string; color: string; align?: "start" | "center" | "end"; maxLines?: number };
  icon?: { name: string; color: string; mirrored?: boolean; strokeWidth?: number };
  /** Vector artwork: normalised path data drawn in a vw × vh box (see svg-path.ts). Painted with fill and stroke. */
  path?: { d: string; vw: number; vh: number; evenOdd?: boolean };
  /** A composed shape: rebuilt from its parts for whatever size layout gives it (see doc/shape-recipe.ts). */
  recipe?: ShapeRecipe;
  /** Absolute and pinned to all four edges of its parent, on every relayout (with absolute insets of 0). */
  fillParent?: boolean;
  /** Painted behind its container's other parts, filling it: a custom-shaped surface (a ticket, a bubble, a tag). */
  backdrop?: boolean;
  /** A picture: an "asset:" reference, a data URL or a path the app serves. Painted over the fill. */
  image?: { src: string; fit?: "cover" | "contain" };
  interactive?: boolean;
  hitArea?: number;
  spaceTokens?: string[];
  flags?: Flag[];
  /** Where this catalog instance sits in the screen spec, e.g. "body.2.children.0". */
  specPath?: string;
  children?: LBox[];
}

export interface BuildCtx {
  dir: "ltr" | "rtl";
  lang: "en" | "ar";
  /** Design system to build with; the built-in one when omitted. */
  ts?: TokenSet;
  /** Screen side margin (px); the system's layout.gutter when omitted. */
  gutter?: number;
  /** Platform of the screen being built; mobile when omitted. */
  platform?: Platform;
  /** The screen's top sits on the system's backdrop gradient (it has a hero): the TopBar goes transparent. */
  backdrop?: boolean;
  /** Components beyond the catalog that Custom instances name: the system's, then the screen's own (see custom.ts). */
  components?: ComponentLookup;
  /** Building a Custom component's composition: another Custom inside it isn't drawn. */
  inCustom?: boolean;
  /** On a dark surface (a dark header backdrop, a dark card): primary and secondary text and icons turn light. */
  onDark?: boolean;
  /** Fill token of the surface this is drawn on (the screen, a card, a filled Stack); the canvas when omitted. */
  surface?: string;
}

const T = (ctx: BuildCtx) => ctx.ts ?? BUILTIN;

/** An empty picture's fill: a quiet tint that still shows on the surface under it (a tinted screen, a tinted card). */
function placeholderFill(ctx: BuildCtx): string {
  const paint = (path: string) => JSON.stringify(T(ctx).paint(path) ?? null);
  const under = paint(ctx.surface ?? "bg.canvas");
  return ["bg.surface", "component.media.fill", "bg.surface-raised", "bg.canvas"].find((f) => paint(f) !== under) ?? "bg.surface";
}
/** A dimension token in px. */
const dim = (ctx: BuildCtx, path: string, fallback: number) => T(ctx).dimension(path) ?? fallback;
/** Side margin of the screen being built. */
const gutterOf = (ctx: BuildCtx) => ctx.gutter ?? dim(ctx, "layout.gutter", 16);
const wide = (ctx: BuildCtx) => !!ctx.platform && ctx.platform !== "mobile";
/** How the system draws a component's structure (styles.ts), e.g. "floating" for component.nav-bar.style.placement. */
const style = (ctx: BuildCtx, path: string) => styleOf(T(ctx), path);
export const space = (k: string, ts: TokenSet = BUILTIN) => ts.dimension(`space.${k}`) ?? 16;
const sp = (ctx: BuildCtx, k: string) => space(k, T(ctx));

// ---------------------------------------------------------------------------
// primitives

const frame = (name: string, p: Partial<LBox> = {}, children: LBox[] = []): LBox => ({ kind: "frame", name, direction: "column", children, ...p });

const text = (content: string, type: string, color: string, p: Partial<LBox> & { align?: "start" | "center" | "end"; maxLines?: number } = {}): LBox => {
  const { align, maxLines, ...rest } = p;
  return { kind: "text", name: content.slice(0, 32) || "Text", text: { content, type: `type.${type}`, color, align, maxLines }, ...rest };
};

const icon = (name: string, size: number, color: string, ctx: BuildCtx, p: Partial<LBox> = {}): LBox => {
  // Drawn from the system's icon set: Lucide, or each name's Hugeicons counterpart.
  const set = T(ctx).iconSet;
  const known = resolveIconIn(name, set);
  const closest = known ? [] : suggestIcons(name);
  return {
    kind: "icon",
    name: known ?? `${name} (unknown)`,
    width: size,
    height: size,
    icon: { name: known ?? "help", color, mirrored: ctx.dir === "rtl" && !!known && (isDirectional(name) || isDirectional(known)), strokeWidth: ICON_SETS[set].strokeWidth },
    flags: known
      ? undefined
      : [{ rule: "unknown-icon", severity: "warning", message: `Icon "${name}" is not a Lucide icon${closest.length ? `; closest: ${closest.join(", ")}` : ""}. Used "help".` }],
    ...p,
  };
};

const rect = (name: string, p: Partial<LBox>): LBox => ({ kind: "rect", name, ...p });

/** A picture's height: kept to its aspect at any width when it has one, else its height in px. */
const shape = (p: Record<string, unknown>, fallback: number): Pick<LBox, "height" | "aspect"> => {
  const aspect = aspectRatio(p.aspect);
  return aspect ? { height: "hug", aspect } : { height: Math.round(Number(p.height ?? fallback)) };
};

/** A picture, or a placeholder until it has one (no source yet, or a crop of a screenshot still to cut). */
const picture = (name: string, src: string, ctx: BuildCtx, p: Partial<LBox> = {}, fit: "cover" | "contain" = "cover"): LBox =>
  isDrawable(src)
    ? { kind: "image", name, image: { src, fit }, ...p }
    : frame(name, { align: "center", justify: "center", ...p, fill: p.fill ?? placeholderFill(ctx), clip: true }, [icon("image", 24, "icon.secondary", ctx)]);

/** Relative luminance below a mid grey: light text belongs on it. */
export function isDarkColor(hex: string | undefined): boolean {
  if (!hex || !/^#[0-9a-f]{6}/i.test(hex)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
}

/** Text and icon tones that follow their surface: on a dark one, primary and secondary turn light. */
const onSurface = (ctx: BuildCtx, tone: string, light: string, dark = "text.inverse") => (ctx.onDark && (tone === "primary" || tone === "secondary" || tone === "") ? dark : light);

// ---------------------------------------------------------------------------
// prop validation

type Props = Record<string, unknown>;

function validate(inst: Inst, flags: Flag[], spec = CATALOG_BY_NAME.get(inst.component)!): Props {
  const out: Props = {};
  const props = inst.props ?? {};
  for (const [k, v] of Object.entries(props)) {
    if (!(k in spec.props)) flags.push({ rule: "unknown-prop", severity: "warning", message: `${inst.component} has no prop "${k}" (ignored).` });
  }
  for (const [k, p] of Object.entries(spec.props)) {
    const v = props[k];
    out[k] = checkProp(inst.component, k, p, v, flags);
  }
  return out;
}

function checkProp(comp: string, key: string, p: PropSpec, v: unknown, flags: Flag[]): unknown {
  if (v === undefined || v === null || v === "") {
    if ("required" in p && p.required) flags.push({ rule: "missing-prop", severity: "warning", message: `${comp}.${key} is required.` });
    return p.type === "enum" ? p.default : undefined;
  }
  switch (p.type) {
    case "string": {
      const s = String(v);
      if ([...s].length > p.maxChars)
        flags.push({ rule: "char-limit", severity: "warning", message: `${comp}.${key} is ${[...s].length}/${p.maxChars} characters: "${s.slice(0, 40)}…"` });
      return s;
    }
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max))
        flags.push({ rule: "out-of-range", severity: "info", message: `${comp}.${key}=${n} is outside ${p.min}–${p.max}; clamped.` });
      return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
    }
    case "boolean":
      return Boolean(v);
    case "enum": {
      const s = String(v);
      if (!p.values.includes(s)) {
        flags.push({ rule: "off-system-value", severity: "warning", message: `${comp}.${key}="${s}" is not a system option (${p.values.join(", ")}); used "${p.default}".` });
        return p.default;
      }
      return s;
    }
    case "icon":
      return String(v);
    case "image": {
      const s = String(v).trim();
      if (!isImageRef(s)) {
        flags.push({ rule: "bad-image", severity: "warning", message: `${comp}.${key} isn't a picture the studio can show ("${s.slice(0, 30)}"); used a placeholder.` });
        return undefined;
      }
      return s;
    }
    case "path": {
      const d = String(v);
      if (d.length > p.maxChars) {
        flags.push({ rule: "bad-path", severity: "error", message: `${comp}.${key} is ${d.length}/${p.maxChars} characters of path data; the shape was left out.` });
        return undefined;
      }
      const { error } = parsePath(d);
      if (error) {
        flags.push({ rule: "bad-path", severity: "error", message: `${comp}.${key} isn't a path the studio can draw (${error}); the shape was left out.` });
        return undefined;
      }
      return d;
    }
    case "strings": {
      const arr = Array.isArray(v) ? v.map(String) : [];
      if (arr.length > p.maxItems) flags.push({ rule: "too-many-items", severity: "info", message: `${comp}.${key} has ${arr.length} items (max ${p.maxItems}).` });
      for (const s of arr)
        if ([...s].length > p.maxChars) flags.push({ rule: "char-limit", severity: "warning", message: `${comp}.${key} item "${s}" is ${[...s].length}/${p.maxChars} characters.` });
      return arr.slice(0, p.maxItems);
    }
    case "numbers": {
      const arr = (Array.isArray(v) ? v : []).map(Number);
      if (arr.length > p.maxItems) flags.push({ rule: "too-many-items", severity: "info", message: `${comp}.${key} has ${arr.length} items (max ${p.maxItems}).` });
      if (arr.some((n) => !Number.isFinite(n))) flags.push({ rule: "off-system-value", severity: "warning", message: `${comp}.${key} has values that aren't numbers; used 0.` });
      return arr.slice(0, p.maxItems).map((n) => (Number.isFinite(n) ? n : 0));
    }
    case "items": {
      const arr = Array.isArray(v) ? (v as Props[]) : [];
      if (arr.length > p.maxItems) flags.push({ rule: "too-many-items", severity: "info", message: `${comp}.${key} has ${arr.length} items (max ${p.maxItems}).` });
      return arr.slice(0, p.maxItems).map((item) => {
        const o: Props = {};
        for (const [fk, fp] of Object.entries(p.fields)) o[fk] = checkProp(`${comp}.${key}[]`, fk, fp, item?.[fk], flags);
        return o;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// component builders

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : String(v));

/** `given`: the props the instance set itself (validation fills enum defaults, so "unset" and the default look alike). */
type Builder = (p: Props, ctx: BuildCtx, children: LBox[], given?: ReadonlySet<string>) => LBox;

const TONE_TEXT: Record<string, string> = {
  primary: "text.primary",
  secondary: "text.secondary",
  link: "text.link",
  success: "text.success",
  error: "text.error",
  inverse: "text.inverse",
};

const PICTURES = new Set(["Image", "Media", "Graphic", "Avatar", "Icon"]);

/** What a box is as an item of a collection: one of the system's own components, or a column that leads with a picture. */
function itemKind(b: LBox): string | null {
  const c = b.component ?? "";
  if (c.startsWith("Custom/")) return c;
  if (b.kind !== "frame" || c !== "Stack" || (b.direction ?? "column") !== "column") return null;
  return (b.children ?? []).some((k) => PICTURES.has(k.component ?? "") || k.kind === "image" || k.kind === "icon") ? "Stack" : null;
}

/**
 * Two or more items of the same kind side by side: a collection (product tiles, plan cards, quick
 * actions). Sized by their own text they come out uneven, with pictures of different shapes, so
 * they share the row's width equally instead.
 */
function sameKindItems(children: LBox[]): boolean {
  if (children.length < 2) return false;
  const kinds = children.map(itemKind);
  return kinds[0] !== null && kinds.every((k) => k === kinds[0]);
}

/**
 * A row's one column of text beside things that aren't (a dish's photo and +, an avatar, a price)
 * takes the room the row has left, so its text wraps there instead of pushing them out of the
 * row: what a list row does. A row with several columns of text keeps sharing it as it was.
 */
function textColumnFills(children: LBox[]): LBox[] {
  const isColumn = (b: LBox) => b.kind === "frame" && (b.direction ?? "column") === "column" && b.width === undefined && b.grow === undefined && (b.children ?? []).some((k) => k.kind === "text");
  const cols = children.filter(isColumn);
  return cols.length === 1 && children.length > 1 ? children.map((c) => (c === cols[0] ? { ...c, grow: 1, width: 0 } : c)) : children;
}

const BUILDERS: Record<string, Builder> = {
  Stack: (p, ctx, children) => {
    const bg = str(p.background);
    // A row read from the start (not centred) lets its one column of text take the room left.
    if (p.direction === "horizontal" && p.justify !== "center" && p.justify !== "end") children = textColumnFills(children);
    const row = p.direction === "horizontal";
    // A backdrop is the Stack's surface, not one of its items.
    const items = children.filter((c) => !c.backdrop);
    const wrap = row && items.length > (wide(ctx) ? 6 : 3);
    // On web and dashboards a row of Stacks is a set of grid columns: they share the width.
    if (row && wide(ctx)) children = children.map((c) => (c.kind === "frame" && c.component === "Stack" && c.width === undefined ? { ...c, grow: 1, width: 0 } : c));
    // On every platform, items of one kind side by side (tiles, a product's own components) share it too.
    if (row && !wrap && sameKindItems(items)) children = children.map((c) => (c.width === undefined && !c.backdrop ? { ...c, grow: 1, width: 0 } : c));
    return frame(
      "Stack",
      {
        direction: p.direction === "horizontal" ? "row" : "column",
        gap: sp(ctx, str(p.gap)),
        padding: pad(sp(ctx, str(p.padding))),
        align: p.align as LBox["align"],
        justify: p.justify as LBox["justify"],
        fill: bg === "surface" ? "bg.surface" : bg === "raised" ? "bg.surface-raised" : bg === "brand-subtle" ? "bg.brand-subtle" : undefined,
        radius: p.radius && p.radius !== "none" ? `radius.${p.radius}` : undefined,
        spaceTokens: [`space.${p.gap}`, `space.${p.padding}`],
        wrap,
      },
      row ? children : trimAutoDividers(children),
    );
  },

  Text: (p, ctx) =>
    text(str(p.text), str(p.style), onSurface(ctx, str(p.tone), TONE_TEXT[str(p.tone)] ?? "text.primary"), {
      align: p.align as "start" | "center" | "end",
      maxLines: p.maxLines as number | undefined,
    }),

  TopBar: (p, base) => {
    // Scrolled: content runs under it, so it's solid (off the backdrop) with a hairline, title in the bar.
    const scrolled = !!p.scrolled;
    const ctx: BuildCtx = scrolled ? { ...base, backdrop: false, onDark: false } : base;
    // On a backdrop the bar is see-through, so a brand bar would put light text on a soft wash.
    const brand = p.variant === "brand" && !ctx.backdrop;
    const size = dim(ctx, "component.icon-button.size", 44);
    const navBtn = (name: string, label: string, variant = "outline") => {
      // On a dark header backdrop the buttons are translucent squares; a brand button stays filled.
      const filled = variant === "brand";
      const glass = !filled && !brand && ctx.onDark;
      return frame(label, {
        component: "IconButton",
        width: size,
        height: size,
        align: "center",
        justify: "center",
        radius: "component.icon-button.radius",
        fill: filled ? "component.icon-button.brand-fill" : brand || variant === "ghost" ? undefined : glass ? "component.icon-button.backdrop-fill" : "component.icon-button.outline-fill",
        stroke: filled || brand || glass || variant === "ghost" ? undefined : { token: "component.icon-button.border", width: "component.icon-button.border-width" },
        interactive: true,
        ...(size < 44 ? { hitArea: 44 } : {}),
      }, [icon(name, 20, filled ? "component.icon-button.brand-icon" : brand ? "icon.inverse" : glass ? "icon.primary" : "component.icon-button.icon", ctx)]);
    };
    const leading = str(p.leading);
    const leadIcon = leading === "back" ? "arrow-left" : leading === "close" ? "close" : leading === "menu" ? "menu" : "";
    const spacer = () => frame("Spacer", { width: size, height: size });
    const gutter = gutterOf(ctx);
    const titleColor = brand || ctx.onDark ? "text.inverse" : "text.primary";
    const lead = leadIcon ? navBtn(leadIcon, leading === "back" ? "Back" : leading === "close" ? "Close" : "Menu") : null;
    const trail = p.trailing ? navBtn(str(p.trailing), str(p.trailing), str(p.trailingVariant) || "outline") : null;
    // A brand mark before the title makes it the product's logo lockup.
    const lockup = p.titleIcon
      ? (align: "start" | "center") =>
          frame("Title", { direction: "row", align: "center", justify: align === "center" ? "center" : "start", gap: 6, grow: 1, width: 0 }, [
            icon(str(p.titleIcon), 28, brand || ctx.onDark ? "icon.inverse" : "icon.brand", ctx),
            text(str(p.title), "title", brand || ctx.onDark ? "text.inverse" : "text.link", { maxLines: 1 }),
          ])
      : null;
    const border = ctx.backdrop ? 0 : scrolled ? Math.max(1, dim(ctx, "component.top-bar.border-width", 0)) : dim(ctx, "component.top-bar.border-width", 0);
    const edge = () => rect("Border", { height: border, fill: "component.top-bar.border", absolute: { bottom: 0, start: 0, end: 0 } });
    const height = dim(ctx, "component.top-bar.height", 56);
    const look = {
      fill: ctx.backdrop ? undefined : brand ? "component.top-bar.brand-fill" : "component.top-bar.fill",
      shadow: ctx.backdrop ? undefined : "component.top-bar.shadow",
    };
    const title = scrolled && style(ctx, "component.top-bar.style.title") === "large" ? "center" : style(ctx, "component.top-bar.style.title");
    if (title === "large") {
      // The buttons keep a slim bar of their own; the title sits under it, large, on the start edge.
      const bar = lead || trail ? [frame("Bar", { direction: "row", align: "center", justify: "between", padding: [6, gutter, 6, gutter], height, width: "fill" }, [lead ?? frame("Spacer", { width: 0, height: size }), trail ?? frame("Spacer", { width: 0, height: size })])] : [];
      const kids = [...bar, frame("Title", { padding: [bar.length ? 4 : 12, gutter, 8, gutter], width: "fill" }, [text(str(p.title), "title-lg", titleColor, { align: "start", maxLines: 2 })])];
      if (border > 0) kids.push(edge());
      return frame("TopBar", { width: "fill", align: "stretch", ...look, spaceTokens: ["layout.gutter"] }, kids);
    }
    const kids: LBox[] =
      title === "start"
        ? [...(lead ? [lead] : []), lockup ? lockup("start") : text(str(p.title), "headline", titleColor, { align: "start", grow: 1, maxLines: 1 }), ...(trail ? [trail] : [])]
        : [lead ?? spacer(), lockup ? lockup("center") : text(str(p.title), "headline", titleColor, { align: "center", grow: 1, maxLines: 1 }), trail ?? spacer()];
    if (border > 0) kids.push(edge());
    return frame(
      "TopBar",
      {
        direction: "row",
        align: "center",
        justify: "between",
        ...(title === "start" ? { gap: 8 } : {}),
        padding: [6, gutter, 6, gutter],
        height,
        width: "fill",
        ...look,
        spaceTokens: ["layout.gutter"],
      },
      kids,
    );
  },

  SearchBar: (p, ctx) => {
    const padX = dim(ctx, "component.input.padding-x", 16);
    // On a dark header backdrop the field is translucent, with no border.
    const glass = !!ctx.onDark;
    const end = style(ctx, "component.search.style.icon") === "end";
    const glyph = icon("search", 20, end || glass ? "icon.primary" : "icon.secondary", ctx);
    const label = text(str(p.placeholder), "body", glass ? "text.primary" : "text.tertiary", { grow: 1, maxLines: 1 });
    return frame(
      "SearchBar",
      {
        direction: "row",
        align: "center",
        gap: dim(ctx, "component.input.gap", 8),
        padding: [0, padX, 0, padX],
        height: dim(ctx, "component.search.height", dim(ctx, "component.input.height", 48)),
        width: "fill",
        radius: "component.input.radius",
        fill: glass ? "component.search.backdrop-fill" : "component.search.fill",
        stroke: glass ? undefined : { token: "component.input.border", width: "component.input.border-width" },
        shadow: glass ? undefined : "component.input.shadow",
        interactive: true,
        spaceTokens: ["component.input.gap", "component.input.padding-x"],
      },
      end ? [label, glyph] : [glyph, label],
    );
  },

  Button: (p, ctx) => {
    const size = str(p.size) === "sm" ? "sm" : str(p.size) === "md" ? "md" : "lg";
    const h = dim(ctx, `component.button.height-${size}`, size === "sm" ? 36 : size === "md" ? 44 : 52);
    const px = dim(ctx, `component.button.padding-x-${size}`, size === "sm" ? 16 : size === "md" ? 20 : 24);
    const v = ["primary", "secondary", "tertiary", "danger"].includes(str(p.variant)) ? str(p.variant) : "primary";
    const b = `component.button.${v}`;
    // Not available yet: the surface fill and the tertiary text the roles keep for disabled.
    const off = !!p.disabled;
    const kids: LBox[] = [];
    if (p.icon) kids.push(icon(str(p.icon), size === "sm" ? 16 : 20, off ? "text.tertiary" : `${b}.icon`, ctx));
    kids.push(text(str(p.label), size === "sm" ? "label" : "body-strong", off ? "text.tertiary" : `${b}.label`, { align: "center", maxLines: 1 }));
    return frame(
      `Button/${cap(v)}`,
      {
        component: `Button/${cap(v)}`,
        direction: "row",
        align: "center",
        justify: "center",
        gap: dim(ctx, "component.button.gap", 8),
        padding: [0, px, 0, px],
        height: h,
        width: p.fullWidth ? "fill" : "hug",
        radius: "component.button.radius",
        fill: v === "tertiary" ? undefined : off ? "bg.surface" : `${b}.fill`,
        stroke: v === "secondary" ? { token: `${b}.border`, width: `${b}.border-width` } : undefined,
        shadow: v === "tertiary" || off ? undefined : "component.button.shadow",
        interactive: true,
        hitArea: h < 44 ? 44 : undefined,
        spaceTokens: ["component.button.gap"],
      },
      kids,
    );
  },

  IconButton: (p, ctx) => {
    const v = str(p.variant);
    const size = dim(ctx, "component.icon-button.size", 44);
    return frame(
      str(p.label) || "IconButton",
      {
        component: "IconButton",
        width: size,
        height: size,
        align: "center",
        justify: "center",
        radius: "component.icon-button.radius",
        fill: v === "brand" ? "component.icon-button.brand-fill" : v === "outline" ? (ctx.onDark ? "component.icon-button.backdrop-fill" : "component.icon-button.outline-fill") : undefined,
        stroke: v === "outline" && !ctx.onDark ? { token: "component.icon-button.border", width: "component.icon-button.border-width" } : undefined,
        interactive: true,
        ...(size < 44 ? { hitArea: 44 } : {}),
      },
      [icon(str(p.icon), 20, v === "brand" ? "component.icon-button.brand-icon" : v === "ghost" ? onSurface(ctx, "primary", "component.icon-button.icon", "icon.inverse") : "component.icon-button.icon", ctx)],
    );
  },

  TextField: (p, ctx) => {
    const err = str(p.error);
    const value = str(p.value);
    const kids: LBox[] = [text(str(p.label), "label", "text.primary")];
    const field: LBox[] = [];
    if (p.icon) field.push(icon(str(p.icon), 20, "icon.secondary", ctx));
    field.push(text(value || str(p.placeholder) || " ", "body", value ? "text.primary" : "text.secondary", { grow: 1, maxLines: 1 }));
    const padX = dim(ctx, "component.input.padding-x", 16);
    kids.push(
      frame(
        "Input",
        {
          direction: "row",
          align: "center",
          gap: dim(ctx, "component.input.gap", 8),
          padding: [0, padX, 0, padX],
          height: dim(ctx, "component.input.height", 48),
          width: "fill",
          radius: "component.input.radius",
          fill: "component.input.fill",
          stroke: err
            ? { token: "component.input.border-error", width: "component.input.border-width-error" }
            : { token: "component.input.border", width: "component.input.border-width" },
          shadow: "component.input.shadow",
          interactive: true,
        },
        field,
      ),
    );
    if (err) kids.push(text(err, "caption", "text.error"));
    else if (p.helper) kids.push(text(str(p.helper), "caption", "text.secondary"));
    return frame("TextField", { component: "TextField", gap: 6, width: "fill", align: "stretch" }, kids);
  },

  ChipGroup: (p, ctx) => {
    const chips = (p.chips as string[]) ?? [];
    const sel = Number(p.selected ?? -1);
    const padX = dim(ctx, "component.chip.padding-x", 14);
    return frame(
      "ChipGroup",
      { direction: "row", gap: dim(ctx, "component.chip.gap", 8), wrap: true, width: "fill", spaceTokens: ["component.chip.gap"] },
      chips.map((c, i) =>
        frame(
          `Chip/${c}`,
          {
            component: i === sel ? "Chip/Selected" : "Chip",
            direction: "row",
            align: "center",
            height: dim(ctx, "component.chip.height", 36),
            padding: [0, padX, 0, padX],
            radius: "component.chip.radius",
            fill: i === sel ? "component.chip.selected.fill" : "component.chip.fill",
            stroke: i === sel ? undefined : { token: "component.chip.border", width: "component.chip.border-width" },
            interactive: true,
            hitArea: 44,
          },
          [text(c, "label", i === sel ? "component.chip.selected.label" : "component.chip.label", { maxLines: 1 })],
        ),
      ),
    );
  },

  Tag: (p, ctx) => {
    const tone = str(p.tone);
    const map: Record<string, [string, string]> = {
      brand: ["bg.brand", "text.on-brand"],
      plus: ["bg.brand-strong", "text.on-brand-strong"],
      success: ["feedback.success-subtle", "text.success"],
      warning: ["feedback.warning-subtle", "text.warning"],
      error: ["feedback.error-subtle", "text.error"],
      info: ["feedback.info-subtle", "text.info"],
      neutral: ["bg.surface", "text.secondary"],
      promo: ["component.tag.promo-fill", "component.tag.promo-label"],
      member: ["component.tag.member-fill", "component.tag.member-label"],
    };
    const [bg, fg] = map[tone] ?? map.neutral;
    const padX = dim(ctx, "component.tag.padding-x", 8);
    // A tag hugs its label, even in a column that stretches its children.
    return frame(`Tag/${cap(tone)}`, {
      component: `Tag/${cap(tone)}`,
      direction: "row",
      align: "center",
      width: "hug",
      height: dim(ctx, "component.tag.height", 24),
      padding: [0, padX, 0, padX],
      radius: "component.tag.radius",
      fill: bg,
      // A membership mark is outlined, like a badge printed on the page.
      ...(tone === "member" ? { stroke: { token: "component.tag.member-border", width: "border-width.default" } } : {}),
    }, [
      text(str(p.label), "caption-strong", fg, { maxLines: 1 }),
    ]);
  },

  Card: (p, ctx, children) => {
    const tone = str(p.tone);
    // The strong brand card is a recipe: a system can make its hero cards a gradient.
    const fill = cardFill(tone);
    const dark = tone === "brand-strong" || tone === "inverse";
    const body = flushRows(children);
    const kids = trimAutoDividers(p.title ? [text(str(p.title), "headline", dark ? "text.inverse" : "text.primary"), ...body] : body);
    const padKey = str(p.padding) || "400";
    const look = tone === "raised" ? "component.card.raised" : "component.card.flat";
    const bleed = p.fullBleed ? gutterOf(ctx) : 0;
    return frame(
      `Card`,
      {
        component: `Card/${cap(tone)}`,
        gap: dim(ctx, "component.card.gap", 12),
        padding: bleed ? [sp(ctx, padKey), bleed, sp(ctx, padKey), bleed] : pad(sp(ctx, padKey)),
        width: "fill",
        radius: bleed ? { token: "component.sheet.radius", corners: [true, true, false, false] } : "component.card.radius",
        fill,
        // A dark card is its own edge; an outline only belongs on light ones.
        stroke: dark ? undefined : { token: `${look}.border`, width: `${look}.border-width` },
        shadow: `${look}.shadow`,
        ...(bleed ? { margin: { start: -bleed, end: -bleed } } : {}),
        spaceTokens: [`space.${padKey}`, "component.card.gap"],
      },
      kids,
    );
  },

  ListItem: (p, ctx, _children, given) => {
    const lead: LBox[] = [];
    const leadSize = dim(ctx, "component.list-item.leading-size", 40);
    if (p.avatar) lead.push(BUILDERS.Avatar({ initials: p.avatar, size: "md" }, ctx, []));
    else if (p.leadingIcon)
      lead.push(
        style(ctx, "component.list-item.style.leading") === "bare"
          ? icon(str(p.leadingIcon), 24, "component.list-item.icon", ctx)
          : frame("Leading", { width: leadSize, height: leadSize, align: "center", justify: "center", radius: "component.list-item.leading-radius", fill: "component.list-item.leading-fill" }, [
              icon(str(p.leadingIcon), 20, "component.list-item.icon", ctx),
            ]),
      );
    // Rows the system marks with a chevron get one unless they said what goes at the end.
    const t = !given?.has("trailing") && style(ctx, "component.list-item.style.chevron") === "shown" ? "chevron" : str(p.trailing);
    // An option you tick reads as plain text; a row that opens something leads with its title.
    const option = t === "checkbox" || t === "radio";
    const texts = [text(str(p.title), option ? "body" : "body-strong", onSurface(ctx, "primary", "text.primary"), { maxLines: 1 })];
    if (p.subtitle) texts.push(text(str(p.subtitle), "caption", onSurface(ctx, "secondary", "text.secondary"), { maxLines: 2 }));
    const trailing: LBox[] = [];
    if (t === "chevron") trailing.push(icon("chevron-right", 20, "icon.secondary", ctx));
    if ((t === "text" || option) && p.trailingText) trailing.push(text(str(p.trailingText), "body-strong", TONE_TEXT[str(p.trailingTone)] ?? "text.primary", { maxLines: 1 }));
    if (t === "checkbox")
      trailing.push(
        frame("Checkbox", {
          component: "Checkbox",
          width: 24,
          height: 24,
          align: "center",
          justify: "center",
          radius: "radius.xs",
          fill: p.checked ? "bg.brand-strong" : "bg.canvas",
          stroke: p.checked ? undefined : { token: "border.default", width: "border-width.default" },
          interactive: true,
          hitArea: 44,
        }, p.checked ? [icon("check", 16, "icon.on-brand-strong", ctx)] : []),
      );
    if (t === "radio")
      trailing.push(
        frame("Radio", {
          component: "Radio",
          width: 24,
          height: 24,
          align: "center",
          justify: "center",
          radius: "radius.pill",
          fill: "bg.canvas",
          stroke: { token: p.checked ? "bg.brand-strong" : "border.default", width: p.checked ? 2 : "border-width.default" },
          interactive: true,
          hitArea: 44,
        }, p.checked ? [{ kind: "ellipse", name: "Dot", width: 12, height: 12, fill: "bg.brand-strong" }] : []),
      );
    if (t === "toggle") {
      // Off: a neutral track with the knob at the start; on: the brand track, knob at the end.
      const on = p.checked !== false;
      trailing.push(
        frame("Toggle", { component: "Toggle", width: 44, height: 26, radius: "radius.pill", fill: on ? "bg.brand-strong" : "border.default", direction: "row", align: "center", justify: on ? "end" : "start", padding: [3, 3, 3, 3], interactive: true }, [
          { kind: "ellipse", name: "Knob", width: 20, height: 20, fill: on ? "bg.brand" : "bg.canvas" },
        ]),
      );
    }
    const row = frame(
      "ListItem",
      { component: "ListItem", direction: "row", align: "center", gap: 12, padding: [12, 0, 12, 0], minHeight: dim(ctx, "component.list-item.min-height", 56), width: "fill", interactive: t === "chevron" || t === "toggle" || option, spaceTokens: ["space.300"] },
      [...lead, frame("Text", { gap: 2, grow: 1, align: "stretch" }, texts), ...trailing],
    );
    // A row's own divider prop wins; otherwise the system says whether rows are divided, and how.
    const system = style(ctx, "component.list-item.style.divider");
    const own = given?.has("divider");
    const kind = own ? (p.divider ? (system === "inset" ? "inset" : "full") : "none") : system;
    if (kind === "none") return row;
    const line = divider(ctx);
    // Inset lines start where the text does.
    const indent = kind === "inset" && lead.length ? (lead[0].width as number) + 12 : 0;
    return frame("ListItem", { component: "ListItem", width: "fill", align: "stretch" }, [
      { ...row, component: undefined },
      { ...line, ...(own ? {} : { name: AUTO_DIVIDER }), ...(indent ? { margin: { start: indent } } : {}) },
    ]);
  },

  ServiceGrid: (p, ctx) => {
    const tiles = (p.tiles as Props[]) ?? [];
    const cols = Number(p.columns ?? 4);
    const tileH = dim(ctx, "component.tile.height", 92);
    const iconSize = dim(ctx, "component.tile.icon-size", 40);
    const gap = dim(ctx, "component.tile.gap", 8);
    // Bare tiles: no card, the icon (in its own shape) and label straight on the page.
    const bare = style(ctx, "component.tile.style.layout") === "bare";
    // Scrolling grids keep the columns' tile width and run past the end edge in two rows.
    const scroll = !!p.scroll && tiles.length > cols;
    // Rows of at most one more than the columns (the one that peeks in), split evenly.
    const perRow = scroll ? Math.ceil(tiles.length / Math.ceil(tiles.length / (cols + 1))) : cols;
    const gutter = gutterOf(ctx);
    const tileW = Math.floor((PLATFORMS[ctx.platform ?? "mobile"].w - 2 * gutter - (cols - 1) * gap) / cols);
    const size = scroll ? { width: tileW } : { grow: 1, width: 0 };
    const rows: LBox[] = [];
    for (let i = 0; i < tiles.length; i += perRow) {
      const slice = tiles.slice(i, i + perRow);
      const cells = slice.map((t) => {
        const kids: LBox[] = [
          t.image
            ? picture(`Image/${str(t.label)}`, str(t.image), ctx, { width: "fill", height: iconSize + 4 }, "contain")
            : frame("Icon", { width: iconSize, height: iconSize, align: "center", justify: "center", radius: "component.tile.icon-radius", fill: "component.tile.icon-fill" }, [icon(str(t.icon), Math.round(iconSize * 0.55), "component.tile.icon", ctx)]),
          text(str(t.label), "caption-strong", "text.primary", { align: "center", maxLines: 1 }),
        ];
        const tile = frame(
          `Tile/${str(t.label)}`,
          bare
            ? { component: "ServiceTile", align: "center", justify: "start", gap: 8, padding: [4, 0, 4, 0], ...size, interactive: true }
            : {
                component: "ServiceTile",
                align: "center",
                justify: "center",
                gap: t.image ? 4 : 8,
                padding: t.image ? [8, 4, 10, 4] : [14, 4, 12, 4],
                ...size,
                height: tileH,
                radius: "component.tile.radius",
                fill: "component.tile.fill",
                stroke: { token: "component.tile.border", width: "component.tile.border-width" },
                shadow: "component.tile.shadow",
                interactive: true,
              },
          kids,
        );
        if (t.badge) {
          tile.children!.push({
            ...BUILDERS.Tag({ label: t.badge, tone: "plus" }, ctx, []),
            absolute: { top: -8 },
            height: 20,
          });
          tile.clip = false;
        }
        return tile;
      });
      if (!scroll) while (cells.length < cols) cells.push(frame("Empty", { grow: 1, width: 0, ...(bare ? {} : { height: tileH }) }));
      rows.push(frame("Row", { direction: "row", gap, ...(scroll ? {} : { width: "fill" }) }, cells));
    }
    if (scroll)
      return frame("ServiceGrid", { component: "ServiceGrid", gap, width: "fill", align: "start", clip: true, margin: { end: -gutter }, spaceTokens: ["component.tile.gap"] }, rows);
    return frame("ServiceGrid", { component: "ServiceGrid", gap, width: "fill", align: "stretch", spaceTokens: ["component.tile.gap"] }, rows);
  },

  PromoBanner: (p, ctx) => {
    const tone = ["brand", "go", "get", "eat", "pay"].includes(str(p.tone)) ? str(p.tone) : "brand";
    const b = `component.banner.${tone}`;
    const col: LBox[] = [text(str(p.title), "title", `${b}.title`, { maxLines: 2 })];
    if (p.subtitle) col.push(text(str(p.subtitle), "body", `${b}.body`, { maxLines: 2 }));
    if (p.cta) {
      const padX = dim(ctx, "component.button.padding-x-sm", 16);
      col.push(
        frame(
          "CTA",
          {
            component: "Button/Small",
            direction: "row",
            align: "center",
            height: dim(ctx, "component.button.height-sm", 36),
            padding: [0, padX, 0, padX],
            radius: "component.button.radius",
            fill: `${b}.cta-fill`,
            margin: { top: 4 },
            interactive: true,
            hitArea: 44,
          },
          [text(str(p.cta), "label", `${b}.cta-label`, { maxLines: 1 })],
        ),
      );
    }
    const kids: LBox[] = [frame("Copy", { gap: 6, grow: 1, width: 0, align: "start" }, col)];
    if (p.icon) kids.push(frame("Art", { width: 72, height: 72, align: "center", justify: "center", radius: "radius.pill", fill: `${b}.art-fill` }, [icon(str(p.icon), 36, `${b}.art-icon`, ctx)]));
    const padAll = dim(ctx, "component.banner.padding", 20);
    return frame(
      `PromoBanner/${cap(tone)}`,
      {
        component: `PromoBanner/${cap(tone)}`,
        direction: "row",
        align: "center",
        gap: dim(ctx, "component.banner.gap", 12),
        padding: pad(padAll),
        width: "fill",
        radius: "component.banner.radius",
        fill: `${b}.fill`,
        shadow: "component.banner.shadow",
        spaceTokens: ["component.banner.padding", "component.banner.gap"],
      },
      kids,
    );
  },

  ProgressTracker: (p, ctx) => {
    const steps = (p.steps as string[]) ?? [];
    const current = Math.min(Number(p.current ?? 0), Math.max(0, steps.length - 1));
    if (p.variant === "timeline") {
      return frame(
        "ProgressTracker",
        { component: "ProgressTracker/Timeline", gap: 0, width: "fill", align: "stretch" },
        [
          ...(p.title ? [text(str(p.title), "headline", "text.primary", { margin: { bottom: 12 } })] : []),
          ...steps.map((s, i) => {
            const done = i < current;
            const now = i === current;
            const dot = frame("Dot", { width: 24, height: 24, align: "center", justify: "center", radius: "radius.pill", fill: done ? "bg.brand-strong" : now ? "bg.brand" : "bg.surface", stroke: done || now ? undefined : { token: "border.default", width: 1 } }, done ? [icon("check", 14, "icon.on-brand-strong", ctx)] : []);
            const railKids: LBox[] = [dot];
            if (i < steps.length - 1) railKids.push(rect("Line", { width: 2, height: 24, fill: done ? "bg.brand-strong" : "border.default" }));
            return frame(`Step/${s}`, { direction: "row", gap: 12, width: "fill" }, [
              frame("Rail", { align: "center", width: 24 }, railKids),
              text(s, now ? "body-strong" : "body", done || now ? "text.primary" : "text.secondary", { grow: 1, margin: { top: 1 } }),
            ]);
          }),
        ],
      );
    }
    const pct = steps.length > 1 ? current / (steps.length - 1) : 0;
    const track = frame("Track", { direction: "row", height: 6, width: "fill", radius: "radius.pill", fill: "bg.surface", clip: true }, [
      rect("Progress", { height: 6, width: 0, grow: pct, radius: "radius.pill", fill: "bg.brand" }),
      rect("Rest", { height: 6, width: 0, grow: 1 - pct }),
    ]);
    const labels = frame("Steps", { direction: "row", justify: "between", width: "fill" }, steps.map((s, i) => text(s, i === current ? "caption-strong" : "caption", i <= current ? "text.primary" : "text.secondary", { maxLines: 1 })));
    return frame("ProgressTracker", { component: "ProgressTracker/Bar", gap: 10, width: "fill", align: "stretch" }, [
      ...(p.title ? [text(str(p.title), "title", "text.primary")] : []),
      track,
      labels,
    ]);
  },

  MapPlaceholder: (p, ctx) => {
    const h = Number(p.height ?? 220);
    const full = !!p.fullBleed;
    const kids: LBox[] = [
      rect("Road", { width: 520, height: 14, fill: "bg.canvas", absolute: { top: h * 0.3, start: -40 } }),
      rect("Road", { width: 14, height: h + 40, fill: "bg.canvas", absolute: { top: -20, start: 120 } }),
      rect("Road", { width: 14, height: h + 40, fill: "bg.canvas", absolute: { top: -20, start: 280 } }),
      rect("Road", { width: 520, height: 10, fill: "bg.canvas", absolute: { top: h * 0.72, start: -40 } }),
      rect("Route", { width: 166, height: 6, fill: "bg.brand-strong", radius: "radius.pill", absolute: { top: h * 0.3 + 4, start: 120 } }),
      rect("Route", { width: 6, height: h * 0.42, fill: "bg.brand-strong", radius: "radius.pill", absolute: { top: h * 0.3 + 4, start: 280 } }),
      frame("Pin", { width: 36, height: 36, align: "center", justify: "center", radius: "radius.pill", fill: "bg.brand", stroke: { token: "bg.canvas", width: 3 }, absolute: { top: h * 0.72 - 16, start: 265 } }, [icon("map-pin", 18, "icon.primary", ctx)]),
      frame("Car", { width: 32, height: 32, align: "center", justify: "center", radius: "radius.pill", fill: "bg.brand-strong", absolute: { top: h * 0.3 - 13, start: 104 } }, [icon("car", 16, "icon.on-brand-strong", ctx)]),
    ];
    if (p.pin)
      kids.push(frame("PinLabel", { direction: "row", align: "center", height: 28, padding: [0, 10, 0, 10], radius: "radius.pill", fill: "bg.canvas", shadow: "shadow.sm", absolute: { top: h * 0.72 + 24, start: 200 } }, [text(str(p.pin), "caption-strong", "text.primary", { maxLines: 1 })]));
    if (p.eta)
      kids.push(frame("ETA", { direction: "row", align: "center", gap: 6, height: 32, padding: [0, 12, 0, 12], radius: "radius.pill", fill: "bg.inverse", absolute: { top: 12, end: 12 } }, [icon("clock", 14, "icon.inverse", ctx), text(str(p.eta), "label", "text.inverse", { maxLines: 1 })]));
    const gutter = gutterOf(ctx);
    return frame("MapPlaceholder", { component: "Map", height: h, width: "fill", radius: full ? undefined : "component.media.radius", fill: "bg.surface", clip: true, margin: full ? { start: -gutter, end: -gutter } : undefined }, kids);
  },

  Avatar: (p) => {
    const s = str(p.size);
    const d = s === "sm" ? 32 : s === "lg" ? 56 : 40;
    return frame("Avatar", { component: "Avatar", width: d, height: d, align: "center", justify: "center", radius: "radius.pill", fill: "bg.brand-subtle" }, [
      text(str(p.initials).toUpperCase(), s === "lg" ? "headline" : "label", "text.link"),
    ]);
  },

  Divider: (p, ctx) => (p.fullBleed ? { ...divider(ctx), margin: { start: -gutterOf(ctx), end: -gutterOf(ctx) } } : divider(ctx)),

  BottomSheet: (p, ctx, children) => {
    const gutter = gutterOf(ctx);
    return frame(
      "BottomSheet",
      {
        component: "BottomSheet",
        gap: dim(ctx, "layout.section-gap", 16),
        padding: [8, gutter, 16, gutter],
        width: "fill",
        align: "stretch",
        fill: "component.sheet.fill",
        radius: { token: "component.sheet.radius", corners: [true, true, false, false] },
        shadow: "component.sheet.shadow",
        spaceTokens: ["layout.section-gap", "layout.gutter"],
      },
      [frame("Grabber", { align: "center", width: "fill" }, [rect("Handle", { width: 36, height: 4, radius: "radius.pill", fill: "component.sheet.handle" })]), ...(p.title ? [text(str(p.title), "title", "text.primary")] : []), ...trimAutoDividers(children)],
    );
  },

  BottomNav: (p, ctx) => {
    const items = (p.items as Props[]) ?? [];
    const active = Number(p.active ?? 0);
    const floating = style(ctx, "component.nav-bar.style.placement") === "floating";
    const labels = style(ctx, "component.nav-bar.style.labels");
    const indicator = style(ctx, "component.nav-bar.style.indicator");
    const h = dim(ctx, "component.nav-bar.height", 52);
    const mark = dim(ctx, "component.nav-bar.indicator-size", 32);
    const markW = Math.max(mark, dim(ctx, "component.nav-bar.indicator-width", 56));
    // Icon-only floating bars hug their tabs, centred (like Cash App); labelled ones span the width inside the inset.
    const hug = floating && labels === "none";
    const tabs = items.map((it, i) => {
      const on = i === active;
      // Hidden labels stay as the tab's name (its accessible name and layer name).
      const showLabel = labels === "all" || (labels === "active" && on);
      let glyph = icon(str(it.icon), 24, on ? "component.nav-bar.active" : "component.nav-bar.inactive", ctx);
      if (on && indicator === "pill")
        glyph = frame("Indicator", { width: markW, height: mark, align: "center", justify: "center", radius: "radius.pill", fill: "component.nav-bar.indicator-fill" }, [glyph]);
      const kids: LBox[] = [glyph];
      if (showLabel) kids.push(text(str(it.label), "caption-strong", on ? "component.nav-bar.active" : "component.nav-bar.inactive", { align: "center", maxLines: 1 }));
      if (on && indicator === "dot") kids.push({ kind: "ellipse", name: "Indicator", width: 4, height: 4, fill: "component.nav-bar.active" });
      if (on && indicator === "line") kids.push(rect("Indicator", { width: 24, height: 3, radius: "radius.pill", fill: "component.nav-bar.active" }));
      return frame(`Tab/${str(it.label)}`, { component: on ? "Tab/Active" : "Tab", align: "center", gap: 4, ...(hug ? { width: Math.max(markW + 8, 48) } : { grow: 1, width: 0 }), height: h, justify: "center", interactive: true, ...(h < 44 ? { hitArea: 44 } : {}) }, kids);
    });
    const look = {
      fill: "component.nav-bar.fill",
      stroke: { token: "component.nav-bar.border", width: "component.nav-bar.border-width" },
      shadow: "component.nav-bar.shadow",
    };
    if (!floating) return frame("BottomNav", { component: "BottomNav", direction: "row", align: "start", padding: [6, 8, 0, 8], width: "fill", ...look }, tabs);
    // Floating: a rounded bar inset from the edges, drawn inside the nav's own box (no absolute
    // positioning) so it keeps its place through relayouts and per-instance refreshes.
    const inset = dim(ctx, "component.nav-bar.inset", gutterOf(ctx));
    return frame("BottomNav", { component: "BottomNav", width: "fill", align: hug ? "center" : "stretch", padding: [8, inset, 8, inset] }, [
      frame("Bar", { direction: "row", align: "center", height: h, ...(hug ? {} : { width: "fill" }), padding: [0, 8, 0, 8], radius: "component.nav-bar.radius", ...look }, tabs),
    ]);
  },

  EmptyState: (p, ctx) => {
    const kids: LBox[] = [frame("Art", { width: 64, height: 64, align: "center", justify: "center", radius: "radius.pill", fill: "component.empty.art-fill" }, [icon(str(p.icon), 28, "component.empty.art-icon", ctx)])];
    if (p.title) kids.push(text(str(p.title), "title", "text.primary", { align: "center" }));
    // Without a title, the body is the message.
    if (p.body) kids.push(text(str(p.body), "body", p.title ? "text.secondary" : "text.primary", { align: "center" }));
    if (p.cta) kids.push({ ...BUILDERS.Button({ label: p.cta, variant: "primary", size: "md" }, ctx, []), margin: { top: 8 } });
    return frame("EmptyState", { component: "EmptyState", align: "center", gap: 12, padding: [32, 16, 32, 16], width: "fill", spaceTokens: ["space.300", "space.800"] }, kids);
  },

  InlineAlert: (p, ctx) => {
    const tone = str(p.tone);
    const map: Record<string, [string, string, string]> = {
      success: ["feedback.success-subtle", "circle-check", "text.success"],
      warning: ["feedback.warning-subtle", "alert", "text.warning"],
      error: ["feedback.error-subtle", "circle-x", "text.error"],
      info: ["feedback.info-subtle", "info", "text.info"],
    };
    const [bg, ic, fg] = map[tone] ?? map.info;
    const col = [text(str(p.title), "body-strong", "text.primary")];
    if (p.body) col.push(text(str(p.body), "caption", "text.secondary"));
    return frame(`InlineAlert/${cap(tone)}`, { component: `InlineAlert/${cap(tone)}`, direction: "row", gap: 12, padding: [12, 16, 12, 16], width: "fill", radius: "component.alert.radius", fill: bg, stroke: { token: fg, width: "component.alert.border-width" }, spaceTokens: ["space.300", "space.400"] }, [
      icon(ic, 20, fg, ctx),
      frame("Copy", { gap: 2, grow: 1, width: 0, align: "stretch" }, col),
    ]);
  },

  MediaPlaceholder: (p, ctx) =>
    frame("Media", { component: "Media", ...shape(p, 160), width: "fill", align: "center", justify: "center", gap: 6, radius: "component.media.radius", fill: "component.media.fill", clip: true }, [
      icon(str(p.icon) || "utensils", 32, "icon.brand", ctx),
      ...(p.label ? [text(str(p.label), "caption-strong", "text.link")] : []),
    ]),

  Image: (p, ctx) => {
    const w = typeof p.width === "number" ? Math.round(p.width) : undefined;
    const r = str(p.radius);
    const bg = str(p.background);
    return picture(str(p.alt) || "Image", str(p.src), ctx, {
      width: w ?? "fill",
      ...shape(p, 120),
      radius: r && r !== "none" ? `radius.${r}` : undefined,
      fill: bg === "surface" ? "bg.surface" : bg === "inverse" ? "bg.inverse" : undefined,
    }, p.fit === "contain" ? "contain" : "cover");
  },

  Icon: (p, ctx) => {
    const tone = str(p.tone) || "primary";
    const colors: Record<string, string> = { primary: "icon.primary", secondary: "icon.secondary", brand: "icon.brand", inverse: "icon.inverse", success: "text.success", error: "text.error", link: "text.link" };
    const chosen = colors[tone] ?? "icon.primary";
    // A brand or link tint that measures dark would vanish on a dark surface (a pin on a brand band).
    const vanishes = ctx.onDark && (tone === "brand" || tone === "link") && isDarkColor(T(ctx).paint(chosen)?.color);
    return icon(str(p.icon), Number(p.size ?? 20) || 20, vanishes ? "icon.inverse" : onSurface(ctx, tone, chosen, "icon.inverse"), ctx);
  },

  Stepper: (p, ctx) => {
    const step = (name: string, glyph: string, color: string) => frame(name, { width: 24, height: 24, align: "center", justify: "center", interactive: true, hitArea: 44 }, [icon(glyph, 20, color, ctx)]);
    return frame(
      "Stepper",
      {
        component: "Stepper",
        direction: "row",
        align: "center",
        gap: 16,
        padding: [0, 12, 0, 12],
        height: dim(ctx, "component.search.height", 40),
        radius: "component.input.radius",
        fill: "component.input.fill",
        stroke: { token: "component.input.border", width: "component.input.border-width" },
      },
      [step("Decrease", "minus", "icon.secondary"), text(String(Math.round(Number(p.value ?? 1))), "body-strong", "text.primary", { align: "center" }), step("Increase", "plus", "icon.primary")],
    );
  },

  Graphic: (p, ctx) => {
    const W = typeof p.width === "number" ? Math.round(p.width) : undefined;
    const H = Math.round(Number(p.height ?? 120));
    const label = str(p.label) || "Graphic";
    const fit = str(p.fit) || "fixed";
    // Drawn at width × height; fill and backdrop stretch it, and its shapes follow their pins.
    const stretchy = fit === "fill" || fit === "backdrop";
    const flags: Flag[] = [];
    const kids: LBox[] = [];
    const role = (v: unknown) => (typeof v === "string" && v && v !== "none" ? v : undefined);
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    const DASH: Record<string, number[] | undefined> = { dashed: [6, 4], dotted: [1.5, 3] };
    /** An outline being composed: its parts, painted with its first shape's colours. */
    let group: { parts: ShapePart[]; fill?: string; stroke?: { token: string; width: number; dash?: number[] }; shadow?: string; name: string; legacy?: LBox } | null = null;
    const flush = () => {
      if (!group) return;
      const g = group;
      group = null;
      const one = g.parts.length === 1 ? g.parts[0] : null;
      // A lone rect, ellipse or path that stays put is the layer it always was.
      if (one && g.legacy && one.pinX === "start" && one.pinY === "top" && !one.centerOn && (!stretchy || W === undefined)) return void kids.push(g.legacy);
      kids.push({
        kind: "path",
        name: g.name,
        path: { d: "M0 0Z", vw: 1, vh: 1 },
        recipe: { ref: { ...(W !== undefined ? { w: W } : {}), h: H }, dir: ctx.dir, parts: g.parts },
        // As big as the graphic, on every relayout: its outline is rebuilt for that size.
        absolute: { top: 0, start: 0, end: 0, bottom: 0 },
        fillParent: true,
        fill: g.fill,
        ...(g.stroke ? { stroke: g.stroke } : {}),
        ...(g.shadow ? { shadow: g.shadow } : {}),
      });
    };
    ((p.shapes as Props[] | undefined) ?? []).forEach((s, i) => {
      const kind = str(s.kind) || "rect";
      const what = `${label} shape ${i + 1} (${kind})`;
      const [x, y, w, h] = [n(s.x), n(s.y), n(s.w), n(s.h)];
      const fill = role(s.fill);
      const stroke = role(s.stroke);
      const sw = stroke ? Math.max(0, Math.min(8, s.strokeWidth === undefined ? 2 : Number(s.strokeWidth) || 0)) : 0;
      const dash = DASH[str(s.dash)];
      const outline = stroke && sw > 0 ? { stroke: { token: stroke, width: sw, ...(dash ? { dash } : {}) } } : {};
      const combine = str(s.combine) || "none";
      const pinX = (str(s.pinX) || "start") as ShapePart["pinX"];
      const pinY = (str(s.pinY) || "top") as ShapePart["pinY"];
      const centerOn = Number(s.centerOn) > 0 ? Math.round(Number(s.centerOn)) : undefined;
      if (centerOn && fit !== "backdrop") flags.push({ rule: "graphic-pins", severity: "info", message: `${what} lines up with a part of its container, but only a backdrop has one, so it stays where it is.` });
      if ((pinX !== "start" || pinY !== "top") && W === undefined && stretchy)
        flags.push({ rule: "graphic-pins", severity: "warning", message: `${what} is pinned, but ${label} has no width to draw it at, so it stays where it is.` });
      let box: LBox;
      let area: { x: number; y: number; w: number; h: number };
      let part: ShapePart | null = null;
      if (kind === "path") {
        // Bad path data was flagged (and dropped) by prop validation.
        const parsed = s.d ? parsePath(str(s.d)) : null;
        if (!parsed || parsed.error) return;
        if (!fill && !outline.stroke && combine === "none") {
          flags.push({ rule: "graphic-bounds", severity: "warning", message: `${what} has no fill or outline, so it paints nothing.` });
          return;
        }
        // The node is the path's own box (grown by half the outline), placed where the path sits.
        const b = pathBounds(parsed.segs);
        const pad = Math.ceil(sw / 2);
        const vw = Math.max(1, Math.ceil(b.w + 2 * pad));
        const vh = Math.max(1, Math.ceil(b.h + 2 * pad));
        const d = toD(translatePath(parsed.segs, pad - b.x, pad - b.y));
        area = { x: b.x - pad, y: b.y - pad, w: vw, h: vh };
        box = { kind: "path", name: `Vector ${i + 1}`, width: vw, height: vh, fill, ...outline, path: { d, vw, vh }, absolute: { top: area.y, start: area.x } };
        part = { kind: "path", op: "base", x: b.x, y: b.y, w: b.w, h: b.h, d: toD(parsed.segs), pinX, pinY };
      } else if (kind === "text" || kind === "icon") {
        if (combine !== "none") flags.push({ rule: "graphic-combine", severity: "info", message: `${what} can't join an outline (only shapes can), so it's drawn on its own.` });
        // Pinned to the end edge or stretched: placed from that edge (the graphic's width is the reference).
        const ref = W;
        const insetX = (bw: number) =>
          ref !== undefined && stretchy && pinX === "end" ? { end: ref - x - bw } : ref !== undefined && stretchy && pinX === "stretch" ? { start: x, end: ref - x - bw } : { start: x };
        const insetY = (bh: number) => (stretchy && pinY === "bottom" ? { bottom: H - y - bh } : { top: y });
        if (kind === "text") {
          const content = str(s.text);
          if (!content) return;
          const align = str(s.align) as "start" | "center" | "end";
          const stretched = ref !== undefined && stretchy && pinX === "stretch";
          box = text(content, str(s.style) || "body", fill ?? "text.primary", { align: align || undefined, maxLines: 2, width: w > 0 && !stretched ? w : undefined, absolute: { ...insetY(h || 20), ...insetX(w) } });
          area = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
        } else {
          const size = Math.max(8, Math.min(96, w || h || 24));
          box = icon(str(s.icon) || "help", size, fill ?? "icon.primary", ctx, { absolute: { ...insetY(size), ...insetX(size) } });
          area = { x, y, w: size, h: size };
        }
      } else {
        if (w <= 0 || h <= 0) {
          flags.push({ rule: "graphic-bounds", severity: "warning", message: `${what} has no size, so it paints nothing.` });
          return;
        }
        if (!fill && !outline.stroke && combine === "none") {
          flags.push({ rule: "graphic-bounds", severity: "warning", message: `${what} has no fill or outline, so it paints nothing.` });
          return;
        }
        const r = str(s.radius);
        const rpx = kind === "rect" && r && r !== "none" ? (r === "pill" ? Math.min(w, h) / 2 : (T(ctx).dimension(`radius.${r}`) ?? 0)) : 0;
        box = {
          kind: kind === "ellipse" ? "ellipse" : "rect",
          name: kind === "ellipse" ? `Ellipse ${i + 1}` : `Shape ${i + 1}`,
          width: w,
          height: h,
          fill,
          ...outline,
          radius: kind === "rect" && r && r !== "none" ? `radius.${r}` : undefined,
          absolute: { top: y, start: x },
        };
        area = { x, y, w, h };
        const k = kind === "polygon" || kind === "star" || kind === "ellipse" ? kind : "rect";
        part = { kind: k, op: "base", x, y, w, h, pinX, pinY, ...(rpx ? { radius: rpx } : {}) };
        if (k === "polygon" || k === "star") Object.assign(part, { count: Number(s.count) || (k === "star" ? 5 : 3), ...(k === "star" ? { ratio: Number(s.ratio) || 0.5 } : {}), ...(s.rotation ? { rotation: Number(s.rotation) } : {}) });
      }
      // Cropped at the edge is a choice; wholly outside never shows (cut-outs may sit half outside, never wholly).
      const outside = area.y >= H || area.y + area.h <= 0 || (W !== undefined && (area.x >= W || area.x + area.w <= 0));
      if (outside) {
        flags.push({ rule: "graphic-bounds", severity: "warning", message: `${what} is outside the ${W ?? "full-width"}×${H} graphic, so it never shows.` });
        return;
      }
      if (!part) {
        flush();
        kids.push(box);
        return;
      }
      if (centerOn && fit === "backdrop") part.centerOn = centerOn;
      if (combine !== "none" && group) {
        group.parts.push({ ...part, op: combine as ShapePart["op"] });
        group.legacy = undefined;
        return;
      }
      if (combine !== "none") flags.push({ rule: "graphic-combine", severity: "info", message: `${what} has nothing before it to ${combine} with, so it's drawn on its own.` });
      flush();
      const composed = part.kind === "polygon" || part.kind === "star";
      group = { parts: [part], fill, ...(outline.stroke ? { stroke: outline.stroke } : {}), ...(s.shadow && s.shadow !== "none" ? { shadow: `shadow.${str(s.shadow)}` } : {}), name: composed ? `${cap(part.kind)} ${i + 1}` : box.name, ...(composed || (s.shadow && s.shadow !== "none") || dash ? {} : { legacy: box }) };
    });
    flush();
    if (!kids.length) flags.push({ rule: "graphic-empty", severity: "error", message: `Graphic "${label}" draws nothing.` });
    const f = flags.length ? flags : undefined;
    // A backdrop is its container's surface: as big as the container, behind its parts, not clipped (its shadow shows).
    if (fit === "backdrop") return frame(label, { component: "Graphic", absolute: { top: 0, start: 0, end: 0, bottom: 0 }, fillParent: true, backdrop: true, flags: f }, kids);
    return frame(label, { component: "Graphic", width: fit === "fill" ? "fill" : (W ?? "fill"), height: H, clip: true, flags: f }, kids);
  },

  SummaryRow: (p) =>
    frame("SummaryRow", { component: "SummaryRow", direction: "row", justify: "between", align: "center", width: "fill", gap: 12, padding: [4, 0, 4, 0] }, [
      text(str(p.label), p.emphasis ? "headline" : "body", p.emphasis ? "text.primary" : "text.secondary", { grow: 1, maxLines: 1 }),
      text(str(p.value), p.emphasis ? "headline" : "body-strong", "text.primary", { maxLines: 1 }),
    ]),

  Rating: (p, ctx) =>
    frame("Rating", { component: "Rating", direction: "row", align: "center", gap: 4 }, [
      icon("star", 14, "icon.brand", ctx),
      text(Number(p.value ?? 0).toFixed(1), "caption-strong", "text.primary"),
      ...(p.count ? [text(str(p.count), "caption", "text.secondary")] : []),
    ]),

  SegmentedControl: (p) => {
    const opts = (p.options as string[]) ?? [];
    const sel = Number(p.selected ?? 0);
    return frame(
      "SegmentedControl",
      { component: "SegmentedControl", direction: "row", padding: [4, 4, 4, 4], gap: 4, width: "fill", radius: "component.segmented.radius", fill: "component.segmented.track-fill" },
      opts.map((o, i) =>
        // 36px segments in a track padded by 4px: the tap target is the track's full 44px height.
        frame(`Segment/${o}`, { align: "center", justify: "center", height: 36, grow: 1, width: 0, radius: "component.segmented.radius", fill: i === sel ? "component.segmented.selected.fill" : undefined, shadow: i === sel ? "component.segmented.selected.shadow" : undefined, interactive: true, hitArea: 44 }, [
          text(o, i === sel ? "body-strong" : "body", i === sel ? "text.primary" : "text.secondary", { maxLines: 1 }),
        ]),
      ),
    );
  },

  Tabs: (p, ctx) => {
    const tabs = (p.tabs as string[]) ?? [];
    const sel = Number(p.selected ?? 0);
    // Up to three tabs share the width; more sit side by side from the start edge.
    const equal = tabs.length <= 3;
    const h = dim(ctx, "component.tabs.height", 44);
    if (style(ctx, "component.tabs.style.indicator") === "pill") {
      // The selected tab sits in a filled pill; no underline, no border.
      const pills = tabs.map((t, i) =>
        frame(
          `Tab/${t}`,
          {
            component: i === sel ? "Tab/Selected" : "Tab",
            align: "center",
            justify: "center",
            height: Math.max(28, h - 8),
            padding: [0, 12, 0, 12],
            ...(equal ? { grow: 1, width: 0 } : {}),
            radius: i === sel ? "component.tabs.pill-radius" : undefined,
            fill: i === sel ? "component.tabs.pill-fill" : undefined,
            interactive: true,
            hitArea: 44,
          },
          [text(t, i === sel ? "body-strong" : "body", i === sel ? "component.tabs.active-label" : "component.tabs.label", { align: "center", maxLines: 1 })],
        ),
      );
      return frame("Tabs", { component: "Tabs", direction: "row", align: "center", gap: equal ? 4 : 8, width: "fill", height: h }, pills);
    }
    const border = dim(ctx, "component.tabs.border-width", 1);
    const kids: LBox[] = tabs.map((t, i) =>
      frame(
        `Tab/${t}`,
        { component: i === sel ? "Tab/Selected" : "Tab", align: "center", justify: "center", height: h, padding: [0, 8, 0, 8], ...(equal ? { grow: 1, width: 0 } : {}), interactive: true },
        [
          text(t, i === sel ? "body-strong" : "body", i === sel ? "component.tabs.active-label" : "component.tabs.label", { align: "center", maxLines: 1 }),
          ...(i === sel ? [rect("Indicator", { height: Math.max(1, dim(ctx, "component.tabs.indicator-height", 2)), fill: "component.tabs.indicator", radius: "radius.pill", absolute: { bottom: 0, start: 0, end: 0 } })] : []),
        ],
      ),
    );
    if (border > 0) kids.unshift(rect("Border", { height: border, fill: "component.tabs.border", absolute: { bottom: 0, start: 0, end: 0 } }));
    return frame("Tabs", { component: "Tabs", direction: "row", gap: equal ? 0 : 16, width: "fill", height: h }, kids);
  },

  Table: (p, ctx) => {
    const cols = (p.columns as string[]) ?? [];
    const rows = ((p.rows as Props[]) ?? []).map((r) => (Array.isArray(r.cells) ? (r.cells as unknown[]).map(String) : []));
    const n = Math.max(cols.length, ...rows.map((r) => r.length), 1);
    const status = Number(p.statusColumn ?? -1);
    const numeric = Array.from({ length: n }, (_, c) => c !== status && rows.length > 0 && rows.filter((r) => isNumeric(r[c] ?? "")).length >= Math.ceil(rows.length * 0.6));
    // Laid out column by column, so every column is as wide as its widest cell in every row: short,
    // numeric and status columns fit their content; longer text columns share what's left.
    const longest = (c: number) => Math.max([...(cols[c] ?? "")].length, ...rows.map((r) => [...(r[c] ?? "")].length));
    const fits = Array.from({ length: n }, (_, c) => numeric[c] || c === status || longest(c) <= 12);
    const headH = 40;
    const rowH = dim(ctx, "component.table.row-height", 52);
    const cell = (c: number, h: number, content: LBox) =>
      frame("Cell", { direction: "row", align: "center", justify: numeric[c] ? "end" : "start", height: h, ...(fits[c] ? {} : { width: "fill" }) }, [content]);
    const line = (c: number, s: string, style: string, color: string) => text(s, style, color, { maxLines: 1, align: numeric[c] ? "end" : "start", ...(fits[c] ? {} : { width: "fill" }) });
    const columns = Array.from({ length: n }, (_, c) =>
      frame(`Column/${cols[c] ?? c + 1}`, { align: numeric[c] ? "end" : "stretch", ...(fits[c] ? {} : { grow: c === 0 ? 1.4 : 1, width: 0 }) }, [
        cell(c, headH, line(c, cols[c] ?? "", "caption-strong", "component.table.header-label")),
        ...rows.map((r) =>
          cell(c, rowH, c === status && r[c] ? BUILDERS.Tag({ label: r[c], tone: statusTone(r[c]) }, ctx, []) : line(c, r[c] ?? "", c === 0 ? "body-strong" : "body", c === 0 || numeric[c] ? "text.primary" : "text.secondary")),
        ),
      ]),
    );
    const behind: LBox[] = [
      rect("Header fill", { height: headH, fill: "component.table.header-fill", radius: "component.table.radius", absolute: { top: 0, start: 0, end: 0 } }),
      ...rows.slice(1).map((_, i) => rect("Divider", { height: 1, fill: "component.table.divider", absolute: { top: headH + (i + 1) * rowH, start: 0, end: 0 } })),
    ];
    return frame("Table", { component: "Table", width: "fill", align: "stretch" }, [
      ...behind,
      frame("Columns", { direction: "row", gap: 16, padding: [0, 12, 0, 12], width: "fill" }, columns),
    ]);
  },

  Chart: (p, ctx) => {
    const labels = (p.labels as string[]) ?? [];
    const values = ((p.values as number[]) ?? []).map((v) => Math.max(0, Number(v) || 0));
    const count = Math.max(labels.length, values.length);
    const max = Math.max(...values, 0) || 1;
    const hi = Number(p.highlight ?? -1);
    const unit = str(p.unit);
    const fmt = (v: number) => {
      const s = v.toLocaleString("en-US", { maximumFractionDigits: 1 });
      return !unit ? s : unit === "%" || unit === "k" ? `${s}${unit}` : ctx.lang === "ar" ? `${s} ${unit}` : `${unit} ${s}`;
    };
    const kids: LBox[] = p.title ? [text(str(p.title), "headline", "text.primary")] : [];
    if (p.variant === "hbars") {
      kids.push(
        ...Array.from({ length: count }, (_, i) => {
          const pct = (values[i] ?? 0) / max;
          const on = i === hi;
          return frame(`Bar/${labels[i] ?? i + 1}`, { direction: "row", align: "center", gap: 12, width: "fill" }, [
            text(labels[i] ?? "", on ? "caption-strong" : "caption", on ? "text.primary" : "component.chart.label", { width: 72, maxLines: 1 }),
            frame("Track", { direction: "row", height: 10, grow: 1, width: 0, radius: "radius.pill", fill: "component.chart.track", clip: true }, [
              rect("Value", { height: 10, width: 0, grow: pct, radius: "radius.pill", fill: on || hi < 0 ? "component.chart.bar-highlight" : "component.chart.bar" }),
              rect("Rest", { height: 10, width: 0, grow: 1 - pct }),
            ]),
            text(fmt(values[i] ?? 0), "caption-strong", "text.primary", { maxLines: 1 }),
          ]);
        }),
      );
      return frame("Chart", { component: "Chart/Horizontal", gap: 10, width: "fill", align: "stretch" }, kids);
    }
    const h = Math.round(Math.min(320, Math.max(120, Number(p.height ?? 180))));
    const room = h - 22; // space for the highlighted value above its bar
    const grid = [0, 0.5, 1].map((f) => rect("Grid", { height: 1, fill: "component.chart.grid", absolute: { top: Math.round(22 + f * (room - 1)), start: 0, end: 0 } }));
    const bars = Array.from({ length: count }, (_, i) => {
      const v = values[i] ?? 0;
      const on = i === hi;
      return frame(`Bar/${labels[i] ?? i + 1}`, { justify: "end", align: "center", gap: 4, grow: 1, width: 0, height: h }, [
        ...(on ? [text(fmt(v), "caption-strong", "text.primary", { align: "center", maxLines: 1 })] : []),
        rect("Value", {
          height: Math.max(2, Math.round((v / max) * room)),
          width: "fill",
          radius: { token: "component.chart.bar-radius", corners: [true, true, false, false] },
          fill: on ? "component.chart.bar-highlight" : "component.chart.bar",
        }),
      ]);
    });
    const gap = count > 8 ? 6 : 12;
    kids.push(frame("Plot", { direction: "row", align: "end", gap, height: h, width: "fill" }, [...grid, ...bars]));
    kids.push(frame("Labels", { direction: "row", gap, width: "fill" }, Array.from({ length: count }, (_, i) => text(labels[i] ?? "", i === hi ? "caption-strong" : "caption", i === hi ? "text.primary" : "component.chart.label", { align: "center", grow: 1, width: 0, maxLines: 1 }))));
    return frame("Chart", { component: "Chart/Bars", gap: 8, width: "fill", align: "stretch" }, kids);
  },

  Carousel: (p, ctx, children) => {
    const w = Math.round(Math.min(320, Math.max(72, Number(p.itemWidth ?? 240))));
    const gapKey = str(p.gap) || "300";
    // On phones the row runs off the end edge so the next item peeks in.
    const bleed = wide(ctx) ? 0 : gutterOf(ctx);
    // Cards side by side are one height (the tallest), with a trailing action on one line: a
    // spacer before it takes the room left, net of the gap it adds.
    const items = children.map((c): LBox => {
      const ks = c.kind === "frame" && (c.direction ?? "column") === "column" ? (c.children ?? []) : [];
      const last = ks[ks.length - 1];
      const isAct = (b: LBox | undefined) => !!b?.component && (b.component.startsWith("Button") || b.component.startsWith("IconButton"));
      // The action itself, or the row that holds it (a price with its Add or Reorder).
      const action = ks.length > 1 && (isAct(last) || (last?.direction === "row" && (last.children ?? []).some(isAct)));
      const body = action ? [...ks.slice(0, -1), frame("Spacer", { grow: 1, height: 0, margin: { top: -(c.gap ?? 0) } }), last] : c.children;
      return { ...c, width: w, grow: undefined, children: body };
    });
    const kids: LBox[] = [];
    if (p.title || p.action)
      kids.push(
        frame("Header", { direction: "row", align: "center", justify: "between", gap: 12, width: "fill" }, [
          text(str(p.title), "headline", "text.primary", { grow: 1, maxLines: 1 }),
          ...(p.action ? [text(str(p.action), "label", "text.link", { maxLines: 1 })] : []),
        ]),
      );
    kids.push(frame("Track", { direction: "row", align: "stretch", gap: sp(ctx, gapKey), width: "fill", clip: true, margin: bleed ? { end: -bleed } : undefined, spaceTokens: [`space.${gapKey}`] }, items));
    return frame("Carousel", { component: "Carousel", gap: 12, width: "fill", align: "stretch" }, kids);
  },

  // --- desktop tools -------------------------------------------------------

  Toolbar: (p, ctx) => {
    const tools = (p.tools as Props[]) ?? [];
    const sel = Number(p.selected ?? -1);
    return frame(
      "Toolbar",
      { component: "Toolbar", direction: "row", align: "center", gap: 2, padding: [2, 2, 2, 2], width: "hug", radius: "component.segmented.radius", fill: "component.segmented.track-fill" },
      tools.map((t, i) =>
        frame(
          `Tool/${str(t.label)}`,
          {
            component: i === sel ? "Tool/Selected" : "Tool",
            width: 32,
            height: 32,
            align: "center",
            justify: "center",
            radius: "component.segmented.radius",
            fill: i === sel ? "component.segmented.selected.fill" : undefined,
            shadow: i === sel ? "component.segmented.selected.shadow" : undefined,
            interactive: true,
          },
          [icon(str(t.icon), 18, i === sel ? "icon.primary" : "icon.secondary", ctx)],
        ),
      ),
    );
  },

  Player: (p, ctx) => {
    const h = Math.round(Math.min(560, Math.max(160, Number(p.height ?? 360))));
    const viewer = frame("Viewer", { component: "Player/Viewer", height: h, width: "fill", align: "center", justify: "center", gap: 12, radius: "component.media.radius", fill: "bg.inverse", clip: true }, [
      frame("Play", { width: 56, height: 56, align: "center", justify: "center", radius: "radius.pill", fill: "bg.brand", interactive: true }, [icon("play", 24, "text.on-brand", ctx)]),
      ...(p.label ? [text(str(p.label), "caption-strong", "text.inverse", { align: "center", maxLines: 1 })] : []),
    ]);
    if (p.controls === "none") return frame("Player", { component: "Player", width: "fill", align: "stretch" }, [viewer]);
    const pct = Math.min(1, Math.max(0, Number(p.progress ?? 0) / 100));
    const control = (name: string, label: string, main = false) =>
      frame(label, {
        component: main ? "IconButton/Brand" : "IconButton/Ghost",
        width: main ? 36 : 32,
        height: main ? 36 : 32,
        align: "center",
        justify: "center",
        radius: "component.icon-button.radius",
        fill: main ? "component.icon-button.brand-fill" : undefined,
        interactive: true,
      }, [icon(name, 18, main ? "component.icon-button.brand-icon" : "icon.primary", ctx)]);
    const time = [str(p.current), str(p.duration)].filter(Boolean).join(" / ");
    const bar = frame("Transport", { direction: "row", align: "center", gap: 8, width: "fill" }, [
      control("skip-back", "Back 5 seconds"),
      control("play", "Play", true),
      control("skip-forward", "Forward 5 seconds"),
      ...(time ? [text(time, "caption-strong", "text.primary", { maxLines: 1 })] : []),
      frame("Scrubber", { component: "Scrubber", direction: "row", align: "center", height: 24, grow: 1, width: 0, interactive: true }, [
        rect("Played", { height: 4, width: 0, grow: pct, radius: "radius.pill", fill: "bg.brand-strong" }),
        { kind: "ellipse", name: "Handle", width: 12, height: 12, fill: "bg.brand-strong" },
        rect("Rest", { height: 4, width: 0, grow: 1 - pct, radius: "radius.pill", fill: "border.default" }),
      ]),
      control("volume-2", "Volume"),
      control("maximize-2", "Full screen"),
    ]);
    return frame("Player", { component: "Player", gap: 8, width: "fill", align: "stretch" }, [viewer, bar]);
  },

  Timeline: (p, ctx) => {
    const duration = Math.max(1, Number(p.duration ?? 60));
    const at = (v: unknown) => Math.min(duration, Math.max(0, Number(v) || 0));
    const head = at(p.playhead);
    const tracks = (p.tracks as Props[]) ?? [];
    const labelW = 112;
    const rulerH = 24;
    const laneH = 40;
    const gap = 4;
    const step = tickStep(duration);
    const ticks: LBox[] = [];
    for (let t = 0; t < duration; t += step)
      ticks.push(
        // No padding on anything sized by time: Yoga never shrinks a box below its padding, which would skew the scale.
        frame(`Tick/${timecode(t)}`, { direction: "row", align: "center", grow: Math.min(step, duration - t), width: 0, height: rulerH }, [
          rect("Mark", { width: 1, fill: "border.default", absolute: { top: 0, bottom: 0, start: 0 } }),
          text(timecode(t), "caption", "text.secondary", { maxLines: 1, margin: { start: 6 } }),
        ]),
      );
    const clipBox = (c: Props, start: number, end: number, kind: string): LBox => {
      const look = CLIP_LOOK[kind] ?? CLIP_LOOK.video;
      const label = str(c.label);
      const kids: LBox[] = [
        frame("Label", { direction: "row", align: "center", gap: 4, width: "fill" }, [icon(look.icon, 12, "icon.secondary", ctx), text(label || " ", "caption-strong", "text.primary", { maxLines: 1, grow: 1, width: 0 })]),
      ];
      if (kind === "audio") kids.push(waveform(label, look.accent));
      return frame(
        `Clip/${label || kind}`,
        {
          component: c.selected ? "Clip/Selected" : "Clip",
          grow: end - start,
          width: 0,
          height: laneH,
          justify: "center",
          align: "stretch",
          radius: "radius.xs",
          fill: look.fill,
          stroke: c.selected ? { token: "bg.brand-strong", width: 2 } : { token: "border.default", width: 1 },
          clip: true,
        },
        [frame("Content", { gap: 2, padding: [0, 6, 0, 6], width: "fill", align: "stretch" }, kids)],
      );
    };
    const lane = (tr: Props): LBox => {
      const kind = str(tr.kind) || "video";
      // In time order; a clip that overlaps the one before it starts where that one ends.
      const clips = ((tr.clips as Props[]) ?? []).map((c) => ({ c, s: at(c.start), e: at(c.end) })).sort((a, b) => a.s - b.s);
      const kids: LBox[] = [];
      let cursor = 0;
      for (const { c, s, e } of clips) {
        const from = Math.max(s, cursor);
        if (e <= from) continue;
        if (from > cursor) kids.push(rect("Gap", { width: 0, grow: from - cursor, height: 1 }));
        kids.push(clipBox(c, from, e, kind));
        cursor = e;
      }
      if (cursor < duration) kids.push(rect("Gap", { width: 0, grow: duration - cursor, height: 1 }));
      return frame(`Lane/${str(tr.label)}`, { direction: "row", align: "center", height: laneH, width: "fill", radius: "radius.xs", fill: "bg.canvas" }, kids);
    };
    const trackHead = (tr: Props): LBox =>
      frame(`Track/${str(tr.label)}`, { direction: "row", align: "center", gap: 6, height: laneH, width: "fill" }, [
        icon((CLIP_LOOK[str(tr.kind)] ?? CLIP_LOOK.video).icon, 14, "icon.secondary", ctx),
        text(str(tr.label), "caption-strong", "text.primary", { maxLines: 1, grow: 1, width: 0 }),
      ]);
    const pct = head / duration;
    // Pinned over the ruler and lanes; the line sits where the playhead is.
    const playhead = frame("Playhead", { direction: "row", absolute: { top: 0, bottom: 0, start: 0, end: 0 } }, [
      rect("Before", { width: 0, grow: pct, height: 1 }),
      frame("Head", { width: 12, height: "fill", align: "center", margin: { start: -6, end: -6 } }, [
        rect("Handle", { width: 12, height: 12, radius: "radius.xs", fill: "bg.brand-strong" }),
        rect("Line", { width: 2, height: 0, grow: 1, fill: "bg.brand-strong" }),
      ]),
      rect("After", { width: 0, grow: 1 - pct, height: 1 }),
    ]);
    return frame("Timeline", { component: "Timeline", direction: "row", gap: 8, width: "fill", align: "start" }, [
      frame("Tracks", { width: labelW, gap, align: "stretch" }, [
        frame("Time", { direction: "row", align: "center", height: rulerH, width: "fill" }, [text(`${timecode(head)} / ${timecode(duration)}`, "caption-strong", "text.primary", { maxLines: 1 })]),
        ...tracks.map(trackHead),
      ]),
      frame("Lanes", { grow: 1, width: 0, gap, align: "stretch" }, [frame("Ruler", { direction: "row", height: rulerH, width: "fill" }, ticks), ...tracks.map(lane), playhead]),
    ]);
  },

  Slider: (p) => {
    const v = Math.min(1, Math.max(0, Number(p.value ?? 0) / 100));
    return frame("Slider", { component: "Slider", gap: 4, width: "fill", align: "stretch" }, [
      frame("Label", { direction: "row", align: "center", justify: "between", gap: 8, width: "fill" }, [
        text(str(p.label), "caption", "text.secondary", { maxLines: 1, grow: 1, width: 0 }),
        ...(p.valueText ? [text(str(p.valueText), "caption-strong", "text.primary", { maxLines: 1 })] : []),
      ]),
      frame("Track", { direction: "row", align: "center", height: 24, width: "fill", interactive: true }, [
        rect("Value", { height: 4, width: 0, grow: v, radius: "radius.pill", fill: "bg.brand-strong" }),
        frame("Knob", { width: 16, height: 16, radius: "radius.pill", fill: "bg.canvas", stroke: { token: "bg.brand-strong", width: 2 }, shadow: "shadow.sm" }),
        rect("Rest", { height: 4, width: 0, grow: 1 - v, radius: "radius.pill", fill: "border.default" }),
      ]),
    ]);
  },

  PropertyRow: (p, ctx) => {
    const control = str(p.control) || "text";
    const value = str(p.value);
    const label = (grow: boolean) => text(str(p.label), "caption", "text.secondary", { maxLines: 1, ...(grow ? { grow: 1, width: 0 } : { width: 96 }) });
    const field = (kids: LBox[]) =>
      frame("Field", {
        direction: "row",
        align: "center",
        gap: 6,
        height: 28,
        grow: 1,
        width: 0,
        padding: [0, 8, 0, 8],
        radius: "component.input.radius",
        fill: "component.input.fill",
        stroke: { token: "component.input.border", width: "component.input.border-width" },
        interactive: true,
      }, kids);
    const valueText = (align: "start" | "center" = "start") => text(value || " ", "caption", "text.primary", { maxLines: 1, grow: 1, width: 0, align });
    let right: LBox;
    if (control === "toggle") {
      const on = !!p.on;
      right = frame("Toggle", { component: on ? "Toggle/On" : "Toggle", direction: "row", align: "center", justify: on ? "end" : "start", width: 36, height: 20, padding: [2, 2, 2, 2], radius: "radius.pill", fill: on ? "bg.brand-strong" : "border.default", interactive: true, hitArea: 24 }, [
        { kind: "ellipse", name: "Knob", width: 16, height: 16, fill: on ? "bg.brand" : "bg.canvas" },
      ]);
    } else if (control === "field") right = field([valueText()]);
    else if (control === "select") right = field([valueText(), icon("chevron-down", 14, "icon.secondary", ctx)]);
    else if (control === "stepper") right = field([icon("minus", 14, "icon.secondary", ctx), valueText("center"), icon("plus", 14, "icon.secondary", ctx)]);
    else right = text(value || " ", "caption-strong", "text.primary", { maxLines: 1, grow: 1, width: 0 });
    return frame("PropertyRow", { component: `PropertyRow/${cap(control)}`, direction: "row", align: "center", gap: 8, minHeight: 32, width: "fill" }, [label(control === "toggle"), right]);
  },

  Panel: (p, _ctx, children) => {
    const w = Math.round(Math.min(480, Math.max(200, Number(p.width ?? 300))));
    return frame(
      "Panel",
      { component: "Panel", width: w, gap: 12, padding: [16, 16, 16, 16], align: "stretch", radius: "component.card.radius", fill: "bg.surface", stroke: { token: "border.subtle", width: 1 }, clip: true, spaceTokens: ["space.400", "space.300"] },
      p.title ? [text(str(p.title), "body-strong", "text.primary", { maxLines: 1 }), ...children] : children,
    );
  },
};

/** How each kind of Timeline track looks: clip fill, icon, and the accent of an audio waveform. */
const CLIP_LOOK: Record<string, { fill: string; icon: string; accent: string }> = {
  video: { fill: "bg.brand-subtle", icon: "film", accent: "bg.brand-strong" },
  audio: { fill: "feedback.info-subtle", icon: "audio", accent: "feedback.info" },
  text: { fill: "feedback.warning-subtle", icon: "type", accent: "text.warning" },
  effect: { fill: "bg.surface-raised", icon: "wand-sparkles", accent: "icon.secondary" },
};

/** Ruler spacing for a timeline: a round step that gives at most ten ticks. */
function tickStep(duration: number): number {
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]) if (duration / s <= 10) return s;
  return Math.ceil(duration / 10);
}

/** 83 → "01:23", 3725 → "1:02:05". */
export function timecode(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A stylised audio waveform: bar heights come from the clip's name, so it looks the same every build. */
function waveform(seed: string, color: string): LBox {
  let h = 2166136261;
  for (const ch of seed || "audio") h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const bars = Array.from({ length: 24 }, (_, i) => {
    const wobble = Math.abs(Math.sin((i + 1) * 1.7 + (h % 97))) * 0.6 + Math.abs(Math.sin((i + 3) * 0.45 + (h % 13))) * 0.4;
    return rect("Bar", { width: 0, grow: 1, height: 3 + Math.round(11 * wobble), radius: "radius.xs", fill: color });
  });
  return frame("Waveform", { direction: "row", align: "center", gap: 1, height: 14, width: "fill" }, bars);
}

/** A table cell that reads as a number or an amount (aligned to the end edge). */
function isNumeric(s: string): boolean {
  // "#48213" is an identifier, not an amount.
  if (/^\s*#/.test(s)) return false;
  const core = s.replace(/AED|USD|SAR|EGP|EUR|GBP|د\.إ|ر\.س|ج\.م|[$€£%+\-−,\s]/g, "");
  return core.length > 0 && /^[\d٠-٩.]+[kKmM]?$/.test(core);
}

/** Tag tone for a status cell, from what the word means (English and Arabic). */
function statusTone(s: string): string {
  if (/\b(paid|complete[d]?|delivered|active|success(ful)?|approved|done|online|live|resolved)\b|مدفوع|مكتمل|تم التوصيل|نشط|مقبول/i.test(s)) return "success";
  if (/\b(pending|processing|preparing|in review|review|scheduled|late|delayed|in progress|on hold|waiting)\b|قيد|معلق|متأخر|بانتظار/i.test(s)) return "warning";
  if (/\b(failed|declined|cancel(l)?ed|overdue|error|refunded|blocked|offline|rejected|churned)\b|فشل|ملغ|مرفوض|متوقف|مسترد/i.test(s)) return "error";
  if (/\b(new|draft|open|info)\b|جديد|مسودة/i.test(s)) return "info";
  return "neutral";
}

function divider(ctx: BuildCtx): LBox {
  return rect("Divider", { component: "Divider", height: Math.max(1, dim(ctx, "component.divider.thickness", 1)), width: "fill", fill: "component.divider.color" });
}

/** A divider a ListItem got from the system's list style (not from its own divider prop). */
const AUTO_DIVIDER = "Divider/auto";

/** The last row of each run of ListItems drops its system divider: lines go between rows, not after the list. */
function trimAutoDividers(kids: LBox[]): LBox[] {
  return kids.map((k, i) => {
    const last = k.children?.[k.children.length - 1];
    if (k.component !== "ListItem" || last?.name !== AUTO_DIVIDER || kids[i + 1]?.component === "ListItem") return k;
    return { ...k, children: k.children!.slice(0, -1) };
  });
}

/** Runs of list rows in a card sit flush, separated by their dividers, not by the card's gap. */
function flushRows(kids: LBox[]): LBox[] {
  const out: LBox[] = [];
  let run: LBox[] = [];
  const close = () => {
    if (run.length > 1) out.push(frame("Rows", { width: "fill", align: "stretch" }, trimAutoDividers(run)));
    else out.push(...run);
    run = [];
  };
  for (const k of kids) {
    if (k.component === "ListItem") run.push(k);
    else {
      close();
      out.push(k);
    }
  }
  close();
  return out;
}

function pad(v: number): [number, number, number, number] {
  return [v, v, v, v];
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Build a component instance (recursively) into an LBox tree, attaching validation flags. */
/** An error box in place of something the studio can't draw. */
function notInSystem(name: string, message: string, path?: string, rule = "not-in-system"): LBox {
  return frame(`⚠ ${name}`, {
    component: `Unknown/${name}`,
    width: "fill",
    height: 64,
    align: "center",
    justify: "center",
    radius: "radius.md",
    fill: "feedback.error-subtle",
    stroke: { token: "border.error", width: 1 },
    flags: [{ rule, severity: "error", message }],
    specPath: path,
  }, [text(`Not in system: ${name}`, "label", "text.error", { align: "center" })]);
}

/**
 * A Custom instance: the named component's composition with the instance's values filled in,
 * as one instance (its parts aren't instances of their own, so edits and section changes target
 * the whole component).
 */
function buildCustom(inst: Inst, ctx: BuildCtx, path?: string): LBox {
  const flags: Flag[] = [];
  const props = validate(inst, flags, CUSTOM_SPEC);
  const name = str(props.name).trim();
  if (ctx.inCustom) return notInSystem(name || CUSTOM, `${name || "A component"} is placed inside another made component; compose it from catalog parts instead.`, path, "nested-custom");
  const hit = name ? ctx.components?.(name) : undefined;
  if (!hit) return notInSystem(name || CUSTOM, `"${name}" isn't a component of this design system or of this screen.`, path);
  const { def } = hit;
  const declared = new Map((def.props ?? []).map((p) => [p.name, p]));
  const values: Record<string, string> = {};
  for (const p of def.props ?? []) values[p.name] = p.example;
  for (const v of (props.values as Props[] | undefined) ?? []) {
    const k = str(v.prop);
    const p = declared.get(k);
    if (!p) {
      flags.push({ rule: "unknown-prop", severity: "warning", message: `${def.name} has no prop "${k}" (ignored).` });
      continue;
    }
    const val = str(v.value);
    if (p.kind === "text" && [...val].length > p.maxChars) flags.push({ rule: "char-limit", severity: "warning", message: `${def.name}.${k} is ${[...val].length}/${p.maxChars} characters: "${val.slice(0, 40)}…"` });
    values[k] = val;
  }
  if (inst.children?.length) flags.push({ rule: "unexpected-children", severity: "info", message: `${def.name} does not take children; they were dropped.` });
  const box = buildInstance(fillComposition(def, values), { ...ctx, inCustom: true });
  box.name = def.name;
  box.component = `${CUSTOM}/${def.name}`;
  if (hit.from === "local")
    flags.push({ rule: "local-component", severity: "info", message: `${def.name} was made for this screen and isn't in the design system yet. Add it from the chat or the component library so other screens reuse it.` });
  if (path !== undefined) box.specPath = path;
  box.flags = [...(box.flags ?? []), ...flags];
  return box;
}

/** The surface a container gives its children: a dark card makes their text light, a filled light one dark again. */
/** The fill of a Card of this tone (the strong brand card is a recipe: a system can make its hero cards a gradient). */
const cardFill = (tone: string) => ({ surface: "bg.surface", raised: "bg.surface-raised", "brand-subtle": "bg.brand-subtle", "brand-strong": "component.card.brand-fill", inverse: "bg.inverse" })[tone] ?? "bg.surface-raised";
const STACK_FILL: Record<string, string> = { surface: "bg.surface", raised: "bg.surface-raised", "brand-subtle": "bg.brand-subtle" };

function surfaceOf(component: string, p: Props, ctx: BuildCtx): BuildCtx {
  if (component === "Card") {
    const tone = str(p.tone);
    const dark = tone === "inverse" || (tone === "brand-strong" && isDarkColor(T(ctx).paint("component.card.brand-fill")?.color));
    return { ...ctx, onDark: dark, surface: cardFill(tone) };
  }
  const fill = component === "Stack" ? STACK_FILL[str(p.background)] : component === "BottomSheet" ? "component.sheet.fill" : component === "Panel" ? "bg.surface" : undefined;
  return fill ? { ...ctx, onDark: false, surface: fill } : ctx;
}

export function buildInstance(inst: Inst, ctx: BuildCtx, path?: string): LBox {
  if (inst?.component === CUSTOM) return buildCustom(inst, ctx, path);
  const flags: Flag[] = [];
  const spec = CATALOG_BY_NAME.get(inst?.component);
  if (!spec) return notInSystem(inst?.component ?? "Unknown", `"${inst?.component}" is not a system component.`, path);
  const props = validate(inst, flags);
  let children: LBox[] = [];
  if (inst.children?.length) {
    if (!spec.container) flags.push({ rule: "unexpected-children", severity: "info", message: `${spec.name} does not take children; they were dropped.` });
    else {
      const inner = surfaceOf(spec.name, props, ctx);
      children = inst.children.map((c, i) => buildInstance(c, inner, path === undefined ? undefined : `${path}.children.${i}`));
    }
  }
  const given = new Set(Object.entries(inst.props ?? {}).flatMap(([k, v]) => (v === undefined || v === null || v === "" ? [] : [k])));
  const box = BUILDERS[spec.name](props, ctx, children, given);
  // Backdrops (custom-shaped surfaces) paint first, under the container's other parts.
  if (box.kind === "frame" && box.children?.some((c) => c.backdrop)) box.children = [...box.children.filter((c) => c.backdrop), ...box.children.filter((c) => !c.backdrop)];
  box.component = box.component ?? spec.name;
  if (path !== undefined) box.specPath = path;
  if (flags.length) box.flags = [...(box.flags ?? []), ...flags];
  return box;
}

// ---------------------------------------------------------------------------
// screens

export interface ScreenSpec {
  name: string;
  rationale?: string;
  /** Mobile when omitted (screens built before platforms existed). */
  platform?: Platform;
  /** Side margin in px when the brief asked for one; null/omitted = the system's gutter (phones) or the platform default. */
  margin?: number | null;
  dir?: "ltr" | "rtl";
  lang?: "en" | "ar";
  background?: "canvas" | "surface";
  header?: Inst[];
  /** Dashboard side navigation, or a desktop app's start panel. */
  sidebar?: Inst[];
  /**
   * Phones and web pages: what sits on the system's backdrop gradient (component.backdrop.fill)
   * at the top of the screen, behind the header too, fading into the background.
   */
  hero?: Inst[];
  /** How far the first body section rises over the hero's bottom edge. */
  overlap?: Overlap;
  body: Inst[];
  footer?: Inst[];
  /** Components Qalam AI made for this screen and its Custom instances place (until they're added to the system). */
  components?: ComponentDef[];
  /**
   * Not a screen but a part a screen opens or shows (a sheet, a dialog, a toast, a menu, a bar):
   * drawn on its own surface from its header, body and footer, with no system bars (surfaces.ts).
   */
  surface?: Surface;
}

/** Mobile frame size (see PLATFORMS for the others). */
export const SCREEN_W = PLATFORMS.mobile.w;
export const SCREEN_H = PLATFORMS.mobile.h;

export const platformOf = (spec: Pick<ScreenSpec, "platform">): Platform => (isPlatform(spec.platform) ? spec.platform : "mobile");

/** How far (px) the first body section rises over the hero backdrop's bottom edge. */
export const OVERLAP_PX = { none: 0, sm: 16, md: 32, lg: 48 } as const;
export type Overlap = keyof typeof OVERLAP_PX;

/** The screen's top sits on the backdrop gradient: it has a hero, on a phone or a web page (dashboards and desktop apps have no backdrop). */
export const hasBackdrop = (spec: Pick<ScreenSpec, "hero" | "platform"> | undefined): boolean => {
  const p = spec ? platformOf(spec) : "mobile";
  return !!spec?.hero?.length && (p === "mobile" || p === "web");
};

const overlapOf = (spec: ScreenSpec): number => (hasBackdrop(spec) ? (OVERLAP_PX[spec.overlap as Overlap] ?? 0) : 0);

const NATURAL_W: Record<string, number> = { SearchBar: 320, TextField: 280 };

/**
 * Header rows on web and dashboards size to their content, where fill-width controls would
 * collapse to nothing: give them (and those in the row's Stacks) a natural width instead.
 */
function fitRow(box: LBox): LBox {
  if (box.component === "Stack") return { ...box, children: box.children?.map(fitRow) };
  if (box.width !== "fill") return box;
  if (box.component === "SegmentedControl") return { ...box, width: Math.max(240, (box.children?.length ?? 2) * 110) };
  if (box.component?.startsWith("Button")) return { ...box, width: "hug" };
  return { ...box, width: NATURAL_W[box.component ?? ""] ?? 240 };
}

/**
 * A header bar the model wrapped in one horizontal Stack, as its items: the wrapper would hug its
 * content and stop short of the bar's end edge (and draw a second box inside the bar). Groups
 * inside it (start, middle, end) keep their own width: on wide screens the Stack made them equal
 * grid columns, which in a bar pushes the end group's content past the edge.
 */
function unwrapBar(items: LBox[]): LBox[] {
  if (!(items.length === 1 && items[0].component === "Stack" && items[0].direction === "row")) return items;
  return (items[0].children ?? []).map((c) => (c.kind === "frame" && c.component === "Stack" && c.grow === 1 && c.width === 0 ? { ...c, grow: undefined, width: undefined } : c));
}

/** Parts that carry no padding of their own, so in a phone header they're set inside the gutter. */
const HEADER_LEAVES = new Set(["Text", "Icon", "Avatar", "SearchBar", "Button", "IconButton", "Tag", "Rating", "Image"]);

const isAction = (b: LBox) => !!b.component && (b.component.startsWith("Button") || b.component.startsWith("IconButton"));
const group = (name: string, gap: number, items: LBox[]): LBox => (items.length === 1 ? items[0] : frame(name, { direction: "row", align: "center", gap }, items));

/**
 * Web navigation, however the model grouped it: the brand on the start edge, the links together,
 * the call to action on the end edge.
 */
function navItems(items: LBox[]): LBox[] {
  const flat = unwrapBar(items);
  if (flat.length <= 3) return flat;
  const [brand, ...rest] = flat;
  const cta = rest[rest.length - 1].component?.startsWith("Button") ? rest.pop()! : null;
  return [brand, frame("Links", { direction: "row", align: "center", gap: 32 }, rest), ...(cta ? [cta] : [])];
}

/**
 * A desktop app's bar, however the model grouped it, across the full width: the app or project
 * name on the start edge, the tools and status in the middle, the trailing actions (Export, play…)
 * on the end edge.
 */
function appBarItems(items: LBox[]): LBox[] {
  const flat = unwrapBar(items);
  if (flat.length <= 3) return flat;
  const [name, ...rest] = flat;
  let i = rest.length;
  while (i > 0 && isAction(rest[i - 1])) i--;
  const middle = rest.slice(0, i);
  const actions = rest.slice(i);
  if (!actions.length) return [name, group("Tools", 16, middle)];
  return [name, ...(middle.length ? [group("Tools", 16, middle)] : []), group("Actions", 8, actions)];
}

/** A dashboard's page header, however the model grouped it: the title on the start edge, everything else together on the end edge. */
function pageHeaderItems(items: LBox[]): LBox[] {
  const flat = unwrapBar(items);
  if (flat.length <= 2) return flat;
  const [title, ...rest] = flat;
  return [title, group("Actions", 12, rest)];
}

/** Build a screen with a system's tokens; `library` is the system's own components (its patterns). */
export function buildScreen(spec: ScreenSpec, ts: TokenSet = BUILTIN, library?: ComponentDef[]): LBox {
  const platform = platformOf(spec);
  const backdrop = hasBackdrop(spec);
  const ctx: BuildCtx = {
    dir: spec.dir ?? "ltr",
    lang: spec.lang ?? (spec.dir === "rtl" ? "ar" : "en"),
    ts,
    platform,
    gutter: marginFor(platform, spec.margin, ts.dimension("layout.gutter")),
    backdrop,
    components: componentLookup(library, spec.components),
    surface: spec.background === "surface" && !backdrop ? "bg.surface" : "bg.canvas",
  };
  const build = (region: "header" | "sidebar" | "hero" | "body" | "footer", c: BuildCtx = ctx) => (spec[region] ?? []).map((inst, i) => buildInstance(inst, c, `${region}.${i}`));
  if (spec.surface) return buildSurface(spec, ctx, build);
  const root = (children: LBox[], p: Partial<LBox> = {}) =>
    frame(spec.name || "Screen", { width: PLATFORMS[platform].w, minHeight: PLATFORMS[platform].h, align: "stretch", fill: spec.background === "surface" && !backdrop ? "bg.surface" : "bg.canvas", clip: true, ...p }, children);
  const m = gutterOf(ctx);
  /** A hairline along one edge of a region. */
  const edge = (at: "top" | "bottom" | "end") =>
    at === "end" ? rect("Border", { width: 1, fill: "border.subtle", absolute: { top: 0, bottom: 0, end: 0 } }) : rect("Border", { height: 1, fill: "border.subtle", absolute: { [at]: 0, start: 0, end: 0 } });
  // The hero and everything above it sit on the backdrop gradient; the body is drawn after it, so
  // its first section can rise over the backdrop's bottom edge.
  const overlap = overlapOf(spec);
  const onBackdrop = (children: LBox[]) => frame("Backdrop", { width: "fill", align: "stretch", fill: "component.backdrop.fill" }, children);
  const rise = overlap ? { margin: { top: -overlap } } : {};
  // A dark header band: what sits on it (status bar, header, hero) turns light.
  const darkTop = backdrop && isDarkColor(T(ctx).paint("component.backdrop.fill")?.color);
  const topCtx: BuildCtx = darkTop ? { ...ctx, onDark: true } : ctx;

  if (platform === "web") {
    const nav = navItems(build("header", backdrop ? topCtx : ctx)).map(fitRow);
    const footer = build("footer");
    const bar = nav.length ? [frame("Navigation", { direction: "row", align: "center", justify: "between", gap: 32, height: 72, width: "fill", padding: [0, m, 0, m], fill: backdrop ? undefined : "bg.canvas" }, [...nav, ...(backdrop ? [] : [edge("bottom")])])] : [];
    return root([
      ...(backdrop ? [onBackdrop([...bar, frame("Hero", { gap: 24, padding: [64, m, 64 + overlap, m], width: "fill", align: "stretch" }, build("hero", topCtx))])] : bar),
      frame("Content", { gap: 64, padding: [overlap ? 0 : 48, m, 80, m], grow: 1, width: "fill", align: "stretch", ...rise }, build("body")),
      ...(footer.length ? [frame("Footer", { gap: 24, width: "fill", align: "stretch", padding: [40, m, 40, m], fill: "bg.surface" }, footer)] : []),
    ]);
  }

  if (platform === "dashboard") {
    const top = pageHeaderItems(build("header").map(fitRow));
    const actions = build("footer").map(fitRow);
    const main = frame("Main", { grow: 1, width: 0, align: "stretch" }, [
      ...(top.length ? [frame("Page header", { direction: "row", align: "center", justify: "between", gap: 16, height: 72, width: "fill", padding: [0, m, 0, m] }, [...top, edge("bottom")])] : []),
      // Dashboards have no backdrop: a hero's content leads the body.
      frame("Content", { gap: 24, padding: [24, m, 32, m], grow: 1, width: "fill", align: "stretch" }, [...build("hero"), ...build("body")]),
      ...(actions.length ? [frame("Action bar", { direction: "row", align: "center", justify: "end", gap: 12, width: "fill", padding: [16, m, 16, m], fill: "bg.canvas" }, [...actions, edge("top")])] : []),
    ]);
    const sidebar = frame("Sidebar", { width: SIDEBAR_W, gap: 4, padding: [24, 16, 24, 16], align: "stretch", fill: "bg.surface" }, [...build("sidebar"), edge("end")]);
    return root([sidebar, main], { direction: "row" });
  }

  if (platform === "app") {
    // A tool's window: app bar, then the start panel beside the stage, then the bottom panel across the full width.
    const bar = appBarItems(build("header").map(fitRow));
    const side = build("sidebar");
    const bottom = build("footer");
    return root([
      ...(bar.length ? [frame("App bar", { direction: "row", align: "center", justify: "between", gap: 16, height: 56, width: "fill", padding: [0, 16, 0, 16], fill: "bg.surface" }, [...bar, edge("bottom")])] : []),
      frame("Workspace", { direction: "row", grow: 1, width: "fill", align: "stretch" }, [
        ...(side.length ? [frame("Start panel", { width: APP_PANEL_W, gap: 12, padding: [16, 16, 16, 16], align: "stretch", fill: "bg.surface", clip: true }, [...side, edge("end")])] : []),
        // Desktop apps have no backdrop: a hero's content leads the stage.
        frame("Stage", { grow: 1, width: 0, gap: 16, padding: [m, m, m, m], align: "stretch" }, [...build("hero"), ...build("body")]),
      ]),
      ...(bottom.length ? [frame("Bottom panel", { gap: 8, width: "fill", align: "stretch", padding: [12, 16, 16, 16], fill: "bg.surface" }, [...bottom, edge("top")])] : []),
    ]);
  }

  // A header row the model built from plain parts sits inside the gutter, like the hero and body;
  // bars (TopBar, Tabs…) bring their own padding.
  const insetRow = (b: LBox): LBox => {
    if (b.component === "Stack") {
      const [t, e, bt, s] = b.padding ?? [8, 0, 8, 0];
      return { ...b, width: "fill", padding: [t, Math.max(e, m), bt, Math.max(s, m)] };
    }
    return HEADER_LEAVES.has(b.component ?? "") ? frame("Header", { width: "fill", align: "stretch", padding: [8, m, 8, m] }, [b]) : b;
  };
  const header = build("header", topCtx).map(insetRow);
  // System bars take the colour of the surface they touch, so they read as part of it: the status
  // bar the backdrop or the header's own fill (a coloured top bar), the home indicator what's above it.
  const screenFill = spec.background === "surface" && !backdrop ? "bg.surface" : "bg.canvas";
  const paintOf = (fill: string) => JSON.stringify(T(ctx).paint(fill) ?? null);
  /** A fill the bar needs only when it would look different from the screen behind it. */
  const touching = (fill: string | undefined) => (fill && paintOf(fill) !== paintOf(screenFill) ? fill : undefined);
  const dark = (fill: string | undefined) => !!fill && isDarkColor(T(ctx).paint(fill)?.color);
  const topFill = backdrop ? undefined : touching(header[0]?.fill);
  const ink = darkTop || dark(topFill) ? "text.inverse" : "text.primary";
  const statusBar = frame("Status bar", { direction: "row", align: "center", justify: "between", height: 44, width: "fill", padding: [0, 28, 0, 28], fill: topFill }, [
    text("9:41", "body-strong", ink),
    frame("Indicators", { direction: "row", gap: 6, align: "center" }, [
      rect("Signal", { width: 18, height: 11, radius: "radius.xs", fill: ink }),
      rect("Battery", { width: 25, height: 12, radius: "radius.xs", fill: ink }),
    ]),
  ]);
  const sectionGap = dim(ctx, "layout.section-gap", 16);
  // Systems with a sheet radius draw the header as a solid band and the content as a sheet that rises over it.
  const sheet = backdrop ? dim(ctx, "component.backdrop.sheet-radius", 0) : 0;
  const lift = sheet ? Math.max(overlap, sheet) : overlap;
  const hero = backdrop ? build("hero", topCtx) : [];
  // A full-bleed band at the end of the hero runs under the sheet, so the band shows behind the sheet's corners.
  const bandLast = sheet > 0 && (hero[hero.length - 1]?.margin?.start ?? 0) < 0;
  if (bandLast) {
    // It grows by what the sheet covers, so its content keeps its padding.
    const band = hero[hero.length - 1];
    const [t, e, b, st] = band.padding ?? [0, 0, 0, 0];
    band.padding = [t, e, b + lift, st];
  }
  const top = backdrop
    ? [onBackdrop([statusBar, ...header, frame("Hero", { gap: sectionGap, padding: [8, m, bandLast ? 0 : 24 + lift, m], width: "fill", align: "stretch", spaceTokens: ["layout.section-gap", "layout.gutter"] }, hero)])]
    : [statusBar, ...header];
  const body = frame(
    "Content",
    {
      gap: sectionGap,
      padding: [sheet ? 16 : overlap ? 0 : 8, m, 24, m],
      grow: 1,
      width: "fill",
      align: "stretch",
      spaceTokens: ["layout.section-gap", "layout.gutter"],
      ...(sheet ? { margin: { top: -lift }, fill: spec.background === "surface" ? "bg.surface" : "bg.canvas", radius: { token: "component.backdrop.sheet-radius", corners: [true, true, false, false] as [boolean, boolean, boolean, boolean] } } : rise),
    },
    trimAutoDividers(build("body")),
  );
  const footerKids = build("footer");
  const fullWidthFooter = footerKids.every((k) => k.component === "BottomNav" || k.component === "BottomSheet");
  const footer = footerKids.length
    ? frame(
        "Footer",
        { gap: dim(ctx, "layout.footer-gap", 12), width: "fill", align: "stretch", padding: fullWidthFooter ? [0, 0, 0, 0] : [12, m, 8, m], fill: fullWidthFooter ? undefined : "bg.canvas" },
        footerKids,
      )
    : null;
  // A floating nav sits on the screen's own background, so the strip under it stays clear too.
  const hasNav = footerKids.some((k) => k.component === "BottomNav");
  const floatingNav = hasNav && style(ctx, "component.nav-bar.style.placement") === "floating";
  // A docked tab bar runs on under the home indicator, in its own colour.
  const dockedNav = hasNav && !floatingNav && fullWidthFooter;
  const darkNav = dockedNav && isDarkColor(T(ctx).paint("component.nav-bar.fill")?.color);
  const contentFill = sheet ? (spec.background === "surface" ? "bg.surface" : "bg.canvas") : undefined;
  const bottomFill = dockedNav
    ? "component.nav-bar.fill"
    : footer && fullWidthFooter && !floatingNav
      ? "bg.canvas"
      : touching(footer ? (floatingNav ? undefined : "bg.canvas") : contentFill);
  const home = frame("Home indicator", { height: 34, width: "fill", align: "center", justify: "center", fill: bottomFill }, [
    rect("Bar", { width: 134, height: 5, radius: "radius.pill", fill: darkNav ? "component.nav-bar.active" : !dockedNav && dark(bottomFill) ? "text.inverse" : "text.primary" }),
  ]);
  return root([...top, body, ...(footer ? [footer] : []), home]);
}
