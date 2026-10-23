import type { AutoLayout, Effect, FrameNode, Gradient, LogicalEdge, PathNode, Radius, SceneNode, Sizing } from "@/doc/schema";
import type { TypeStyle } from "@/design-system/resolve";
import { num } from "./names";
import { fontFamilyCSS, type TokenTable } from "./tokens";

/*
 * A layer's CSS, as React style properties (pure). Auto layout maps to flexbox with the layout
 * engine's own rules (doc/autolayout.ts): fixed / hug / fill sizing, Yoga's flex defaults (the
 * stylesheet in tokens.ts makes items keep their size), logical padding and margins. Paints follow
 * the renderer: strokes sit inside the box and over its children (an inset outline), drop shadows
 * need a fill, icons and text take their fill as colour.
 */

export type StyleValue = string | number;
export type Style = Record<string, StyleValue>;

export interface Placement {
  /** The parent layer; null for the screen itself. */
  parent: SceneNode | null;
  /** Writing direction the layer inherits. */
  dir: "ltr" | "rtl";
}

export interface NodeCSS {
  style: Style;
  /** A type token's class (text). */
  className?: string;
}

export interface CSSOptions {
  /** Radii and shadows as values, not variables: Motion corrects those while a layout animation scales the layer. */
  literal?: boolean;
}

type Axis = "h" | "v";
type LayoutFrame = FrameNode & { layout: AutoLayout };

const hasLayout = (n: SceneNode | null | undefined): n is LayoutFrame => !!n && n.type === "frame" && !!n.layout;

/** Placed by its parent's auto layout. */
export const inFlow = (n: SceneNode, parent: SceneNode | null) => !!parent && !n.absolute && hasLayout(parent);

/** How a layer sizes on an axis: the layout engine's sizingOf, with the parent given. */
export function sizing(n: SceneNode, parent: SceneNode | null, axis: Axis): Sizing {
  let s = axis === "h" ? n.sizeH : n.sizeV;
  if (!s && n.type === "text") s = axis === "h" ? (n.text.autoSize === "width" ? "hug" : "fixed") : n.text.autoSize === "fixed" ? "fixed" : "hug";
  s ??= "fixed";
  if (s === "fill" && !inFlow(n, parent)) return "fixed";
  if (s === "hug" && n.type === "frame" && !n.layout) return "fixed";
  return s;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end" } as const;
const MARGIN: Record<LogicalEdge, string> = { top: "marginTop", bottom: "marginBottom", start: "marginInlineStart", end: "marginInlineEnd" };

export function gradientCSS(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${num(s.position * 100)}%`).join(", ");
  // The renderer's radial gradient reaches the corners from the centre.
  return g.kind === "radial" ? `radial-gradient(circle farthest-corner, ${stops})` : `linear-gradient(${num(g.angle)}deg, ${stops})`;
}

const effectCSS = (e: Effect) => `${e.kind === "inner" ? "inset " : ""}${num(e.x)}px ${num(e.y)}px ${num(e.blur)}px ${num(e.spread)}px ${e.color}`;

function radiusCSS(r: Radius, t: TokenTable, literal: boolean): StyleValue | undefined {
  const c = [r.tl, r.tr, r.br, r.bl];
  if (c.every((k) => !k.rx && !k.ry)) return undefined;
  const len = (v: number) => (v === 0 ? "0" : literal ? `${num(v)}px` : t.value(r.token, `${num(v)}px`));
  if (c.every((k) => k.rx === k.ry)) {
    if (c.every((k) => k.rx === c[0].rx)) return literal || !r.token ? c[0].rx : len(c[0].rx);
    return c.map((k) => len(k.rx)).join(" ");
  }
  return `${c.map((k) => `${num(k.rx)}px`).join(" ")} / ${c.map((k) => `${num(k.ry)}px`).join(" ")}`;
}

/** Where a layer sits: the screen's root fills the viewport, flow items size like auto layout, the rest are absolute. */
function placement(n: SceneNode, at: Placement, set: (k: string, v: StyleValue | undefined) => void) {
  const p = at.parent;
  if (!p) {
    set("width", "100%");
    if (hasLayout(n)) set("minHeight", "100%");
    else set("height", r2(n.h));
    return;
  }
  if (inFlow(n, p)) {
    const main: Axis = (p as LayoutFrame).layout.direction === "horizontal" ? "h" : "v";
    const cross: Axis = main === "h" ? "v" : "h";
    const size = (a: Axis) => r2(a === "h" ? n.w : n.h);
    const dim = (a: Axis) => (a === "h" ? "width" : "height");
    const mainS = sizing(n, p, main);
    const crossS = sizing(n, p, cross);
    if (mainS === "fixed") set(dim(main), size(main));
    if (crossS === "fixed") set(dim(cross), size(cross));
    else if (crossS === "fill") set("alignSelf", "stretch");
    let grow: number | undefined;
    let shrink = false;
    let basis0 = false;
    if (mainS === "fill") {
      grow = n.grow ?? 1;
      shrink = true;
      // Fill inside a hugging parent keeps its content size as the basis (the engine does the same).
      basis0 = sizing(p, null, main) !== "hug";
    }
    if (n.grow !== undefined) {
      grow = n.grow;
      shrink = true;
    }
    // Text can give way on the main axis (it wraps) unless its size there is fixed.
    if (n.type === "text" && mainS !== "fixed") shrink = true;
    if (grow !== undefined) set("flexGrow", Math.round(grow * 10000) / 10000);
    if (shrink) set("flexShrink", 1);
    if (basis0) set("flexBasis", 0);
    if (n.minW !== undefined) set("minWidth", r2(n.minW));
    if (n.maxW !== undefined) set("maxWidth", r2(n.maxW));
    if (n.minH !== undefined) set("minHeight", r2(n.minH));
    if (n.maxH !== undefined) set("maxHeight", r2(n.maxH));
    for (const k of ["top", "end", "bottom", "start"] as const) if (n.margin?.[k]) set(MARGIN[k], r2(n.margin[k]!));
    return;
  }
  // Absolute: where it was laid out. A layer that hugs its content keeps to the nearer side, so
  // a slightly wider rendering of its text grows away from that edge.
  set("position", "absolute");
  const hugW = sizing(n, p, "h") === "hug";
  const hugH = sizing(n, p, "v") === "hug";
  const right = p.w - (n.x + n.w);
  if (hugW && right < n.x) set("right", r2(right));
  else set("left", r2(n.x));
  set("top", r2(n.y));
  if (!hugW) set("width", r2(n.w));
  if (!hugH) set("height", r2(n.h));
}

function autoLayout(n: LayoutFrame, t: TokenTable, set: (k: string, v: StyleValue | undefined) => void) {
  const L = n.layout;
  const row = L.direction === "horizontal";
  set("display", "flex");
  set("flexDirection", row ? "row" : "column");
  const wrap = L.wrap && row;
  if (wrap) {
    set("flexWrap", "wrap");
    set("alignContent", "flex-start");
  }
  const gap = L.gap ? t.px(L.gapToken, L.gap) : 0;
  if (wrap) {
    const cross = L.crossGap ? t.px(L.crossGapToken, L.crossGap) : 0;
    if (gap === cross) set("gap", gap || undefined);
    else {
      set("columnGap", gap || undefined);
      set("rowGap", cross || undefined);
    }
  } else set("gap", gap || undefined);
  const pad = (k: LogicalEdge) => (L.padding[k] ? t.px(L.paddingTokens?.[k], L.padding[k]) : 0);
  const [top, end, bottom, start] = (["top", "end", "bottom", "start"] as const).map(pad);
  if (top === end && end === bottom && bottom === start) set("padding", top || undefined);
  else {
    if (top === bottom) set("paddingBlock", top || undefined);
    else {
      set("paddingTop", top || undefined);
      set("paddingBottom", bottom || undefined);
    }
    if (start === end) set("paddingInline", start || undefined);
    else {
      set("paddingInlineStart", start || undefined);
      set("paddingInlineEnd", end || undefined);
    }
  }
  if (L.justify !== "start") set("justifyContent", JUSTIFY[L.justify]);
  set("alignItems", ALIGN[L.align]);
}

/** A layer's style and class. Icons, images and vectors get their sizes as element props from the emitter. */
export function nodeCSS(n: SceneNode, at: Placement, t: TokenTable, o: CSSOptions = {}): NodeCSS {
  const style: Style = {};
  const set = (k: string, v: StyleValue | undefined) => {
    if (v !== undefined) style[k] = v;
  };
  const out: NodeCSS = { style };
  placement(n, at, set);

  if (n.type === "frame") {
    if (hasLayout(n)) autoLayout(n, t, set);
    if (n.clip) set("overflow", "hidden");
    if (n.dir !== at.dir) set("direction", n.dir);
  }

  const box = n.type === "frame" || n.type === "rect" || n.type === "ellipse" || n.type === "image";
  if (box) {
    if (n.fill?.gradient) set("backgroundImage", t.value(n.fill.token, gradientCSS(n.fill.gradient)));
    else if (n.fill) set("backgroundColor", t.value(n.fill.token, n.fill.color));
    if (n.type === "ellipse") set("borderRadius", "50%");
    else if (n.radius) set("borderRadius", radiusCSS(n.radius, t, !!o.literal));
    if (n.stroke && n.stroke.width > 0) {
      set("outline", `${num(n.stroke.width)}px solid ${t.value(n.stroke.token, n.stroke.color)}`);
      set("outlineOffset", -n.stroke.width);
    }
    const fx = (n.effects ?? []).filter((e) => e.kind === "inner" || !!n.fill);
    if (fx.length) {
      const literal = fx.map(effectCSS).join(", ");
      set("boxShadow", !o.literal && n.shadowToken && fx.length === n.effects!.length ? t.value(n.shadowToken, literal) : literal);
    }
  }
  if (n.type === "image") {
    set("display", "block");
    set("objectFit", n.fit ?? "cover");
  }

  if (n.type === "text") {
    const tp = n.text;
    if (n.fill) set("color", t.value(n.fill.token, n.fill.color));
    const actual: TypeStyle = { fontFamily: tp.fontFamily, fontSize: tp.fontSize, fontWeight: tp.fontWeight, lineHeight: tp.lineHeight, letterSpacing: tp.letterSpacing };
    let own: Partial<TypeStyle> = actual;
    if (tp.typeToken) {
      const c = t.type(tp.typeToken, actual);
      out.className = c.className;
      own = c.overrides;
    }
    if (own.fontFamily !== undefined) set("fontFamily", fontFamilyCSS(own.fontFamily));
    if (own.fontSize !== undefined) set("fontSize", r2(own.fontSize));
    if (own.fontWeight !== undefined) set("fontWeight", own.fontWeight);
    // React reads a bare number as a multiplier; the design's line heights are px.
    if (own.lineHeight !== undefined) set("lineHeight", `${num(own.lineHeight)}px`);
    if (own.letterSpacing !== undefined && (tp.typeToken || own.letterSpacing !== 0)) set("letterSpacing", r2(own.letterSpacing));
    if (tp.align !== "start") set("textAlign", tp.align);
    if (tp.direction === "auto") set("unicodeBidi", "plaintext");
    else if (tp.direction !== at.dir) set("direction", tp.direction);
    if (tp.decoration) set("textDecoration", tp.decoration === "strikethrough" ? "line-through" : "underline");
    if (tp.italic) set("fontStyle", "italic");
    const lines = tp.content.includes("\n");
    if (tp.maxLines === 1) {
      set("whiteSpace", "nowrap");
      set("overflow", "hidden");
      set("textOverflow", "ellipsis");
    } else if (tp.maxLines && tp.maxLines > 1) {
      set("display", "-webkit-box");
      set("WebkitBoxOrient", "vertical");
      set("WebkitLineClamp", tp.maxLines);
      set("overflow", "hidden");
      if (lines) set("whiteSpace", "pre-wrap");
    } else if (tp.autoSize === "width") set("whiteSpace", lines ? "pre" : "nowrap");
    else if (lines) set("whiteSpace", "pre-wrap");
  }

  if (n.type === "icon") {
    if (n.fill) set("color", t.value(n.fill.token, n.fill.color));
    // The renderer draws nothing for an icon without a fill; it still takes its place.
    else set("visibility", "hidden");
  }

  if (n.opacity < 1) set("opacity", Math.round(n.opacity * 1000) / 1000);
  // Individual transform properties, so they compose with Motion's transform instead of fighting it.
  if (n.rotation) set("rotate", `${num(n.rotation)}deg`);
  const sx = (n.flipH ? -1 : 1) * (n.type === "icon" && n.mirrored ? -1 : 1);
  const sy = n.flipV ? -1 : 1;
  if (sx !== 1 || sy !== 1) set("scale", `${sx} ${sy}`);
  return out;
}

/** A vector's paint, as props for its <path>. */
export function pathPaint(n: PathNode, t: TokenTable): Style {
  const s: Style = {};
  if (n.fill) s.fill = n.fill.gradient ? n.fill.color : t.value(n.fill.token, n.fill.color);
  else s.fill = "none";
  if (n.stroke && n.stroke.width > 0) {
    s.stroke = t.value(n.stroke.token, n.stroke.color);
    s.strokeWidth = n.stroke.width;
    s.strokeLinecap = "round";
    s.strokeLinejoin = n.join ?? "round";
  }
  return s;
}
