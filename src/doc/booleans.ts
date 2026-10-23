import type { Doc, Paint, PathNode, SceneNode, VectorPath } from "./schema";
import { studio } from "./store";
import { makeFrame, makePath } from "./factory";
import { reparentIn, topLevelOf } from "./ops";
import { type Mat, IDENTITY, descendants, invert, localMatrix, mul, worldMatrix } from "./geometry";
import { isGroup, paintOrder } from "./group-fit";
import { hasAutoLayout } from "./autolayout";
import { rebase, scaleVector, transformVector, translateVector, vectorBounds, vectorFromSegs, vectorOf, vectorScale, vectorToSegs, writeVector } from "./vector";
import { type Area, type BoolOp, type PathOps, pathOps } from "./path-ops";
import { boxSegs, fillArea, geometryProblem, strokeArea, transformSegs, unionAll } from "./shape-geometry";

/*
 * Destructive vector operations, Figma's shortcuts: booleans (⌥⇧U union, ⌥⇧S subtract, ⌥⇧I
 * intersect, ⌥⇧E exclude), flatten (⌘E) and outline stroke (⌥⌘O). Each one is a single undo
 * step whose result is an ordinary, editable vector (`writeVector`). The area maths is Skia's,
 * through path-ops.ts. Text has no outlines here yet (CanvasKit 0.42 doesn't expose glyph paths).
 */

const listOf = (d: Doc, parentId: string | null) => (parentId ? d.nodes[parentId].children : d.roots);

/** Where a result lands: the top-most operand's parent, at its slot among the layers that stay. */
interface Slot {
  parentId: string | null;
  index: number;
  /** In auto layout: the result stays out of the flow when the top-most operand was. */
  absolute: boolean;
}

function slotOf(doc: Doc, top: string, leaving: Set<string>): Slot {
  const n = doc.nodes[top];
  const list = listOf(doc, n.parentId);
  return { parentId: n.parentId, index: list.slice(0, list.indexOf(top)).filter((id) => !leaving.has(id)).length, absolute: !!n.absolute };
}

/** A layer's own px → its parent-to-be's space. */
const into = (doc: Doc, parentId: string | null, id: string): Mat => mul(parentId ? invert(worldMatrix(doc, parentId)) : IDENTITY, worldMatrix(doc, id));

/** The layer that gives a group its look: its top-most (or bottom-most) visible layer, at any depth. */
function paintLeaf(doc: Doc, id: string, top: boolean): SceneNode {
  let n = doc.nodes[id];
  while (isGroup(n) && n.children.length) {
    const kids = n.children.map((c) => doc.nodes[c]).filter((k) => k?.visible);
    if (!kids.length) break;
    n = top ? kids[kids.length - 1] : kids[0];
  }
  return n;
}

const paint = (p: Paint): Paint => structuredClone(p);

/** The paints a result inherits. Text and icons have one colour (their fill), no stroke. */
function paintsOf(n: SceneNode): Partial<PathNode> {
  return {
    fill: n.fill ? paint(n.fill) : null,
    stroke: n.stroke && n.type !== "text" && n.type !== "icon" ? { ...paint(n.stroke), width: n.stroke.width, ...(n.stroke.widthToken ? { widthToken: n.stroke.widthToken } : {}) } : null,
    opacity: n.opacity,
    join: n.type === "path" ? (n.join ?? "round") : "miter",
    ...(n.type === "path" && n.ends ? { ends: { ...n.ends } } : {}),
  };
}

/** A new vector from subpaths in its parent's space: box fitted to the curves, no rotation. */
function vectorNode(paths: VectorPath[], p: Partial<PathNode>): PathNode {
  const v = { paths };
  const b = vectorBounds(v);
  const n = makePath("", { name: "Vector", x: b.x, y: b.y, w: b.w, h: b.h, vw: b.w, vh: b.h, radius: null, ends: { start: "none", end: "none" }, ...p });
  writeVector(n, translateVector(v, -b.x, -b.y));
  return n;
}

/** Replace `remove` (whole subtrees) with `node` at `slot`, as one edit; selects it. */
function commit(remove: string[], node: PathNode, slot: Slot) {
  if (slot.absolute) node.absolute = true;
  studio().mutate((d) => {
    for (const id of remove) {
      const n = d.nodes[id];
      if (!n) continue;
      for (const c of descendants(d, id)) delete d.nodes[c];
      const list = listOf(d, n.parentId);
      list.splice(list.indexOf(id), 1);
      delete d.nodes[id];
    }
    node.parentId = slot.parentId;
    d.nodes[node.id] = node;
    const list = listOf(d, slot.parentId);
    list.splice(Math.min(slot.index, list.length), 0, node.id);
  });
  studio().select([node.id]);
}

/** Paths of an area (closed regions), with its fill rule. */
const regionPaths = (a: Area): { paths: VectorPath[]; evenOdd: boolean } => ({ paths: vectorFromSegs(a.segs).paths, evenOdd: !!a.evenOdd });

// ---------------------------------------------------------------------------
// Booleans

interface Operands {
  /** Bottom to top. */
  ids: string[];
  /** What the result replaces (the operands, or the group they were in). */
  remove: string[];
  slot: Slot;
}

/** The layers a boolean works on: 2+ selected layers, or the layers of one selected group. */
function booleanOperands(doc: Doc, ids: string[]): Operands | string {
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked);
  const one = tops.length === 1 ? doc.nodes[tops[0]] : null;
  const group = one && isGroup(one) && one.children.filter((c) => !doc.nodes[c].locked).length > 1 ? one : null;
  const list = group ? group.children.filter((c) => !doc.nodes[c].locked) : tops;
  if (list.length < 2) return tops.length || !ids.length ? "Select 2+ layers" : "The selection is locked";
  const problem = list.map((id) => geometryProblem(doc, id)).find(Boolean);
  if (problem) return problem;
  const order = paintOrder(doc);
  const sorted = [...list].sort((a, b) => order.get(a)! - order.get(b)!);
  const remove = group ? [group.id] : sorted;
  return { ids: sorted, remove, slot: slotOf(doc, group ? group.id : sorted[sorted.length - 1], new Set(remove)) };
}

/** True, or why a boolean can't run on the selection. */
export function canBoolean(ids: string[]): true | string {
  if (!pathOps()) return "The canvas isn't ready yet";
  const r = booleanOperands(studio().doc, ids);
  return typeof r === "string" ? r : true;
}

const BOOL_NAMES: Record<BoolOp, string> = { union: "Union", subtract: "Subtract", intersect: "Intersect", exclude: "Exclude" };

/** The operands' areas combined (Figma: subtract takes everything above from the bottom-most). */
export function booleanArea(ops: PathOps, areas: Area[], op: BoolOp): Area | null {
  if (op === "subtract") {
    const rest = unionAll(ops, areas.slice(1));
    return rest && ops.combine(areas[0], rest, "subtract");
  }
  let acc: Area | null = areas[0];
  for (const a of areas.slice(1)) {
    acc = acc && ops.combine(acc, a, op);
    if (!acc) return null;
  }
  return acc;
}

/**
 * ⌥⇧U / ⌥⇧S / ⌥⇧I / ⌥⇧E: replace the operands with one vector of the combined area. It takes the
 * top-most layer's paints (subtract: the bottom-most's), like Figma. Returns the new layer's id, or
 * why nothing happened.
 */
export function booleanSelection(ids: string[], op: BoolOp): { id: string } | { error: string } {
  const ops = pathOps();
  if (!ops) return { error: "The canvas isn't ready yet" };
  const doc = studio().doc;
  const pick = booleanOperands(doc, ids);
  if (typeof pick === "string") return { error: pick };
  const areas = pick.ids.map((id) => fillArea(doc, id, ops, into(doc, pick.slot.parentId, id)));
  const result = areas.every(Boolean) ? booleanArea(ops, areas as Area[], op) : null;
  if (!result) return { error: "These layers can't be combined" };
  if (!result.segs.length) return { error: op === "intersect" ? "The layers don't overlap: nothing is left" : "Nothing is left" };
  const source = paintLeaf(doc, op === "subtract" ? pick.ids[0] : pick.ids[pick.ids.length - 1], op !== "subtract");
  const { paths, evenOdd } = regionPaths(result);
  const node = vectorNode(paths, { ...paintsOf(source), name: BOOL_NAMES[op], ...(evenOdd ? { evenOdd } : {}) });
  commit(pick.remove, node, pick.slot);
  return { id: node.id };
}

// ---------------------------------------------------------------------------
// Flatten

/** True, or why ⌘E can't run on the selection. */
export function canFlatten(ids: string[]): true | string {
  if (!pathOps()) return "The canvas isn't ready yet";
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked);
  if (!tops.length) return ids.length ? "The selection is locked" : "Select a layer first";
  return tops.map((id) => geometryProblem(doc, id)).find(Boolean) ?? true;
}

/**
 * Collect what a layer flattens into, through `m`: open subpaths as they are (still stroked, never
 * filled) and closed regions as areas. False when its geometry can't be made.
 */
function flatParts(doc: Doc, id: string, ops: PathOps, m: Mat, open: VectorPath[], closed: Area[]): boolean {
  const n = doc.nodes[id];
  if (!n || !n.visible) return true;
  if (n.type === "path") {
    const { sx, sy } = vectorScale(n);
    const v = transformVector(scaleVector(vectorOf(n), sx, sy), m);
    const shut = v.paths.filter((p) => p.closed && p.filled !== false && p.points.length > 1);
    // Open subpaths, and closed ones the paint bucket emptied, keep their anchors and stay unfilled.
    open.push(...v.paths.filter((p) => !shut.includes(p) && p.points.length > 1).map((p) => (p.closed ? { ...p, filled: false } : p)));
    if (shut.length) closed.push({ segs: vectorToSegs({ paths: shut }), evenOdd: n.evenOdd });
    return true;
  }
  if (n.type === "frame" && !n.meta.mask) {
    if (!n.meta.group && (n.fill || n.stroke)) closed.push({ segs: transformSegs(boxSegs(n), m) });
    return n.children.every((c) => flatParts(doc, c, ops, mul(m, localMatrix(doc.nodes[c])), open, closed));
  }
  // Boxes, ellipses, icons and mask groups: the region they cover.
  const a = fillArea(doc, id, ops, m);
  if (a) closed.push(a);
  return !!a;
}

/**
 * ⌘E: the selected layers become one vector in the top-most one's place, transforms baked in (no
 * rotation or flip left). Closed regions are merged (union), open paths keep their anchors. It
 * takes the top-most layer's paints. Returns the new layer's id, or why nothing happened.
 */
export function flattenSelection(ids: string[]): { id: string } | { error: string } {
  const ops = pathOps();
  if (!ops) return { error: "The canvas isn't ready yet" };
  const ok = canFlatten(ids);
  if (ok !== true) return { error: ok };
  const doc = studio().doc;
  const order = paintOrder(doc);
  const sorted = topLevelOf(doc, ids)
    .filter((id) => !doc.nodes[id].locked)
    .sort((a, b) => order.get(a)! - order.get(b)!);
  const top = sorted[sorted.length - 1];
  const slot = slotOf(doc, top, new Set(sorted));
  const open: VectorPath[] = [];
  const closed: Area[] = [];
  if (!sorted.every((id) => flatParts(doc, id, ops, into(doc, slot.parentId, id), open, closed))) return { error: "These layers can't be flattened" };
  // Overlapping regions merge, so nothing cancels out under the non-zero rule (a lone one stays as drawn).
  const merged = unionAll(ops, closed);
  if (!merged) return { error: "These layers can't be flattened" };
  const region = regionPaths(merged);
  const paths = [...region.paths, ...open];
  if (!paths.length) return { error: "There's nothing to flatten" };
  const source = paintLeaf(doc, top, true);
  const name = sorted.length === 1 ? doc.nodes[top].name : "Vector";
  const node = vectorNode(paths, { ...paintsOf(source), name, ...(region.evenOdd ? { evenOdd: true } : {}) });
  commit(sorted, node, slot);
  return { id: node.id };
}

// ---------------------------------------------------------------------------
// Outline stroke

const outlinable = (n: SceneNode | undefined): boolean => !!n && !n.locked && (n.type === "icon" || (n.type !== "text" && !!n.stroke && n.stroke.width > 0));

/** True, or why ⌥⌘O can't run on the selection. */
export function canOutlineStroke(ids: string[]): true | string {
  if (!pathOps()) return "The canvas isn't ready yet";
  const doc = studio().doc;
  if (ids.some((id) => outlinable(doc.nodes[id]))) return true;
  return ids.length ? "Select a layer with a stroke" : "Select a layer first";
}

/**
 * ⌥⌘O: each selected stroke becomes a filled vector of the region it painted, in the stroke's
 * paint. A layer that is only a stroke (an unfilled vector, an icon) is replaced by it, keeping its
 * rotation; a filled one keeps its fill and is grouped with its outline on top (a frame gets the
 * outline as its top layer instead). One undo step. Returns the new layers' ids.
 */
export function outlineStrokeSelection(ids: string[]): { ids: string[] } | { error: string } {
  const ops = pathOps();
  if (!ops) return { error: "The canvas isn't ready yet" };
  const doc = studio().doc;
  const targets = ids.filter((id) => outlinable(doc.nodes[id]));
  if (!targets.length) return { error: canOutlineStroke(ids) as string };
  const plans: { id: string; node: PathNode }[] = [];
  for (const id of targets) {
    const n = doc.nodes[id];
    const area = strokeArea(n, ops);
    if (!area?.segs.length) continue;
    const inFrame = n.type === "frame";
    // A frame's outline lives in the frame's own space; anything else bakes its flips into the
    // geometry and keeps its rotation.
    const flip: Mat = [n.flipH && !inFrame ? -1 : 1, 0, 0, n.flipV && !inFrame ? -1 : 1, n.flipH && !inFrame ? n.w : 0, n.flipV && !inFrame ? n.h : 0];
    const { paths, evenOdd } = regionPaths({ ...area, segs: transformSegs(area.segs, flip) });
    const v = { paths };
    const b = vectorBounds(v);
    // The flips are in the geometry now: the new box only turns.
    const at = inFrame ? { x: b.x, y: b.y } : rebase({ x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation }, b.x, b.y, b.w, b.h);
    const ink = n.type === "icon" ? n.fill : n.stroke;
    const node = makePath("", {
      name: n.type === "icon" || inFrame || !n.fill ? n.name : "Stroke",
      x: at.x,
      y: at.y,
      w: b.w,
      h: b.h,
      vw: b.w,
      vh: b.h,
      rotation: inFrame ? 0 : n.rotation,
      fill: ink ? { color: ink.color, ...(ink.token ? { token: ink.token } : {}), ...(ink.gradient ? { gradient: structuredClone(ink.gradient) } : {}) } : null,
      stroke: null,
      radius: null,
      join: "miter",
      ends: { start: "none", end: "none" },
      ...(evenOdd ? { evenOdd } : {}),
    });
    writeVector(node, translateVector(v, -b.x, -b.y));
    plans.push({ id, node });
  }
  if (!plans.length) return { error: "Nothing to outline" };
  const made: string[] = [];
  studio().mutate((d) => {
    for (const { id, node } of plans) {
      const n = d.nodes[id];
      const list = listOf(d, n.parentId);
      const index = list.indexOf(id);
      if (n.type === "frame") {
        // Drawn over the frame's layers, like its stroke was.
        n.stroke = null;
        node.parentId = id;
        if (hasAutoLayout(n)) node.absolute = true;
        d.nodes[node.id] = node;
        n.children.push(node.id);
        made.push(node.id);
        continue;
      }
      node.parentId = n.parentId;
      node.opacity = n.opacity;
      if (n.absolute) node.absolute = true;
      d.nodes[node.id] = node;
      if (n.type === "icon" || !n.fill) {
        // Only a stroke: the outline takes its place.
        list.splice(index, 1, node.id);
        delete d.nodes[id];
        made.push(node.id);
        continue;
      }
      // Fill and stroke: the fill stays, the outline goes on top, both in a group named after it.
      n.stroke = null;
      list.splice(index + 1, 0, node.id);
      const parent = n.parentId ? d.nodes[n.parentId] : null;
      const group = makeFrame({
        name: n.name,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        fill: null,
        radius: null,
        clip: false,
        opacity: n.opacity,
        dir: parent?.type === "frame" ? parent.dir : "ltr",
        meta: { source: "user", group: true },
        ...(n.absolute ? { absolute: true } : {}),
      });
      group.parentId = n.parentId;
      n.opacity = 1;
      node.opacity = 1;
      d.nodes[group.id] = group;
      reparentIn(d, [id, node.id], group.id);
      listOf(d, group.parentId).splice(Math.min(index, listOf(d, group.parentId).length), 0, group.id);
      made.push(group.id);
    }
  });
  const now = studio().doc;
  studio().select(made.filter((id) => now.nodes[id]));
  return { ids: made };
}
