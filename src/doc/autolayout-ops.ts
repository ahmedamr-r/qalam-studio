import type { AutoLayout, Doc, FrameNode, SceneNode, Sizing } from "./schema";
import { studio } from "./store";
import { hasAutoLayout, inFlow, mainAxisOf, sizingOf, type Axis } from "./autolayout";
import { apply, invert, isDescendant, mul, place, placementOf, translate, worldBounds, worldMatrix, type Box, type Pt } from "./geometry";
import { frameSelection, topLevelOf } from "./ops";
import { makeFrame } from "./factory";

const sizeKey = (axis: Axis) => (axis === "h" ? "sizeH" : "sizeV") as "sizeH" | "sizeV";
const parentOf = (d: Doc, n: SceneNode) => (n.parentId ? d.nodes[n.parentId] : undefined);
const round = (v: number) => Math.max(0, Math.round(v));
const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

// ---------------------------------------------------------------------------
// Inference (Shift+A): read direction, spacing, padding and alignment off the current arrangement.

interface Inferred {
  layout: AutoLayout;
  /** Children in flow order. */
  order: string[];
}

/** `boxes` are in the container's space; `size` is the container's size when it already exists. */
function infer(boxes: { id: string; b: Box }[], size: { w: number; h: number } | null, rtl: boolean): Inferred {
  const cx = boxes.map(({ b }) => b.x + b.w / 2);
  const cy = boxes.map(({ b }) => b.y + b.h / 2);
  const spread = (vs: number[]) => (vs.length ? Math.max(...vs) - Math.min(...vs) : 0);
  const horizontal = boxes.length > 1 && spread(cx) > spread(cy);
  const sorted = [...boxes].sort((p, q) => (horizontal ? (rtl ? q.b.x + q.b.w - (p.b.x + p.b.w) : p.b.x - q.b.x) : p.b.y - q.b.y));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].b;
    const b = sorted[i].b;
    gaps.push(horizontal ? (rtl ? a.x - (b.x + b.w) : b.x - (a.x + a.w)) : b.y - (a.y + a.h));
  }
  const gap = gaps.length ? round(median(gaps)) : 8;

  let padding = { top: 0, end: 0, bottom: 0, start: 0 };
  if (size && boxes.length) {
    const left = Math.min(...boxes.map(({ b }) => b.x));
    const right = size.w - Math.max(...boxes.map(({ b }) => b.x + b.w));
    padding = {
      top: round(Math.min(...boxes.map(({ b }) => b.y))),
      bottom: round(size.h - Math.max(...boxes.map(({ b }) => b.y + b.h))),
      start: round(rtl ? right : left),
      end: round(rtl ? left : right),
    };
  }

  // Cross-axis alignment: whichever edge (or centre) the items share.
  let align: AutoLayout["align"] = "start";
  if (boxes.length > 1) {
    const near = (vs: number[]) => spread(vs) <= 1;
    const lo = boxes.map(({ b }) => (horizontal ? b.y : b.x));
    const mid = horizontal ? cy : cx;
    const hi = boxes.map(({ b }) => (horizontal ? b.y + b.h : b.x + b.w));
    if (!near(lo) && near(mid)) align = "center";
    else if (!near(lo) && near(hi)) align = horizontal || !rtl ? "end" : "start";
    else if (near(lo) && !near(hi) && !horizontal && rtl) align = "end";
  }
  return { layout: { direction: horizontal ? "horizontal" : "vertical", wrap: false, gap, crossGap: gap, padding, justify: "start", align }, order: sorted.map((s) => s.id) };
}

/** Child boxes in a frame's local space (unrotated frames; rotated ones use their bounds). */
function localBoxes(d: Doc, frameId: string, ids: string[]): { id: string; b: Box }[] {
  const inv = invert(worldMatrix(d, frameId));
  return ids.map((id) => {
    const wb = worldBounds(d, id);
    const p = apply(inv, { x: wb.x, y: wb.y });
    return { id, b: { x: p.x, y: p.y, w: wb.w, h: wb.h } };
  });
}

/**
 * Shift+A. A frame without auto layout gets it (inferred from its children); anything else
 * (several layers, a shape, an auto-layout frame) is wrapped in a new hugging auto-layout frame.
 */
export function addAutoLayout(ids: string[]) {
  const d0 = studio().doc;
  const tops = topLevelOf(d0, ids).filter((id) => !d0.nodes[id].locked);
  if (!tops.length) return;
  const one = tops.length === 1 ? d0.nodes[tops[0]] : null;

  if (one?.type === "frame" && !one.layout) {
    const f = one;
    const kids = f.children.filter((c) => d0.nodes[c]?.visible);
    const { layout, order } = infer(localBoxes(d0, f.id, kids), { w: f.w, h: f.h }, f.dir === "rtl");
    const hug = !!f.parentId && kids.length > 0;
    studio().mutate((d) => {
      const n = d.nodes[f.id] as FrameNode;
      n.layout = layout;
      const hidden = n.children.filter((c) => !order.includes(c));
      n.children = [...order, ...hidden];
      if (hug) {
        if (n.sizeH !== "fill") n.sizeH = "hug";
        if (n.sizeV !== "fill") n.sizeV = "hug";
      }
    });
    return;
  }

  // Wrap: same parent only (like Frame selection).
  const parentId = d0.nodes[tops[0]].parentId;
  if (tops.some((id) => d0.nodes[id].parentId !== parentId)) return;
  const parent = parentId ? d0.nodes[parentId] : null;
  const rtl = parent?.type === "frame" && parent.dir === "rtl";
  const inv = invert(parentId ? worldMatrix(d0, parentId) : [1, 0, 0, 1, 0, 0]);
  const boxes = tops.map((id) => {
    const wb = worldBounds(d0, id);
    const p = apply(inv, { x: wb.x, y: wb.y });
    return { id, b: { x: p.x, y: p.y, w: wb.w, h: wb.h } };
  });
  const { layout, order } = infer(boxes, null, rtl);
  let created = "";
  frameSelection(order, (b) => {
    const f = makeFrame({ ...b, name: "Frame", fill: null, clip: false, dir: rtl ? "rtl" : "ltr", layout, sizeH: "hug", sizeV: "hug" });
    created = f.id;
    return f;
  });
  if (created) studio().select([created]);
}

/** ⌥⇧A: drop auto layout; every layer keeps where it is now. */
export function removeAutoLayout(ids: string[]) {
  studio().mutate((d) => {
    for (const id of ids) {
      const f = d.nodes[id];
      if (f?.type !== "frame" || !f.layout) continue;
      delete f.layout;
      if (f.sizeH === "hug") f.sizeH = "fixed";
      if (f.sizeV === "hug") f.sizeV = "fixed";
      for (const cid of f.children) {
        const c = d.nodes[cid];
        if (!c) continue;
        if (c.sizeH === "fill") c.sizeH = "fixed";
        if (c.sizeV === "fill") c.sizeV = "fixed";
        delete c.grow;
        delete c.margin;
        delete c.absolute;
      }
    }
  });
}

/** Turn auto layout on or off, or change settings, on auto-layout frames. */
export function updateLayout(ids: string[], fn: (l: AutoLayout, f: FrameNode) => void, continuous = false) {
  if (continuous) studio().beginTx();
  studio().mutate((d) => {
    for (const id of ids) {
      const f = d.nodes[id];
      if (hasAutoLayout(f)) fn(f.layout, f);
    }
  });
}

// ---------------------------------------------------------------------------
// Sizing

/** Keep a text node's autoSize consistent with the sizing just chosen (mutates). */
function syncTextAutoSize(n: SceneNode, axis: Axis, mode: Sizing) {
  if (n.type !== "text") return;
  const t = n.text;
  if (axis === "h") {
    if (mode === "hug") {
      t.autoSize = "width";
      n.sizeV = "hug";
    } else if (t.autoSize === "width") t.autoSize = "height";
  } else if (mode === "hug") {
    if (t.autoSize === "fixed") t.autoSize = "height";
  } else {
    t.autoSize = "fixed";
    if (n.sizeH === "hug") n.sizeH = "fixed";
  }
}

/** Which sizing modes a node can use on an axis. */
export function sizingOptions(d: Doc, n: SceneNode): { hug: boolean; fill: boolean } {
  return { hug: n.type === "text" || hasAutoLayout(n), fill: inFlow(d, n) };
}

/** Fixed / hug contents / fill container, with Figma's rules for the parent and children. */
export function setSizing(ids: string[], axis: Axis, mode: Sizing) {
  const key = sizeKey(axis);
  studio().mutate((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (!n) continue;
      const ok = sizingOptions(d, n);
      if ((mode === "hug" && !ok.hug) || (mode === "fill" && !ok.fill)) continue;
      const p = parentOf(d, n);
      // A hugging parent can't be filled: it becomes fixed on that axis.
      if (mode === "fill" && p && sizingOf(d, p, axis) === "hug") p[key] = "fixed";
      // A frame that starts hugging can't have children filling it.
      if (mode === "hug" && hasAutoLayout(n)) {
        for (const cid of n.children) {
          const c = d.nodes[cid];
          if (c && c[key] === "fill") c[key] = c.type === "text" || hasAutoLayout(c) ? "hug" : "fixed";
          if (c?.grow && n.layout.direction === (axis === "h" ? "horizontal" : "vertical")) delete c.grow;
        }
      }
      n[key] = mode;
      if (mode !== "fill" && n.grow && mainAxisOf(d, n) === axis) delete n.grow;
      syncTextAutoSize(n, axis, mode);
    }
  });
}

/** A resize by hand pins the resized axes to fixed (called inside a recipe). */
export function pinResized(d: Doc, n: SceneNode, axes: Axis[]) {
  for (const a of axes) {
    const key = sizeKey(a);
    if (n[key] !== undefined || inFlow(d, n) || hasAutoLayout(n)) n[key] = "fixed";
    if (n.grow && mainAxisOf(d, n) === a) delete n.grow;
  }
  if (n.type === "text" && (n.sizeH !== undefined || n.sizeV !== undefined)) {
    if (n.text.autoSize === "fixed") {
      if (n.sizeH === "hug") n.sizeH = "fixed";
      if (n.sizeV === "hug") n.sizeV = "fixed";
    } else if (n.text.autoSize === "height" && n.sizeH === "hug") n.sizeH = "fixed";
  }
}

export function setAbsolute(ids: string[], on: boolean) {
  studio().mutate((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (!n || !hasAutoLayout(parentOf(d, n))) continue;
      if (on) n.absolute = true;
      else delete n.absolute;
    }
  });
}

// ---------------------------------------------------------------------------
// Moving layers in and out of the flow

/**
 * Reparent and reorder in one recipe (so the flow doesn't snap a node back in between).
 * `index` counts siblings without the moved nodes; `delta` moves the nodes in world space first.
 */
export function moveNodes(ids: string[], parentId: string | null, index?: number, delta?: Pt) {
  studio().mutate((d) => {
    const tops = topLevelOf(d, ids).filter((id) => id !== parentId && !(parentId && isDescendant(d, parentId, id)));
    const pInv = invert(parentId ? worldMatrix(d, parentId) : [1, 0, 0, 1, 0, 0]);
    const worlds = new Map(tops.map((id) => [id, delta ? mul(translate(delta.x, delta.y), worldMatrix(d, id)) : worldMatrix(d, id)]));
    for (const id of tops) {
      const n = d.nodes[id];
      const from = n.parentId ? d.nodes[n.parentId].children : d.roots;
      from.splice(from.indexOf(id), 1);
    }
    const to = parentId ? d.nodes[parentId].children : d.roots;
    let at = index === undefined ? to.length : Math.min(index, to.length);
    for (const id of tops) {
      const n = d.nodes[id];
      place(n, placementOf(mul(pInv, worlds.get(id)!), n.w, n.h));
      n.parentId = parentId;
      to.splice(at++, 0, id);
    }
  });
}

/** Siblings that take part in the flow, in order. */
const flowKids = (d: Doc, f: FrameNode, exclude?: Set<string>) =>
  f.children.filter((id) => {
    const c = d.nodes[id];
    return c && c.visible && !c.absolute && !exclude?.has(id);
  });

export interface FlowSlot {
  /** Insertion index among the frame's children, not counting the excluded ones. */
  index: number;
  /** Insertion line in world space. */
  line: [Pt, Pt];
}

/** Where a layer dropped at `world` would land in an auto-layout frame, and the line to show. */
export function flowIndexAt(d: Doc, frameId: string, world: Pt, exclude?: Set<string>): FlowSlot | null {
  const f = d.nodes[frameId];
  if (!hasAutoLayout(f)) return null;
  const m = worldMatrix(d, frameId);
  const p = apply(invert(m), world);
  const L = f.layout;
  const horizontal = L.direction === "horizontal";
  const rtl = f.dir === "rtl";
  const kids = flowKids(d, f, exclude).map((id) => d.nodes[id]);
  const padL = rtl ? L.padding.end : L.padding.start;
  const padR = rtl ? L.padding.start : L.padding.end;
  const half = Math.max(1, L.gap / 2);

  let slot = kids.length;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (horizontal) {
      if (L.wrap && p.y > c.y + c.h) continue; // on a later line
      if (L.wrap && p.y < c.y) {
        slot = i;
        break;
      }
      const mid = c.x + c.w / 2;
      if (rtl ? p.x > mid : p.x < mid) {
        slot = i;
        break;
      }
    } else if (p.y < c.y + c.h / 2) {
      slot = i;
      break;
    }
  }

  // Index in the full children list (minus excluded), so hidden and absolute siblings keep their places.
  const all = f.children.filter((id) => !exclude?.has(id));
  const index = slot < kids.length ? all.indexOf(kids[slot].id) : kids.length ? all.indexOf(kids[kids.length - 1].id) + 1 : all.length;

  let a: Pt;
  let b: Pt;
  const ref = kids[Math.min(slot, kids.length - 1)];
  const after = slot >= kids.length;
  if (!ref) {
    a = horizontal ? { x: rtl ? f.w - padR : padL, y: L.padding.top } : { x: padL, y: L.padding.top };
    b = horizontal ? { x: a.x, y: f.h - L.padding.bottom } : { x: f.w - padR, y: L.padding.top };
  } else if (horizontal) {
    const lead = rtl !== after; // line on the right edge of `ref`
    const x = lead ? ref.x + ref.w + half : ref.x - half;
    a = { x, y: ref.y };
    b = { x, y: ref.y + ref.h };
  } else {
    const y = after ? ref.y + ref.h + half : ref.y - half;
    a = { x: padL, y };
    b = { x: f.w - padR, y };
  }
  return { index, line: [apply(m, a), apply(m, b)] };
}

/** Arrow keys on in-flow layers step them through the flow. Returns false when nothing applies. */
export function stepInFlow(ids: string[], key: "left" | "right" | "up" | "down"): boolean {
  const d0 = studio().doc;
  const tops = topLevelOf(d0, ids).filter((id) => inFlow(d0, d0.nodes[id]));
  if (!tops.length) return false;
  studio().mutate((d) => {
    for (const id of tops) {
      const n = d.nodes[id];
      const f = parentOf(d, n);
      if (!hasAutoLayout(f)) continue;
      const horizontal = f.layout.direction === "horizontal";
      if (horizontal !== (key === "left" || key === "right")) continue;
      const forward = key === "down" || (key === "right" ? f.dir !== "rtl" : key === "left" && f.dir === "rtl");
      const kids = flowKids(d, f);
      const i = kids.indexOf(id);
      const swap = kids[forward ? i + 1 : i - 1];
      if (!swap) continue;
      const list = f.children;
      const a = list.indexOf(id);
      const b = list.indexOf(swap);
      [list[a], list[b]] = [list[b], list[a]];
    }
  });
  return true;
}
