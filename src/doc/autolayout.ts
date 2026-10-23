import { loadYoga, Align, Direction, Edge, FlexDirection, Gutter, Justify, MeasureMode, PositionType, Wrap, type Yoga, type Node as YNode } from "yoga-layout/load";
import { produce, type Draft } from "immer";
import type { AutoLayout, Doc, FrameNode, LogicalEdge, SceneNode, Sizing } from "./schema";
import { measureText } from "./measure";
import { anchorsOf, applyRecipe } from "./shape-recipe";

/*
 * Figma-style auto layout, computed with Yoga. The same mapping lays out freshly built screens
 * (engine/layout.ts) and relays out documents after every edit (store.mutate → relayoutDoc), so a
 * screen straight from the builders is a fixed point of the live layout.
 */

let yoga: Yoga | null = null;
let loading: Promise<Yoga> | null = null;

export function ensureYoga(): Promise<Yoga> {
  if (yoga) return Promise.resolve(yoga);
  loading ??= loadYoga().then((y) => (yoga = y));
  return loading;
}

let enabled = false;
let pending = false;

/**
 * Live relayout waits for Yoga and the real text measurer (CanvasKit): measuring with the
 * fallback would reflow text wrongly. Returns true when edits were skipped while it was off.
 */
export function setAutoLayoutEnabled(on: boolean): boolean {
  enabled = on;
  const missed = pending && on;
  if (on) pending = false;
  return missed;
}
export const autoLayoutLive = () => enabled && yoga !== null;

// ---------------------------------------------------------------------------
// Rules

export type AutoLayoutFrame = FrameNode & { layout: AutoLayout };
export type Axis = "h" | "v";

export const LOGICAL_EDGES: readonly LogicalEdge[] = ["top", "end", "bottom", "start"];

export const hasAutoLayout = (n: SceneNode | null | undefined): n is AutoLayoutFrame => !!n && n.type === "frame" && !!n.layout;
const parentOf = (doc: Doc, n: SceneNode) => (n.parentId ? doc.nodes[n.parentId] : undefined);

/** Placed by an auto-layout parent (not absolute). */
export const inFlow = (doc: Doc, n: SceneNode) => !n.absolute && hasAutoLayout(parentOf(doc, n));

/** The parent's main axis, when the node sits in auto layout. */
export function mainAxisOf(doc: Doc, n: SceneNode): Axis | null {
  const p = parentOf(doc, n);
  return hasAutoLayout(p) && !n.absolute ? (p.layout.direction === "horizontal" ? "h" : "v") : null;
}

/** Effective sizing: text defaults come from autoSize, fill needs an auto-layout parent, hug needs content. */
export function sizingOf(doc: Doc, n: SceneNode, axis: Axis): Sizing {
  let s = axis === "h" ? n.sizeH : n.sizeV;
  if (!s && n.type === "text") s = axis === "h" ? (n.text.autoSize === "width" ? "hug" : "fixed") : n.text.autoSize === "fixed" ? "fixed" : "hug";
  s ??= "fixed";
  if (s === "fill" && !inFlow(doc, n)) return "fixed";
  if (s === "hug" && n.type === "frame" && !n.layout) return "fixed";
  return s;
}

/** Sizing as the panel shows it: a main-axis flex weight reads as Fill. */
export function shownSizing(doc: Doc, n: SceneNode, axis: Axis): Sizing {
  const s = sizingOf(doc, n, axis);
  return s !== "fill" && n.grow && mainAxisOf(doc, n) === axis ? "fill" : s;
}

// ---------------------------------------------------------------------------
// Yoga mapping

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Build-time extras from the component builders: logical insets for absolute children, axes sized by those insets. */
export interface BuildHint {
  insets?: Partial<Record<LogicalEdge, number>>;
  auto?: Axis[];
}

const ALIGN = { start: Align.FlexStart, center: Align.Center, end: Align.FlexEnd } as const;
const JUSTIFY = { start: Justify.FlexStart, center: Justify.Center, end: Justify.FlexEnd, between: Justify.SpaceBetween } as const;
const EDGE: Record<LogicalEdge, Edge> = { top: Edge.Top, end: Edge.End, bottom: Edge.Bottom, start: Edge.Start };

/** Lay out auto-layout subtrees. Roots keep their x/y; boxes are parent-relative. */
export function computeLayout(doc: Doc, rootIds: string[], hints?: Map<string, BuildHint>): Map<string, LayoutBox> {
  if (!yoga) throw new Error("Yoga not loaded");
  const Y = yoga;
  const out = new Map<string, LayoutBox>();
  const config = Y.Config.create();
  config.setPointScaleFactor(1);

  for (const rootId of rootIds) {
    const root = doc.nodes[rootId];
    if (!hasAutoLayout(root)) continue;
    const pairs: [string, YNode][] = [];

    const build = (id: string, parent: AutoLayoutFrame | null): YNode => {
      const n = doc.nodes[id];
      const y = Y.Node.create(config);
      pairs.push([id, y]);
      const hint = hints?.get(id);
      const flow = !!parent && !n.absolute;
      const main: Axis | null = flow ? (parent!.layout.direction === "horizontal" ? "h" : "v") : null;

      // Pinned to its parent's edges: Yoga sizes it from the insets, on every pass.
      const pinned = !!parent && !!n.absolute && !!n.fillParent;
      for (const axis of ["h", "v"] as const) {
        if (hint?.auto?.includes(axis) || pinned) continue;
        const s = sizingOf(doc, n, axis);
        if (s === "fixed") {
          if (axis === "h") y.setWidth(n.w);
          else y.setHeight(n.h);
        } else if (s === "fill") {
          if (axis === main) {
            y.setFlexGrow(n.grow ?? 1);
            y.setFlexShrink(1);
            // Fill inside a hugging parent keeps its content size as the basis instead of collapsing.
            y.setFlexBasis(sizingOf(doc, parent!, axis) === "hug" ? "auto" : 0);
          } else y.setAlignSelf(Align.Stretch);
        }
        // hug: auto, sized by content (children or the text measure)
      }
      if (flow && n.grow !== undefined) {
        y.setFlexGrow(n.grow);
        y.setFlexShrink(1);
      }
      // A picture keeps its shape: the axis that hugs follows the other one.
      if (n.aspect && n.aspect > 0 && (sizingOf(doc, n, "h") === "hug" || sizingOf(doc, n, "v") === "hug")) y.setAspectRatio(n.aspect);
      if (n.minW !== undefined) y.setMinWidth(n.minW);
      if (n.maxW !== undefined) y.setMaxWidth(n.maxW);
      if (n.minH !== undefined) y.setMinHeight(n.minH);
      if (n.maxH !== undefined) y.setMaxHeight(n.maxH);
      if (parent && n.margin) for (const k of LOGICAL_EDGES) if (n.margin[k] !== undefined) y.setMargin(EDGE[k], n.margin[k]);
      if (parent && n.absolute) {
        y.setPositionType(PositionType.Absolute);
        if (hint?.insets) {
          for (const k of LOGICAL_EDGES) if (hint.insets[k] !== undefined) y.setPosition(EDGE[k], hint.insets[k]);
        } else if (pinned) {
          for (const k of LOGICAL_EDGES) y.setPosition(EDGE[k], 0);
        } else {
          y.setPosition(Edge.Left, n.x);
          y.setPosition(Edge.Top, n.y);
        }
      }

      if (n.type === "text") {
        // Text can give way on the main axis (wraps) unless its size there is fixed.
        if (main && sizingOf(doc, n, main) !== "fixed") y.setFlexShrink(1);
        const tp = n.text;
        y.setMeasureFunc((w, wm) => {
          const m = measureText(tp, wm === MeasureMode.Undefined ? null : w);
          return { width: wm === MeasureMode.Exactly ? w : Math.ceil(m.w), height: Math.ceil(m.h) };
        });
      } else if (hasAutoLayout(n)) {
        const L = n.layout;
        const row = L.direction === "horizontal";
        y.setFlexDirection(row ? FlexDirection.Row : FlexDirection.Column);
        y.setDirection(n.dir === "rtl" ? Direction.RTL : Direction.LTR);
        y.setGap(row ? Gutter.Column : Gutter.Row, L.gap);
        y.setGap(row ? Gutter.Row : Gutter.Column, L.crossGap);
        for (const k of LOGICAL_EDGES) y.setPadding(EDGE[k], L.padding[k]);
        y.setAlignItems(ALIGN[L.align]);
        y.setJustifyContent(JUSTIFY[L.justify]);
        if (L.wrap && row) y.setFlexWrap(Wrap.Wrap);
        let i = 0;
        for (const cid of n.children) {
          const c = doc.nodes[cid];
          if (c?.visible) y.insertChild(build(cid, n), i++);
        }
      }
      return y;
    };

    const yRoot = build(rootId, null);
    yRoot.calculateLayout(undefined, undefined, root.dir === "rtl" ? Direction.RTL : Direction.LTR);
    for (const [id, y] of pairs) {
      const l = y.getComputedLayout();
      const n = doc.nodes[id];
      const isRoot = id === rootId;
      out.set(id, { x: isRoot ? n.x : l.left, y: isRoot ? n.y : l.top, w: Math.max(1, l.width), h: Math.max(1, l.height) });
    }
    yRoot.freeRecursive();
  }
  config.free();
  return out;
}

/** Write boxes into a document, keeping node identity where nothing moved. */
function applyBoxes(doc: Doc, boxes: Map<string, LayoutBox>): Doc {
  const changed: [string, LayoutBox][] = [];
  for (const [id, b] of boxes) {
    const n = doc.nodes[id];
    if (n && (n.x !== b.x || n.y !== b.y || n.w !== b.w || n.h !== b.h)) changed.push([id, b]);
  }
  if (!changed.length) return doc;
  return produce(doc, (d) => {
    for (const [id, b] of changed) Object.assign(d.nodes[id], b);
    // A composed shape's outline is rebuilt for its new size, and for where the parts it lines up with went.
    for (const id of boxes.keys()) {
      const n = d.nodes[id];
      if (n?.type === "path" && n.recipe) applyRecipe(n, anchorsOf(n, (x) => d.nodes[x]));
    }
  });
}

/** Outermost auto-layout frames: each one is laid out with its nested auto-layout content. */
export function layoutRoots(doc: Doc): string[] {
  return Object.values(doc.nodes)
    .filter((n) => hasAutoLayout(n) && !hasAutoLayout(parentOf(doc, n)))
    .map((n) => n.id);
}

/** Top of the auto-layout chain a node takes part in, if any. */
function layoutRootOf(doc: Doc, id: string): string | null {
  let n = doc.nodes[id];
  if (!n) return null;
  let top = hasAutoLayout(n) ? n.id : null;
  while (n.parentId) {
    const p = doc.nodes[n.parentId];
    if (!hasAutoLayout(p)) break;
    top = p.id;
    n = p;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Relayout after edits

const LAYOUT_KEYS = ["w", "h", "visible", "children", "parentId", "sizeH", "sizeV", "absolute", "grow", "margin", "minW", "maxW", "minH", "maxH"] as const;

function affectsLayout(doc: Doc, a: SceneNode, b: SceneNode): boolean {
  for (const k of LAYOUT_KEYS) if (a[k] !== b[k]) return true;
  if (a.type === "frame" && b.type === "frame" && (a.layout !== b.layout || a.dir !== b.dir)) return true;
  if (a.type === "text" && b.type === "text" && a.text !== b.text) return true;
  // Moving an in-flow child by hand snaps it back; moving a whole screen doesn't touch its layout.
  return (a.x !== b.x || a.y !== b.y) && inFlow(doc, b);
}

/** Keep sizing valid: fill only in the flow, text sizing follows a changed autoSize. */
function normalizeSizing(d: Draft<Doc>, n: Draft<SceneNode>, before: SceneNode | undefined, prev: Doc) {
  // A flex weight belongs to the old parent's main axis: carry it over as Fill on that axis.
  if (before && before.parentId !== n.parentId && n.grow !== undefined) {
    const old = before.parentId ? prev.nodes[before.parentId] : undefined;
    if (n.grow > 0 && hasAutoLayout(old)) n[old.layout.direction === "horizontal" ? "sizeH" : "sizeV"] = "fill";
    delete n.grow;
  }
  if (!inFlow(d as Doc, n as SceneNode)) {
    if (n.sizeH === "fill") n.sizeH = "fixed";
    if (n.sizeV === "fill") n.sizeV = "fixed";
  }
  if (n.type !== "text" || before?.type !== "text" || before.text.autoSize === n.text.autoSize) return;
  if (before.sizeH !== n.sizeH || before.sizeV !== n.sizeV || (n.sizeH === undefined && n.sizeV === undefined)) return;
  const a = n.text.autoSize;
  if (a === "width") {
    n.sizeH = "hug";
    n.sizeV = "hug";
  } else {
    n.sizeH = n.sizeH === "fill" ? "fill" : "fixed";
    n.sizeV = a === "height" ? "hug" : n.sizeV === "fill" ? "fill" : "fixed";
  }
}

/** Relayout what an edit (prev → next) affected. Returns `next` itself when nothing moves. */
export function relayoutDoc(prev: Doc, next: Doc): Doc {
  if (prev === next || (prev.nodes === next.nodes && prev.roots === next.roots)) return next;
  if (!autoLayoutLive()) {
    pending = true;
    return next;
  }
  const roots = new Set<string>();
  const fixups: string[] = [];
  const mark = (id: string | null) => {
    const r = id ? layoutRootOf(next, id) : null;
    if (r) roots.add(r);
  };
  for (const id in next.nodes) {
    const a = prev.nodes[id];
    const b = next.nodes[id];
    if (a === b) continue;
    if (!a) {
      mark(id);
      fixups.push(id);
      continue;
    }
    if (!affectsLayout(next, a, b)) continue;
    mark(id);
    if (a.parentId !== b.parentId) mark(a.parentId);
    if (a.parentId !== b.parentId || a.absolute !== b.absolute || (a.type === "text" && b.type === "text" && a.text.autoSize !== b.text.autoSize)) fixups.push(id);
  }
  if (prev.nodes !== next.nodes) for (const id in prev.nodes) if (!(id in next.nodes)) mark(prev.nodes[id].parentId);

  let doc = next;
  if (fixups.length) doc = produce(doc, (d) => void fixups.forEach((id) => normalizeSizing(d, d.nodes[id], prev.nodes[id], prev)));
  return roots.size ? applyBoxes(doc, computeLayout(doc, [...roots])) : doc;
}

/** Relayout every auto-layout frame (fonts loaded, document opened). */
export function relayoutAll(doc: Doc): Doc {
  if (!autoLayoutLive()) return doc;
  return applyBoxes(doc, computeLayout(doc, layoutRoots(doc)));
}
