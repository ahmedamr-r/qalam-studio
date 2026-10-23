import type { AutoLayout, Doc, Flag, LogicalEdge, NodeMeta, Paint, Radius, SceneNode, Sizing, TextProps } from "@/doc/schema";
import { uniformRadius } from "@/doc/schema";
import { makeFrame, makeIcon, makeImage, makePath, makeShape, makeText } from "@/doc/factory";
import { BUILTIN, px, type TokenSet } from "@/design-system/resolve";
import type { BuildCtx, LBox } from "@/design-system/builders";
import { computeLayout, LOGICAL_EDGES, type Axis, type BuildHint } from "@/doc/autolayout";
import { hasArabic } from "./text";
import { anchorsOf, applyRecipe } from "@/doc/shape-recipe";

export { ensureYoga } from "@/doc/autolayout";

export function textPropsFor(box: LBox, ctx: BuildCtx): TextProps {
  const T = ctx.ts ?? BUILTIN;
  const t = box.text!;
  const style = T.typography(t.type) ?? T.typography("type.body")!;
  const arabic = ctx.lang === "ar" || hasArabic(t.content);
  return {
    content: t.content,
    fontFamily: arabic ? String(T.get("font.family.arabic")?.value ?? "IBM Plex Sans Arabic") : style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    // Arabic needs taller lines; tracking must stay 0 or joins break.
    lineHeight: arabic ? Math.max(style.lineHeight, Math.round(style.fontSize * 1.55)) : style.lineHeight,
    letterSpacing: arabic ? 0 : style.letterSpacing,
    align: t.align ?? "start",
    direction: ctx.dir,
    autoSize: "height",
    maxLines: t.maxLines,
    typeToken: t.type,
  };
}

/**
 * Convert an LBox tree to scene nodes (root first) that keep their layout as live auto layout,
 * then place them with the same engine that relays them out after edits.
 */
export function layoutToNodes(root: LBox, ctx: BuildCtx, at: { x: number; y: number }, source: NodeMeta["source"] = "ai"): SceneNode[] {
  const out: SceneNode[] = [];
  const hints = new Map<string, BuildHint>();
  const walk = (box: LBox, parent: LBox | null, parentNode: SceneNode | null) => {
    const sn = toScene(box, ctx, { x: 0, y: 0, w: typeof box.width === "number" ? box.width : 1, h: typeof box.height === "number" ? box.height : 1 }, source);
    const hint = persistLayout(sn, box, parent, ctx);
    if (hint) hints.set(sn.id, hint);
    sn.parentId = parentNode?.id ?? null;
    parentNode?.children.push(sn.id);
    out.push(sn);
    for (const c of box.children ?? []) walk(c, box, sn);
  };
  walk(root, null, null);
  out[0].x = at.x;
  out[0].y = at.y;
  const doc: Doc = { nodes: Object.fromEntries(out.map((n) => [n.id, n])), roots: [out[0].id] };
  for (const [id, b] of computeLayout(doc, [out[0].id], hints)) Object.assign(doc.nodes[id], b);
  // Composed shapes are drawn for the size layout gave them.
  for (const n of out) if (n.type === "path" && n.recipe) applyRecipe(n, anchorsOf(n, (id) => doc.nodes[id]));
  return out;
}

const defaultAlign = (box: LBox) => box.align ?? ((box.direction ?? "column") === "row" ? "start" : "stretch");

/** Space token whose value is exactly `v` (bound like a Figma variable), if any. */
function spaceToken(T: TokenSet, v: number): string | undefined {
  if (!v) return undefined;
  return T.ofType("dimension", "space.").find((t) => px(t.value) === v)?.path;
}

/**
 * Store the builder's flexbox intent as auto layout on the node (mutates). Returns the build-only
 * hint for absolute children, which Yoga places from their logical insets on the first pass.
 */
function persistLayout(n: SceneNode, box: LBox, parent: LBox | null, ctx: BuildCtx): BuildHint | undefined {
  const T = ctx.ts ?? BUILTIN;
  let hint: BuildHint | undefined;
  if (n.type === "frame") {
    const [top, end, bottom, start] = box.padding ?? [0, 0, 0, 0];
    const padding: Record<LogicalEdge, number> = { top, end, bottom, start };
    const align = defaultAlign(box);
    const layout: AutoLayout = {
      direction: (box.direction ?? "column") === "row" ? "horizontal" : "vertical",
      wrap: !!box.wrap,
      gap: box.gap ?? 0,
      crossGap: box.gap ?? 0,
      padding,
      justify: box.justify ?? "start",
      align: align === "stretch" ? "start" : align,
    };
    const gapToken = spaceToken(T, layout.gap);
    if (gapToken) layout.gapToken = layout.crossGapToken = gapToken;
    for (const k of LOGICAL_EDGES) {
      const t = spaceToken(T, padding[k]);
      if (t) (layout.paddingTokens ??= {})[k] = t;
    }
    n.layout = layout;
  }
  if (box.minHeight) n.minH = box.minHeight;
  if (box.aspect) n.aspect = box.aspect;
  if (!parent) {
    n.sizeH = typeof box.width === "number" ? "fixed" : "hug";
    n.sizeV = typeof box.height === "number" ? "fixed" : "hug";
    return undefined;
  }
  if (box.grow !== undefined) n.grow = box.grow;
  if (box.margin) n.margin = { ...box.margin };
  const row = (parent.direction ?? "column") === "row";
  const stretch = defaultAlign(parent) === "stretch";
  const sizing = (axis: Axis): Sizing => {
    const v = axis === "h" ? box.width : box.height;
    const main = row === (axis === "h");
    if (box.absolute) {
      if (typeof v === "number") return "fixed";
      // Frames and text hug their content, unless they're pinned to both edges on this axis.
      const pinned = axis === "h" ? box.absolute.start !== undefined && box.absolute.end !== undefined : box.absolute.top !== undefined && box.absolute.bottom !== undefined;
      if ((box.kind === "frame" || box.kind === "text") && !pinned) return "hug";
      // Sized by its insets on the first pass, then kept as a fixed size.
      ((hint ??= {}).auto ??= []).push(axis);
      return "fixed";
    }
    if (typeof v === "number") return v === 0 && box.grow !== undefined && main ? "fill" : "fixed";
    if (v === "fill" || v === "hug") return v;
    return !main && stretch ? "fill" : "hug";
  };
  n.sizeH = sizing("h");
  n.sizeV = sizing("v");
  if (box.absolute) {
    n.absolute = true;
    (hint ??= {}).insets = { ...box.absolute };
    if (box.fillParent) n.fillParent = true;
  }
  return hint;
}

function paint(T: TokenSet, path: string | undefined, flags: Flag[]): Paint | null {
  if (!path) return null;
  const p = T.paint(path);
  if (!p) {
    flags.push({ rule: "unknown-token", severity: "error", message: `Token "${path}" does not exist.` });
    return { color: "#FF00FF" };
  }
  return p.gradient ? { color: p.color, token: path, gradient: p.gradient } : { color: p.color, token: path };
}

function radiusFor(T: TokenSet, r: LBox["radius"], dir: "ltr" | "rtl", flags: Flag[]): Radius | null {
  if (r === undefined) return null;
  const unknown = (path: string) => {
    flags.push({ rule: "unknown-token", severity: "error", message: `Token "${path}" does not exist.` });
    return uniformRadius(0);
  };
  if (typeof r === "string") {
    const v = T.dimension(r);
    return v === undefined ? unknown(r) : uniformRadius(v, r);
  }
  let logical: [number, number, number, number];
  let token: string | undefined;
  if (Array.isArray(r)) {
    logical = r;
    const xl = T.dimension("radius.xl");
    if (xl !== undefined && r.every((v) => v === 0 || v === xl)) token = "radius.xl";
  } else {
    const v = T.dimension(r.token);
    if (v === undefined) return unknown(r.token);
    logical = r.corners.map((on) => (on ? v : 0)) as [number, number, number, number];
    token = r.token;
  }
  const [ts, te, be, bs] = logical;
  const rad = uniformRadius(0, token);
  const [tl, tr, br, bl] = dir === "rtl" ? [te, ts, bs, be] : [ts, te, be, bs];
  rad.linked = false;
  rad.tl = { rx: tl, ry: tl };
  rad.tr = { rx: tr, ry: tr };
  rad.br = { rx: br, ry: br };
  rad.bl = { rx: bl, ry: bl };
  return rad;
}

function toScene(box: LBox, ctx: BuildCtx, g: { x: number; y: number; w: number; h: number }, source: NodeMeta["source"]): SceneNode {
  const T = ctx.ts ?? BUILTIN;
  const flags: Flag[] = [...(box.flags ?? [])];
  const meta: NodeMeta = { source, component: box.component, interactive: box.interactive, hitArea: box.hitArea, spaceTokens: box.spaceTokens?.filter((t) => !t.endsWith(".undefined")) };
  if (box.specPath !== undefined) meta.specPath = box.specPath;
  const color = (path: string | undefined, f: Flag[]) => paint(T, path, f);
  let n: SceneNode;
  switch (box.kind) {
    case "text":
      n = makeText({ ...g, name: box.name, fill: color(box.text!.color, flags), meta, text: textPropsFor(box, ctx) });
      break;
    case "icon":
      n = makeIcon(box.icon!.name, { ...g, name: box.name, fill: color(box.icon!.color, flags), mirrored: !!box.icon!.mirrored, strokeWidth: box.icon!.strokeWidth ?? 2, meta });
      break;
    case "image":
      n = makeImage(box.image!.src, { ...g, name: box.name, fit: box.image!.fit, fill: color(box.fill, flags), radius: radiusFor(T, box.radius, ctx.dir, flags) ?? uniformRadius(0), meta });
      break;
    case "path":
      // No fill is a stroke-only path.
      n = makePath(box.path!.d, { ...g, name: box.name, vw: box.path!.vw, vh: box.path!.vh, evenOdd: box.path!.evenOdd, fill: color(box.fill, flags), meta });
      if (box.recipe && n.type === "path") n.recipe = structuredClone(box.recipe);
      break;
    case "rect":
    case "ellipse":
      n = makeShape(box.kind, { ...g, name: box.name, fill: color(box.fill, flags), radius: box.kind === "rect" ? radiusFor(T, box.radius, ctx.dir, flags) ?? uniformRadius(0) : null, meta });
      break;
    default:
      n = makeFrame({
        ...g,
        name: box.name,
        fill: color(box.fill, flags),
        radius: radiusFor(T, box.radius, ctx.dir, flags) ?? uniformRadius(0),
        clip: box.clip ?? false,
        dir: ctx.dir,
        meta,
      });
  }
  if (box.stroke) {
    const w = box.stroke.width;
    const width = typeof w === "number" ? w : T.dimension(w);
    if (width === undefined) flags.push({ rule: "unknown-token", severity: "error", message: `Token "${w}" does not exist.` });
    else if (width > 0) {
      const c = color(box.stroke.token, flags);
      if (c) n.stroke = { ...c, width, ...(typeof w === "string" ? { widthToken: w } : {}), ...(box.stroke.dash?.length ? { dash: [...box.stroke.dash] } : {}) };
    }
  }
  if (box.shadow) {
    const layers = T.shadowLayers(box.shadow);
    if (!layers) flags.push({ rule: "unknown-token", severity: "error", message: `Token "${box.shadow}" does not exist.` });
    else {
      n.shadowToken = box.shadow;
      if (layers.length) n.effects = layers;
    }
  }
  if (flags.length) n.meta.flags = flags;
  return n;
}
