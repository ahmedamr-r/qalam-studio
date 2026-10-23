import type { Doc, PathNode, Vec2, VectorData } from "@/doc/schema";
import { studio, type Camera } from "@/doc/store";
import { type Mat, type Pt, apply, invert, localMatrix, mul, worldMatrix } from "@/doc/geometry";
import { activeTokens, tokensForNode } from "@/design-system/registry";
import {
  type HandleRef,
  type PointRef,
  type SegRef,
  bendSegment,
  cloneVector,
  cutAt,
  deletePoints,
  flatten,
  isEndpoint,
  joinEndpoints,
  movePoints,
  nearestOnVector,
  normalizeVectorNode,
  segmentCubic,
  setHandle,
  splitSegment,
  toggleSmooth,
  transformVector,
  vectorOf,
  vectorScale,
  vectorToD,
  writeVector,
} from "@/doc/vector";
import { deleteAndHeal } from "@/doc/vector-fit";
import { hitPath, pickTarget } from "./hit-test";
import type { VectorOverlay } from "./vector-overlay";
import { useVectorEdit, type VectorSubTool } from "./vector-state";

/*
 * Vector edit mode (double-click a path, or Enter): select, drag and nudge anchors and handles,
 * marquee points, bend (⌘), add points on segments, delete or delete-and-heal, join ends, paint
 * closed regions and cut. Also the helpers the pen shares with it: the node's vector space mapped
 * to the screen, picking anchors/handles/segments in screen px, and the overlay draw list.
 */

/** Hit radii in screen px (anchors and knobs 6, segments 5, the pen's close target 8). */
export const HIT = { anchor: 6, handle: 6, segment: 5, close: 8, snap: 6 };
const DRAG_THRESHOLD = 3;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
/** The linear part of an affine map (for offsets such as handles and drag deltas). */
export const linear = (m: Mat, v: Vec2): Vec2 => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });
export const refKey = (r: PointRef) => `${r.path}:${r.point}`;
const sameRef = (a: PointRef | null | undefined, b: PointRef | null | undefined) => !!a && !!b && a.path === b.path && a.point === b.point;

// ---------------------------------------------------------------------------
// Spaces

/** A path node's vector space and how it maps to its parent, the world and the screen. */
export interface Space {
  id: string;
  node: PathNode;
  /** The vector, in vector space (vw × vh). */
  v: VectorData;
  /** The same vector in screen px (affine maps keep Bézier control points exact). */
  screen: VectorData;
  toParent: Mat;
  toWorld: Mat;
  toScreen: Mat;
  /** Screen → vector space. */
  fromScreen: Mat;
  /** World → vector space. */
  fromWorld: Mat;
  /** Parent → vector space. */
  fromParent: Mat;
}

const camMatrix = (cam: Camera): Mat => [cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom];

let memo: { doc: Doc; cam: Camera; id: string; sp: Space } | null = null;

export function spaceOf(doc: Doc, id: string | null, cam: Camera): Space | null {
  if (!id) return null;
  if (memo && memo.doc === doc && memo.cam === cam && memo.id === id) return memo.sp;
  const n = doc.nodes[id];
  if (!n || n.type !== "path") return null;
  const { sx, sy } = vectorScale(n);
  const S: Mat = [sx, 0, 0, sy, 0, 0];
  const toParent = mul(localMatrix(n), S);
  const toWorld = mul(worldMatrix(doc, id), S);
  const toScreen = mul(camMatrix(cam), toWorld);
  const v = vectorOf(n);
  const sp: Space = { id, node: n, v, screen: transformVector(v, toScreen), toParent, toWorld, toScreen, fromScreen: invert(toScreen), fromWorld: invert(toWorld), fromParent: invert(toParent) };
  memo = { doc, cam, id, sp };
  return sp;
}

/** An anchor in screen px. */
export const anchorAt = (sp: Space, r: PointRef): Pt => {
  const p = sp.screen.paths[r.path].points[r.point];
  return { x: p.x, y: p.y };
};

/** A handle's knob in screen px, or null when it has no length. */
export function handleAt(sp: Space, r: HandleRef): Pt | null {
  const p = sp.screen.paths[r.path]?.points[r.point];
  const h = p?.[r.side];
  if (!p || !h || Math.hypot(h.x, h.y) < 0.5) return null;
  return { x: p.x + h.x, y: p.y + h.y };
}

/** Path data of one segment in screen px. */
export function segmentD(sp: Space, s: SegRef): string {
  const c = segmentCubic(sp.screen, s);
  return `M${c[0].x} ${c[0].y}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`;
}

// ---------------------------------------------------------------------------
// Picking

export type Pick =
  | { kind: "handle"; ref: HandleRef; at: Pt }
  | { kind: "anchor"; ref: PointRef; at: Pt }
  | { kind: "segment"; seg: SegRef; t: number; at: Pt };

/**
 * What's under a screen point: a visible handle knob, an anchor, or a segment. A handle lying on
 * its own anchor loses to the anchor.
 */
export function pick(sp: Space, screen: Pt, handles: HandleRef[] = [], segments = true): Pick | null {
  let anchor: { ref: PointRef; at: Pt; d: number } | null = null;
  sp.screen.paths.forEach((p, pi) =>
    p.points.forEach((q, i) => {
      const d = Math.hypot(q.x - screen.x, q.y - screen.y);
      if (d <= HIT.anchor && (!anchor || d < anchor.d)) anchor = { ref: { path: pi, point: i }, at: { x: q.x, y: q.y }, d };
    }),
  );
  let handle: { ref: HandleRef; at: Pt; d: number } | null = null;
  for (const h of handles) {
    const at = handleAt(sp, h);
    if (!at) continue;
    const d = dist(at, screen);
    if (d <= HIT.handle && (!handle || d < handle.d)) handle = { ref: h, at, d };
  }
  const a = anchor as { ref: PointRef; at: Pt; d: number } | null;
  const h = handle as { ref: HandleRef; at: Pt; d: number } | null;
  if (h && (!a || h.d < a.d - 0.5)) return { kind: "handle", ref: h.ref, at: h.at };
  if (a) return { kind: "anchor", ref: a.ref, at: a.at };
  if (!segments) return null;
  const near = nearestOnVector(sp.screen, screen, HIT.segment);
  return near ? { kind: "segment", seg: near.seg, t: near.t, at: near.point } : null;
}

/** Handles worth showing for these anchors: their own, plus the neighbours' on the segments they touch. */
export function visibleHandles(v: VectorData, refs: PointRef[]): HandleRef[] {
  const out: HandleRef[] = [];
  const seen = new Set<string>();
  const push = (path: number, point: number, side: "in" | "out") => {
    const p = v.paths[path]?.points[point];
    const k = `${path}:${point}:${side}`;
    if (!p?.[side] || seen.has(k)) return;
    seen.add(k);
    out.push({ path, point, side });
  };
  for (const r of refs) {
    const path = v.paths[r.path];
    if (!path?.points[r.point]) continue;
    const n = path.points.length;
    push(r.path, r.point, "in");
    push(r.path, r.point, "out");
    if (r.point > 0 || path.closed) push(r.path, (r.point - 1 + n) % n, "out");
    if (r.point < n - 1 || path.closed) push(r.path, (r.point + 1) % n, "in");
  }
  return out;
}

/** Every anchor of the vector. */
export const allPoints = (v: VectorData): PointRef[] => v.paths.flatMap((p, pi) => p.points.map((_, i) => ({ path: pi, point: i })));

// ---------------------------------------------------------------------------
// Overlay

export interface OverlayOpts {
  selected?: PointRef[];
  handle?: HandleRef | null;
  hover?: Pick | null;
  /** Anchors whose handles show (besides the selected ones). */
  handlesOf?: PointRef[];
  /** The first anchor of the path being drawn. */
  first?: PointRef | null;
  born?: (r: PointRef) => number | undefined;
  marquee?: { x: number; y: number; w: number; h: number } | null;
}

/** The draw list for the edited vector: skeleton, handles, anchors, hover and selection states. */
export function editOverlay(sp: Space, o: OverlayOpts): VectorOverlay {
  const sel = o.selected ?? [];
  const isSel = (r: PointRef) => sel.some((s) => sameRef(s, r));
  const hs = visibleHandles(sp.v, [...sel, ...(o.handle ? [o.handle] : []), ...(o.handlesOf ?? [])]);
  const hov = o.hover;
  const handles = hs.flatMap((h) => {
    const b = handleAt(sp, h);
    if (!b) return [];
    const selected = !!o.handle && sameRef(o.handle, h) && o.handle.side === h.side;
    const hover = hov?.kind === "handle" && sameRef(hov.ref, h) && hov.ref.side === h.side;
    return [{ a: anchorAt(sp, h), b, selected, hover }];
  });
  const anchors = allPoints(sp.v).map((r) => ({
    p: anchorAt(sp, r),
    selected: isSel(r),
    hover: hov?.kind === "anchor" && sameRef(hov.ref, r),
    first: !!o.first && sameRef(o.first, r),
    born: o.born?.(r),
  }));
  return {
    skeleton: vectorToD(sp.screen),
    highlight: hov?.kind === "segment" ? segmentD(sp, hov.seg) : undefined,
    handles,
    anchors,
    marquee: o.marquee ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Writes

/**
 * Write the edited vector (vector space). Mid-drag writes leave the box alone so nothing reflows
 * under the pointer; a commit (`normalize`) bakes the scale and fits the box to the curve. The first
 * point edit turns a parametric shape (polygon, star, line) into a plain vector, like Figma.
 */
export function writeNodeVector(id: string, v: VectorData, normalize: boolean) {
  studio().mutate((d) => {
    const n = d.nodes[id];
    if (!n || n.type !== "path") return;
    delete n.shape;
    // Edited by hand: an ordinary vector now, no longer rebuilt from its parts.
    delete n.recipe;
    delete n.fillParent;
    if (normalize) normalizeVectorNode(n, v);
    else writeVector(n, v);
  });
}

/** Remove a node outright (its last anchor went). */
export function removeNode(id: string) {
  const s = studio();
  s.mutate((d) => {
    const n = d.nodes[id];
    if (!n) return;
    const list = n.parentId ? d.nodes[n.parentId].children : d.roots;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    delete d.nodes[id];
  });
  s.select([]);
}

/** Apply an edit: an empty result deletes the node and leaves edit mode. */
function commitEdit(id: string, v: VectorData) {
  if (!v.paths.some((p) => p.points.length > 1)) {
    useVectorEdit.getState().exit();
    removeNode(id);
    return;
  }
  writeNodeVector(id, v, true);
}

/** The edit sub-tool also drives the studio tool: the pen sub-tool is the pen, the rest are Move. */
export function setEditTool(t: VectorSubTool) {
  useVectorEdit.getState().setTool(t);
  studio().setTool(t === "pen" ? "pen" : "select");
}

/** Leave edit mode with the node selected and the Move tool. */
export function exitEdit() {
  const v = useVectorEdit.getState();
  const id = v.nodeId;
  v.exit();
  const s = studio();
  if (s.tool !== "select") s.setTool("select");
  if (id && s.doc.nodes[id]) s.select([id]);
}

// ---------------------------------------------------------------------------
// The session

export interface EditInput {
  screen: Pt;
  world: Pt;
  shift: boolean;
  alt: boolean;
  mod: boolean;
}

type Gesture =
  /** `collapse`: a click (no drag) picks this anchor alone. `toggle`: a click deselects it (⇧). */
  | { kind: "points"; start: Pt; startV: VectorData; refs: PointRef[]; lead: PointRef; moved: boolean; sp: Space; collapse?: PointRef; toggle?: PointRef }
  | { kind: "handle"; start: Pt; startV: VectorData; ref: HandleRef; moved: boolean; sp: Space }
  | { kind: "bend-seg"; start: Pt; startV: VectorData; seg: SegRef; t: number; moved: boolean; sp: Space }
  | { kind: "bend-anchor"; start: Pt; startV: VectorData; ref: PointRef; moved: boolean; sp: Space }
  | { kind: "marquee"; start: Pt; cur: Pt; base: PointRef[]; moved: boolean; sp: Space };

export class EditSession {
  private g: Gesture | null = null;
  hover: Pick | null = null;
  private marquee: { x: number; y: number; w: number; h: number } | null = null;

  constructor(private camera: () => Camera) {}

  get active() {
    return this.g !== null;
  }

  private space(): Space | null {
    return spaceOf(studio().doc, useVectorEdit.getState().nodeId, this.camera());
  }

  private handles(sp: Space): HandleRef[] {
    const e = useVectorEdit.getState();
    return visibleHandles(sp.v, [...e.points, ...(e.handle ? [e.handle] : [])]);
  }

  /** Bend (⌘ held or the Bend sub-tool). */
  private bending(mod: boolean) {
    return mod || useVectorEdit.getState().tool === "bend";
  }

  down(p: EditInput): void {
    const sp = this.space();
    if (!sp) return;
    const e = useVectorEdit.getState();
    const hit = pick(sp, p.screen, this.handles(sp));
    if (e.tool === "paint") return this.paint(sp, p.screen);
    if (e.tool === "cut") return this.cut(sp, hit);
    if (this.bending(p.mod) && hit && hit.kind !== "handle") {
      if (hit.kind === "anchor") this.g = { kind: "bend-anchor", start: p.screen, startV: sp.v, ref: hit.ref, moved: false, sp };
      else this.g = { kind: "bend-seg", start: p.screen, startV: sp.v, seg: hit.seg, t: hit.t, moved: false, sp };
      return;
    }
    if (hit?.kind === "handle") {
      e.selectHandle(hit.ref);
      this.g = { kind: "handle", start: p.screen, startV: sp.v, ref: hit.ref, moved: false, sp };
      return;
    }
    if (hit?.kind === "anchor") {
      const isSel = e.points.some((r) => sameRef(r, hit.ref));
      // ⇧ adds an anchor at once; a selected one comes off only on a click, so ⇧-drag moves them all.
      if (p.shift && !isSel) e.select([hit.ref], true);
      else if (!isSel) e.select([hit.ref]);
      else useVectorEdit.setState({ handle: null });
      // Pressing one of several selected anchors keeps them all for a drag; a click picks it alone.
      const collapse = isSel && !p.shift && e.points.length > 1 ? hit.ref : undefined;
      const toggle = isSel && p.shift ? hit.ref : undefined;
      this.g = { kind: "points", start: p.screen, startV: sp.v, refs: useVectorEdit.getState().points, lead: hit.ref, moved: false, sp, collapse, toggle };
      return;
    }
    if (hit?.kind === "segment") {
      const path = sp.v.paths[hit.seg.path];
      const ends = [
        { path: hit.seg.path, point: hit.seg.seg },
        { path: hit.seg.path, point: (hit.seg.seg + 1) % path.points.length },
      ];
      e.select(p.shift ? ends.filter((r) => !e.points.some((q) => sameRef(q, r))) : ends, p.shift);
      this.g = { kind: "points", start: p.screen, startV: sp.v, refs: useVectorEdit.getState().points, lead: ends[0], moved: false, sp };
      return;
    }
    this.g = { kind: "marquee", start: p.screen, cur: p.screen, base: p.shift ? e.points : [], moved: false, sp };
  }

  move(p: EditInput): void {
    const g = this.g;
    if (!g) {
      const sp = this.space();
      this.hover = sp ? pick(sp, p.screen, this.handles(sp)) : null;
      return;
    }
    if (!g.moved) {
      if (dist(p.screen, g.start) < DRAG_THRESHOLD) return;
      g.moved = true;
      if (g.kind !== "marquee") studio().beginTx();
    }
    const sp = g.sp;
    const id = sp.id;
    switch (g.kind) {
      case "points": {
        let d = sub(p.screen, g.start);
        if (p.shift) d = Math.abs(d.x) > Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y };
        // The anchor under the pointer snaps to the vector's other anchors, else to whole pixels.
        const leadStart = anchorAt(sp, g.lead);
        const target = add(leadStart, d);
        const moving = new Set(g.refs.map(refKey));
        let snapped: Pt | null = null;
        let best: number = HIT.snap;
        for (const r of allPoints(sp.v)) {
          if (moving.has(refKey(r))) continue;
          const q = anchorAt(sp, r);
          const dd = dist(q, target);
          if (dd <= best) {
            best = dd;
            snapped = q;
          }
        }
        let dv: Vec2;
        if (snapped) dv = sub(apply(sp.fromScreen, snapped), apply(sp.fromScreen, leadStart));
        else {
          const lead = sp.v.paths[g.lead.path].points[g.lead.point];
          const parent = apply(sp.toParent, add(lead, linear(sp.fromScreen, d)));
          const rounded = { x: Math.round(parent.x), y: Math.round(parent.y) };
          dv = sub(apply(sp.fromParent, rounded), lead);
        }
        writeNodeVector(id, movePoints(g.startV, g.refs, dv.x, dv.y), false);
        break;
      }
      case "handle": {
        const a = g.startV.paths[g.ref.path].points[g.ref.point];
        const o = sub(apply(sp.fromScreen, p.screen), a);
        writeNodeVector(id, setHandle(g.startV, g.ref, o, { breakMirror: p.alt, snap45: p.shift }), false);
        break;
      }
      case "bend-seg":
        writeNodeVector(id, bendSegment(g.startV, g.seg, g.t, apply(sp.fromScreen, p.screen)), false);
        break;
      case "bend-anchor": {
        const v = cloneVector(g.startV);
        const a = v.paths[g.ref.path].points[g.ref.point];
        a.mirror = "angle-length";
        const o = sub(apply(sp.fromScreen, p.screen), a);
        writeNodeVector(id, setHandle(v, { ...g.ref, side: "out" }, o, { snap45: p.shift }), false);
        break;
      }
      case "marquee": {
        g.cur = p.screen;
        const box = { x: Math.min(g.start.x, p.screen.x), y: Math.min(g.start.y, p.screen.y), w: Math.abs(p.screen.x - g.start.x), h: Math.abs(p.screen.y - g.start.y) };
        this.marquee = box;
        const inside = allPoints(sp.v).filter((r) => {
          const q = anchorAt(sp, r);
          return q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h;
        });
        const base = g.base.filter((r) => !inside.some((q) => sameRef(q, r)));
        useVectorEdit.getState().select([...base, ...inside]);
        break;
      }
    }
  }

  up(p: EditInput): void {
    const g = this.g;
    this.g = null;
    this.marquee = null;
    if (!g) return;
    const s = studio();
    const id = g.sp.id;
    if (g.kind === "marquee") {
      if (g.moved || p.shift) return;
      // A click on empty canvas: another layer takes over, else clear the points, else leave.
      const other = pickTarget(s.doc, hitPath(s.doc, p.world, new Set([id]), { tol: 4 / s.camera.zoom }), [], false);
      const e = useVectorEdit.getState();
      if (other && other !== id) {
        e.exit();
        s.select([other]);
      } else if (e.points.length || e.handle) e.select([]);
      else exitEdit();
      return;
    }
    if (!g.moved) {
      if (g.kind === "bend-anchor") writeNodeVector(id, toggleSmooth(g.startV, g.ref), true);
      if (g.kind === "points" && g.collapse) useVectorEdit.getState().select([g.collapse]);
      if (g.kind === "points" && g.toggle) useVectorEdit.getState().select([g.toggle], true);
      return;
    }
    const n = s.doc.nodes[id];
    if (n?.type === "path") writeNodeVector(id, vectorOf(n), true);
    s.commitTx();
  }

  /** Cancel a running gesture (Esc mid-drag, tool change). */
  cancel() {
    const g = this.g;
    this.g = null;
    this.marquee = null;
    if (g?.moved && g.kind !== "marquee") studio().cancelTx();
  }

  doubleClick(p: EditInput): boolean {
    const sp = this.space();
    if (!sp) return false;
    const hit = pick(sp, p.screen, this.handles(sp));
    if (hit?.kind === "segment") {
      const { v, point } = splitSegment(sp.v, hit.seg, hit.t);
      writeNodeVector(sp.id, v, true);
      useVectorEdit.getState().select([point]);
      return true;
    }
    if (hit?.kind === "anchor") {
      writeNodeVector(sp.id, toggleSmooth(sp.v, hit.ref), true);
      return true;
    }
    return false;
  }

  /** Paint bucket: fill or unfill the closed region under the pointer. */
  private paint(sp: Space, screen: Pt) {
    const polys = flatten(sp.screen, 0.5);
    let target = -1;
    // flatten() keeps one polyline per non-empty subpath, in order.
    const live = sp.screen.paths.map((p, i) => ({ p, i })).filter(({ p }) => p.points.length);
    live.forEach(({ p, i }, k) => {
      if (p.closed && polys[k] && insidePoly(polys[k].pts, screen)) target = i;
    });
    if (target < 0) return;
    const s = studio();
    const ts = sp.node.parentId ? tokensForNode(s.doc, sp.id) : activeTokens();
    s.mutate((d) => {
      const m = d.nodes[sp.id] as PathNode;
      const v = cloneVector(vectorOf(m));
      if (!m.fill) {
        // A first fill: the clicked region only.
        m.fill = { color: ts.color("bg.surface") ?? "#FFFFFF", token: "bg.surface" };
        v.paths.forEach((p, i) => p.closed && (p.filled = i === target ? undefined : false));
      } else {
        const p = v.paths[target];
        p.filled = p.filled === false ? undefined : false;
      }
      for (const p of v.paths) if (p.filled === undefined) delete p.filled;
      delete m.shape;
      // Edited by hand: an ordinary vector now, no longer rebuilt from its parts.
      delete m.recipe;
      delete m.fillParent;
      writeVector(m, v);
    });
  }

  /** Cut: open the path at an anchor, or at a new anchor on the clicked segment. */
  private cut(sp: Space, hit: Pick | null) {
    if (!hit || hit.kind === "handle") return;
    let v = sp.v;
    let at: PointRef;
    if (hit.kind === "segment") {
      const r = splitSegment(v, hit.seg, hit.t);
      v = r.v;
      at = r.point;
    } else at = hit.ref;
    const next = cutAt(v, at);
    if (next === v && hit.kind === "anchor") return;
    useVectorEdit.getState().select([]);
    commitEdit(sp.id, next);
  }

  // -------------------------------------------------------------------------
  // keys (edit mode, no gesture of the pen running)

  keyDown(e: KeyboardEvent): boolean {
    const st = useVectorEdit.getState();
    const id = st.nodeId;
    if (!id) return false;
    const mod = e.metaKey || e.ctrlKey;
    const sp = this.space();
    if (!sp) return false;
    if (e.key === "Escape") {
      if (this.g) this.cancel();
      else exitEdit();
      return true;
    }
    if (e.key === "Enter" && !mod) {
      exitEdit();
      return true;
    }
    if (this.g) return false;
    if (e.key === "Backspace" || e.key === "Delete") {
      if (st.handle && !st.points.length && !e.shiftKey) {
        const v = cloneVector(sp.v);
        const p = v.paths[st.handle.path]?.points[st.handle.point];
        if (p) {
          delete p[st.handle.side];
          p.mirror = "none";
          st.selectHandle(null);
          writeNodeVector(id, v, true);
        }
        return true;
      }
      if (!st.points.length) return true;
      const v = e.shiftKey ? deleteAndHeal(sp.v, st.points) : deletePoints(sp.v, st.points);
      st.select([]);
      commitEdit(id, v);
      return true;
    }
    if (e.key.startsWith("Arrow") && !mod) {
      if (!st.points.length) return true;
      const step = e.shiftKey ? 10 : 1;
      const d = { x: e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, y: e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0 };
      const dv = linear(sp.fromParent, d);
      writeNodeVector(id, movePoints(sp.v, st.points, dv.x, dv.y), true);
      return true;
    }
    if (mod && !e.altKey && e.code === "KeyA" && !e.shiftKey) {
      st.select(allPoints(sp.v));
      return true;
    }
    if (mod && !e.altKey && e.code === "KeyJ") {
      const ends = st.points.filter((r) => isEndpoint(sp.v, r));
      if (ends.length === 2) {
        const j = joinEndpoints(sp.v, ends[0], ends[1], e.shiftKey);
        if (j) {
          writeNodeVector(id, j.v, true);
          st.select([j.point]);
        }
      }
      return true;
    }
    if (mod || e.altKey) return false;
    const k = e.key.toLowerCase();
    if (k === "v" && !e.shiftKey) return setEditTool("move"), true;
    if (k === "p" && !e.shiftKey) return setEditTool("pen"), true;
    if (k === "b") return setEditTool("paint"), true;
    if (k === "x" && !e.shiftKey) return setEditTool("cut"), true;
    return false;
  }

  overlay(o: { born?: (r: PointRef) => number | undefined }): VectorOverlay | null {
    const sp = this.space();
    if (!sp) return null;
    const e = useVectorEdit.getState();
    const g = this.g;
    const hover = g ? (g.kind === "bend-seg" ? { kind: "segment" as const, seg: g.seg, t: g.t, at: g.start } : null) : this.hover;
    const tool = e.tool;
    return editOverlay(sp, {
      selected: e.points,
      handle: e.handle,
      // The paint bucket and cut work on regions and segments, not handles.
      hover: tool === "paint" ? null : hover,
      handlesOf: g?.kind === "bend-anchor" ? [g.ref] : [],
      born: o.born,
      marquee: this.marquee,
    });
  }

  /** Cursor for the hovered thing (null: the plain arrow). */
  cursorKind(mod: boolean): "bend" | "bucket" | "scissors" | "point" | null {
    const tool = useVectorEdit.getState().tool;
    if (this.bending(mod)) return "bend";
    if (tool === "paint") return "bucket";
    if (tool === "cut") return "scissors";
    const h = this.g ? null : this.hover;
    return h && h.kind !== "segment" ? "point" : null;
  }
}

function insidePoly(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
