import type { Vec2, VectorData, VectorPoint } from "@/doc/schema";
import { studio, type Camera } from "@/doc/store";
import { type Pt, IDENTITY, apply, invert, worldMatrix } from "@/doc/geometry";
import { insertNodes } from "@/doc/ops";
import { hasAutoLayout } from "@/doc/autolayout";
import { activeTokens, tokensForNode } from "@/design-system/registry";
import { type PointRef, appendPoint, cloneVector, closePath, isEndpoint, joinEndpoints, normalizeVectorNode, reversePath, snapAngle, splitSegment, startPath, vectorOf } from "@/doc/vector";
import { deleteAndHeal } from "@/doc/vector-fit";
import { defaultInk, makeVector } from "@/doc/vector-shapes";
import { canvasIsDark } from "./chrome";
import { deepestFrame, hitPath } from "./hit-test";
import { HIT, type Pick, type Space, anchorAt, editOverlay, exitEdit, linear, pick, removeNode, setEditTool, spaceOf, writeNodeVector } from "./vector-edit";
import { OVERLAY_MOTION, type VectorOverlay } from "./vector-overlay";
import { canEditVector, useVectorEdit } from "./vector-state";

/*
 * The pen (P). Click places a corner, click-drag a smooth anchor with mirrored handles (⌥ breaks
 * the symmetry, ⇧ snaps to 45°, Space moves the anchor mid-drag). The first anchor waits in the
 * session; the path enters the document with the second, and every anchor after is one undo step.
 * Clicking the first anchor closes the path, Enter finishes, Esc ends the path then leaves edit
 * mode, Backspace takes the last anchor back. The session re-reads the document on every event,
 * so ⌘Z mid-path just continues from the anchor that is now last.
 */

export interface PenInput {
  screen: Pt;
  world: Pt;
  button: number;
  shift: boolean;
  alt: boolean;
  mod: boolean;
}

export interface PenCtx {
  camera(): Camera;
  mods(): { shift: boolean; alt: boolean; mod: boolean };
  /** An anchor was just placed (it pops in). */
  born(id: string, r: PointRef): void;
  bornAt(id: string, r: PointRef): number | undefined;
}

const DRAG_THRESHOLD = 3;
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const ORIGIN = { x: 0, y: 0 };

/** Whole pixels, keeping a 45° direction from `a` exact. */
export function pixelEnd(a: Pt, b: Pt, constrained: boolean): Pt {
  if (!constrained) return { x: Math.round(b.x), y: Math.round(b.y) };
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6) return { x: a.x, y: Math.round(b.y) };
  if (Math.abs(dy) < 1e-6) return { x: Math.round(b.x), y: a.y };
  const m = Math.round((Math.abs(dx) + Math.abs(dy)) / 2);
  return { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m };
}

/** The first anchor of a new path, before it is in the document (world space). */
interface Pending {
  world: Pt;
  out?: Vec2;
  in?: Vec2;
  /** Where a brand-new node goes; ignored when the path starts inside the edited node. */
  parentId: string | null;
  intoNode: boolean;
  born: number;
}

type PressKind = "pending" | "anchor" | "resume" | "close" | "join";

interface Press {
  kind: PressKind;
  startScreen: Pt;
  moved: boolean;
  /** The grabbed anchor, for presses on the document. */
  ref: PointRef | null;
  /** The anchor's position in world space (moves with Space). */
  anchor: Pt;
  /** Space held: the anchor follows the pointer from here. */
  space: { at: Pt; anchor: Pt } | null;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class PenSession {
  private press: Press | null = null;
  pending: Pending | null = null;
  /** The subpath of the edited node being drawn, if any. */
  pathIx: number | null = null;
  private cursor: { screen: Pt; world: Pt } | null = null;
  private hover: Pick | null = null;
  /** Hovering the first anchor: a click closes the path. */
  closeHover = false;
  /** When closeHover last turned on (ring tween). */
  closeAt = 0;
  /** Over an open endpoint of the selected path while idle and not editing. */
  private continueHover = false;

  constructor(private ctx: PenCtx) {}

  get drawing() {
    return this.pending !== null || this.pathIx !== null;
  }

  get pressing() {
    return this.press !== null;
  }

  private nodeId() {
    return useVectorEdit.getState().nodeId;
  }

  private space(): Space | null {
    return spaceOf(studio().doc, this.nodeId(), this.ctx.camera());
  }

  /** Re-read the document: undo, deletes or leaving edit mode end what no longer exists. */
  sync() {
    if (this.press) return;
    if (this.pathIx !== null) {
      const path = this.space()?.v.paths[this.pathIx];
      if (!path || path.closed || path.points.length < 2) this.pathIx = null;
    }
    if (this.pending?.intoNode && !this.nodeId()) this.pending = null;
    const drawing = this.drawing;
    if (useVectorEdit.getState().drawing !== drawing && this.nodeId()) useVectorEdit.getState().setDrawing(drawing);
  }

  /** Drop everything (tool change, dispose). A press mid-transaction is rolled back. */
  reset() {
    if (this.press && this.press.kind !== "pending") studio().cancelTx();
    this.press = null;
    this.pending = null;
    this.pathIx = null;
    this.hover = null;
    this.closeHover = false;
    if (useVectorEdit.getState().drawing) useVectorEdit.getState().setDrawing(false);
  }

  // ---------------------------------------------------------------------------
  // pointer

  down(p: PenInput) {
    if (p.button !== 0) return;
    this.sync();
    this.cursor = { screen: p.screen, world: p.world };
    const sp = this.space();
    if (this.pathIx !== null && sp) return this.downDrawing(p, sp, this.pathIx);
    if (this.pending) return this.downSecond(p, sp);
    this.downIdle(p, sp);
  }

  /** An anchor position: ⇧ keeps 45° steps from `from`, otherwise whole pixels in the parent. */
  private anchorPos(p: PenInput, from: Pt | null, parentId: string | null): Pt {
    const doc = studio().doc;
    const pm = parentId && doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY;
    const inv = invert(pm);
    const w = p.shift && from ? snapAngle(from, p.world) : p.world;
    const local = apply(inv, w);
    return apply(pm, pixelEnd(from ? apply(inv, from) : local, local, p.shift && !!from));
  }

  private downIdle(p: PenInput, sp: Space | null) {
    const s = studio();
    if (sp) {
      const hit = pick(sp, p.screen, [], true);
      // ⌥-click an anchor: delete it and heal the curve.
      if (hit?.kind === "anchor" && p.alt) {
        writeNodeVector(sp.id, deleteAndHeal(sp.v, [hit.ref]), true);
        useVectorEdit.getState().select([]);
        return;
      }
      if (hit?.kind === "anchor" && isEndpoint(sp.v, hit.ref)) return this.resume(p, sp, hit.ref);
      if (hit?.kind === "segment") {
        const { v, point } = splitSegment(sp.v, hit.seg, hit.t);
        writeNodeVector(sp.id, v, true);
        useVectorEdit.getState().select([point]);
        this.ctx.born(sp.id, point);
        return;
      }
      // A new subpath in the edited vector (from an inner anchor: at the same spot).
      const world = hit?.kind === "anchor" ? apply(sp.toWorld, sp.v.paths[hit.ref.path].points[hit.ref.point]) : this.anchorPos(p, null, sp.node.parentId);
      this.pending = { world, parentId: null, intoNode: true, born: now() };
    } else {
      // Over an open end of the selected vector: carry on drawing it.
      const sel = s.selection.length === 1 ? s.selection[0] : null;
      const ssp = sel && canEditVector(sel) ? spaceOf(s.doc, sel, this.ctx.camera()) : null;
      const hit = ssp ? pick(ssp, p.screen, [], false) : null;
      if (ssp && hit?.kind === "anchor" && isEndpoint(ssp.v, hit.ref) && useVectorEdit.getState().enter(ssp.id, "pen")) return this.resume(p, ssp, hit.ref);
      const parentId = deepestFrame(s.doc, hitPath(s.doc, p.world));
      this.pending = { world: this.anchorPos(p, null, parentId), parentId, intoNode: false, born: now() };
    }
    this.press = { kind: "pending", startScreen: p.screen, moved: false, ref: null, anchor: this.pending.world, space: null };
  }

  /** Continue an open path from one of its ends (reversed first if it's the start). */
  private resume(p: PenInput, sp: Space, ref: PointRef) {
    const s = studio();
    s.beginTx();
    let r = ref;
    if (isEndpoint(sp.v, ref) === "start") {
      const v = cloneVector(sp.v);
      v.paths[ref.path] = reversePath(v.paths[ref.path]);
      writeNodeVector(sp.id, v, false);
      r = { path: ref.path, point: v.paths[ref.path].points.length - 1 };
    }
    this.pathIx = r.path;
    useVectorEdit.getState().select([]);
    useVectorEdit.getState().setDrawing(true);
    this.press = { kind: "resume", startScreen: p.screen, moved: false, ref: r, anchor: apply(sp.toWorld, sp.v.paths[ref.path].points[ref.point]), space: null };
  }

  private downDrawing(p: PenInput, sp: Space, pathIx: number) {
    const s = studio();
    const path = sp.v.paths[pathIx];
    const last: PointRef = { path: pathIx, point: path.points.length - 1 };
    const lastWorld = apply(sp.toWorld, path.points[last.point]);
    const first = anchorAt(sp, { path: pathIx, point: 0 });
    if (path.points.length >= 2 && dist(first, p.screen) <= HIT.close) {
      s.beginTx();
      writeNodeVector(sp.id, closePath(sp.v, pathIx), false);
      this.press = { kind: "close", startScreen: p.screen, moved: false, ref: { path: pathIx, point: 0 }, anchor: apply(sp.toWorld, path.points[0]), space: null };
      return;
    }
    const hit = pick(sp, p.screen, [], false);
    let at: Pt | null = null;
    if (hit?.kind === "anchor") {
      if (hit.ref.path === pathIx && hit.ref.point === last.point) {
        // The last anchor again: a drag re-pulls its handles.
        s.beginTx();
        this.press = { kind: "resume", startScreen: p.screen, moved: false, ref: last, anchor: lastWorld, space: null };
        return;
      }
      if (hit.ref.path !== pathIx && isEndpoint(sp.v, hit.ref)) {
        const j = joinEndpoints(sp.v, last, hit.ref);
        if (j) {
          s.beginTx();
          writeNodeVector(sp.id, j.v, false);
          this.press = { kind: "join", startScreen: p.screen, moved: false, ref: null, anchor: lastWorld, space: null };
          return;
        }
      }
      // Snap onto the vector's other anchors.
      at = apply(sp.toWorld, sp.v.paths[hit.ref.path].points[hit.ref.point]);
    }
    const world = at ?? this.anchorPos(p, lastWorld, sp.node.parentId);
    const pv = apply(sp.fromWorld, world);
    s.beginTx();
    const v = appendPoint(sp.v, pathIx, { x: pv.x, y: pv.y, mirror: "none" });
    writeNodeVector(sp.id, v, false);
    const ref = { path: pathIx, point: v.paths[pathIx].points.length - 1 };
    this.ctx.born(sp.id, ref);
    this.press = { kind: "anchor", startScreen: p.screen, moved: false, ref, anchor: world, space: null };
  }

  /** The second anchor: the path (or a whole new vector) enters the document. */
  private downSecond(p: PenInput, sp: Space | null) {
    const pend = this.pending!;
    const s = studio();
    const parentId = pend.intoNode && sp ? sp.node.parentId : pend.parentId;
    const world = this.anchorPos(p, pend.world, parentId);
    const cam = this.ctx.camera();
    // A click on the pending anchor itself does nothing.
    if (dist(world, pend.world) * cam.zoom < 1) return;
    const pointFrom = (m: (q: Pt) => Pt, lin: (q: Vec2) => Vec2, w: Pt, out?: Vec2, inn?: Vec2): VectorPoint => {
      const q = m(w);
      return { x: q.x, y: q.y, mirror: out && inn ? "angle-length" : "none", ...(out ? { out: lin(out) } : {}), ...(inn ? { in: lin(inn) } : {}) };
    };
    s.beginTx();
    let id: string;
    if (pend.intoNode && sp) {
      const v = startPath(sp.v, [
        pointFrom((q) => apply(sp.fromWorld, q), (o) => linear(sp.fromWorld, o), pend.world, pend.out, pend.in),
        pointFrom((q) => apply(sp.fromWorld, q), (o) => linear(sp.fromWorld, o), world),
      ]);
      writeNodeVector(sp.id, v, false);
      id = sp.id;
      this.pathIx = v.paths.length - 1;
    } else {
      const doc = s.doc;
      const parent = parentId && doc.nodes[parentId] ? parentId : null;
      const inv = invert(parent ? worldMatrix(doc, parent) : IDENTITY);
      const v: VectorData = {
        paths: [
          {
            points: [pointFrom((q) => apply(inv, q), (o) => linear(inv, o), pend.world, pend.out, pend.in), pointFrom((q) => apply(inv, q), (o) => linear(inv, o), world)],
            closed: false,
          },
        ],
      };
      const ts = parent ? tokensForNode(doc, parent) : activeTokens();
      const node = makeVector({}, ts, defaultInk(doc, parent, canvasIsDark(), ts));
      // An empty box at the parent's origin: normalising places it around the two anchors.
      normalizeVectorNode(node, v);
      if (hasAutoLayout(parent ? doc.nodes[parent] : null)) node.absolute = true;
      insertNodes([node], parent);
      useVectorEdit.getState().enter(node.id, "pen");
      id = node.id;
      this.pathIx = 0;
    }
    const ref = { path: this.pathIx, point: 1 };
    this.ctx.born(id, { path: this.pathIx, point: 0 });
    this.ctx.born(id, ref);
    this.pending = null;
    useVectorEdit.getState().setDrawing(true);
    this.press = { kind: "anchor", startScreen: p.screen, moved: false, ref, anchor: world, space: null };
  }

  move(p: PenInput) {
    this.cursor = { screen: p.screen, world: p.world };
    const pr = this.press;
    if (!pr) return this.updateHover(p);
    if (!pr.moved) {
      if (dist(p.screen, pr.startScreen) < DRAG_THRESHOLD) return;
      pr.moved = true;
    }
    this.applyDrag();
  }

  /** Handles follow the pointer (⇧ 45°, ⌥ only the outgoing one); with Space the anchor moves instead. */
  private applyDrag() {
    const pr = this.press;
    const c = this.cursor;
    if (!pr || !c || !pr.moved) return;
    const { shift, alt } = this.ctx.mods();
    if (pr.space) {
      const to = add(pr.space.anchor, sub(c.world, pr.space.at));
      const d = sub(to, pr.anchor);
      pr.anchor = to;
      if (pr.kind === "pending" && this.pending) this.pending.world = to;
      else if (pr.ref) {
        const sp = this.space();
        if (!sp) return;
        const v = cloneVector(sp.v);
        const pt = v.paths[pr.ref.path]?.points[pr.ref.point];
        if (!pt) return;
        const dv = linear(sp.fromWorld, d);
        pt.x += dv.x;
        pt.y += dv.y;
        writeNodeVector(sp.id, v, false);
      }
      return;
    }
    let o = sub(c.world, pr.anchor);
    if (shift) o = snapAngle(ORIGIN, o);
    if (pr.kind === "join") return;
    if (pr.kind === "pending") {
      const pend = this.pending;
      if (!pend) return;
      pend.out = o;
      if (!alt) pend.in = neg(o);
      return;
    }
    const sp = this.space();
    if (!sp || !pr.ref) return;
    const v = cloneVector(sp.v);
    const pt = v.paths[pr.ref.path]?.points[pr.ref.point];
    if (!pt) return;
    const ov = linear(sp.fromWorld, o);
    if (pr.kind === "close") {
      // Dragging on the first anchor shapes the closing segment through it.
      pt.in = neg(ov);
      if (alt) pt.mirror = "none";
      else if (pt.out && pt.mirror !== "none") {
        const l = Math.hypot(pt.out.x, pt.out.y);
        const lo = Math.hypot(ov.x, ov.y) || 1;
        pt.out = pt.mirror === "angle-length" ? { ...ov } : { x: (ov.x / lo) * l, y: (ov.y / lo) * l };
      } else if (!pt.out) pt.mirror = "none";
    } else {
      pt.out = ov;
      if (alt) pt.mirror = "none";
      else if (pr.kind === "resume" && pt.in) {
        // Continuing from an end: its incoming handle turns to stay smooth but keeps its length.
        const l = Math.hypot(pt.in.x, pt.in.y);
        const lo = Math.hypot(ov.x, ov.y) || 1;
        pt.in = { x: (-ov.x / lo) * l, y: (-ov.y / lo) * l };
        pt.mirror = "angle";
      } else if (pr.kind === "anchor") {
        pt.in = neg(ov);
        pt.mirror = "angle-length";
      }
    }
    writeNodeVector(sp.id, v, false);
  }

  up(p: PenInput) {
    void p;
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    if (pr.kind === "pending") return;
    const s = studio();
    const id = this.nodeId();
    const n = id ? s.doc.nodes[id] : null;
    if (id && n?.type === "path") writeNodeVector(id, vectorOf(n), true);
    s.commitTx();
    if (pr.kind === "close" || pr.kind === "join") {
      this.pathIx = null;
      useVectorEdit.getState().setDrawing(false);
    }
    this.sync();
  }

  private updateHover(p: PenInput) {
    const wasClose = this.closeHover;
    this.hover = null;
    this.closeHover = false;
    this.continueHover = false;
    const sp = this.space();
    if (sp) {
      if (this.pathIx !== null) {
        const path = sp.v.paths[this.pathIx];
        if (path && path.points.length >= 2 && dist(anchorAt(sp, { path: this.pathIx, point: 0 }), p.screen) <= HIT.close) this.closeHover = true;
      }
      if (!this.closeHover) this.hover = pick(sp, p.screen, [], this.pathIx === null && !this.pending);
    } else if (!this.pending) {
      const s = studio();
      const sel = s.selection.length === 1 ? s.selection[0] : null;
      const ssp = sel && s.doc.nodes[sel]?.type === "path" ? spaceOf(s.doc, sel, this.ctx.camera()) : null;
      const hit = ssp ? pick(ssp, p.screen, [], false) : null;
      this.continueHover = !!ssp && hit?.kind === "anchor" && !!isEndpoint(ssp.v, hit.ref);
    }
    if (this.closeHover && !wasClose) this.closeAt = now();
  }

  // ---------------------------------------------------------------------------
  // keys

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === "Shift" || e.key === "Alt" || e.key === "Meta" || e.key === "Control") {
      this.applyDrag();
      return false;
    }
    const pr = this.press;
    if (e.code === "Space") {
      if (pr?.moved) {
        if (!e.repeat && !pr.space && this.cursor) pr.space = { at: this.cursor.world, anchor: pr.anchor };
        return true;
      }
      return false;
    }
    if (e.metaKey || e.ctrlKey) return false;
    const editing = !!this.nodeId();
    if (e.key === "Escape") {
      if (pr) {
        // Drop the anchor being placed.
        if (pr.kind === "pending") this.pending = null;
        else studio().cancelTx();
        this.press = null;
        this.sync();
        return true;
      }
      if (this.drawing) {
        // Stage 1: the path ends, edit mode stays (with Move).
        this.endPath();
        if (editing) setEditTool("move");
        else studio().setTool("select");
        return true;
      }
      // Stage 2: leave edit mode.
      if (editing) exitEdit();
      else studio().setTool("select");
      return true;
    }
    if (e.key === "Enter") {
      if (pr) return true;
      if (!this.drawing && !editing) return false;
      this.endPath();
      if (editing) exitEdit();
      else studio().setTool("select");
      return true;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (pr) return true;
      if (!this.drawing) return false;
      this.removeLast();
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent) {
    if (e.code === "Space" && this.press) this.press.space = null;
    if (e.key === "Shift" || e.key === "Alt") this.applyDrag();
  }

  endPath() {
    this.pending = null;
    this.pathIx = null;
    this.press = null;
    if (useVectorEdit.getState().drawing) useVectorEdit.getState().setDrawing(false);
  }

  /** Backspace: take the last anchor back (one undo step); the first one returns to the session. */
  private removeLast() {
    if (this.pathIx === null) {
      this.pending = null;
      return;
    }
    const sp = this.space();
    if (!sp) return this.endPath();
    const path = sp.v.paths[this.pathIx];
    if (path.points.length > 2) {
      const v = cloneVector(sp.v);
      const pts = v.paths[this.pathIx].points;
      pts.pop();
      delete pts[pts.length - 1].out;
      writeNodeVector(sp.id, v, true);
      return;
    }
    const first = path.points[0];
    const world = apply(sp.toWorld, first);
    const back: Pending = { world, parentId: sp.node.parentId, intoNode: true, born: now() };
    if (first.out) back.out = linear(sp.toWorld, first.out);
    const rest: VectorData = { paths: sp.v.paths.filter((_, i) => i !== this.pathIx) };
    this.pathIx = null;
    if (!rest.paths.length) {
      // The vector's only path: the node goes and the anchor waits, as before the second click.
      removeNode(sp.id);
      back.intoNode = false;
    } else writeNodeVector(sp.id, rest, true);
    this.pending = back;
  }

  // ---------------------------------------------------------------------------
  // drawing

  cursorKind(): "pen" | "pen-add" | "pen-close" | "pen-remove" | "pen-continue" | "bend" {
    const { alt, mod } = this.ctx.mods();
    const editing = !!this.nodeId();
    if (editing && mod && !this.press) return "bend";
    if (this.closeHover) return "pen-close";
    if (this.continueHover) return "pen-continue";
    const h = this.hover;
    const sp = h ? this.space() : null;
    if (h?.kind === "anchor" && sp) {
      if (alt && this.pathIx === null) return "pen-remove";
      if (isEndpoint(sp.v, h.ref) && (this.pathIx === null || h.ref.path !== this.pathIx)) return "pen-continue";
    }
    if (h?.kind === "segment" && this.pathIx === null && !this.pending) return "pen-add";
    return "pen";
  }

  overlay(selected: PointRef[], at = now()): VectorOverlay | null {
    const sp = this.space();
    const cam = this.ctx.camera();
    const toScreen = (w: Pt): Pt => ({ x: (w.x - cam.x) * cam.zoom, y: (w.y - cam.y) * cam.zoom });
    const id = this.nodeId();
    const pathIx = this.pathIx;
    const pr = this.press;
    let o: VectorOverlay;
    if (sp && id) {
      const last = pathIx !== null ? { path: pathIx, point: sp.v.paths[pathIx].points.length - 1 } : null;
      o = editOverlay(sp, {
        selected: pathIx === null && !this.pending ? selected : [],
        hover: this.hover?.kind === "handle" ? null : this.hover,
        handlesOf: [...(last ? [last] : []), ...(pr?.ref ? [pr.ref] : [])],
        first: pathIx !== null ? { path: pathIx, point: 0 } : null,
        born: (r) => this.ctx.bornAt(id, r),
      });
      if (this.hover?.kind === "segment" && pathIx === null && !this.pending) o.addPoint = this.hover.at;
    } else if (this.pending || this.continueHover) {
      o = { handles: [], anchors: [] };
    } else return null;

    const pend = this.pending;
    if (pend) {
      const ps = toScreen(pend.world);
      for (const h of [pend.out, pend.in]) if (h) o.handles.push({ a: ps, b: add(ps, { x: h.x * cam.zoom, y: h.y * cam.zoom }), selected: false, hover: false });
      o.anchors.push({ p: ps, selected: false, hover: false, first: true, born: pend.born });
    }

    // Rubber band: from the last anchor (along its outgoing handle) to the pointer or the close target.
    const c = this.cursor;
    if (c && !pr && (pathIx !== null || pend)) {
      let from: Pt, out: Vec2 | undefined, fromWorld: Pt;
      if (pathIx !== null && sp) {
        const pts = sp.screen.paths[pathIx].points;
        const l = pts[pts.length - 1];
        from = { x: l.x, y: l.y };
        out = l.out;
        fromWorld = apply(sp.toWorld, sp.v.paths[pathIx].points[pts.length - 1]);
      } else {
        from = toScreen(pend!.world);
        out = pend!.out ? { x: pend!.out.x * cam.zoom, y: pend!.out.y * cam.zoom } : undefined;
        fromWorld = pend!.world;
      }
      let to: Pt, inn: Vec2 | undefined;
      if (this.closeHover && sp && pathIx !== null) {
        const f = sp.screen.paths[pathIx].points[0];
        to = { x: f.x, y: f.y };
        inn = f.in;
        o.closeRing = { ...to, t: OVERLAY_MOTION.ring ? Math.min(1, (at - this.closeAt) / OVERLAY_MOTION.ring) : 1 };
      } else {
        const w = this.ctx.mods().shift ? snapAngle(fromWorld, c.world) : c.world;
        to = toScreen(w);
        o.ghost = to;
      }
      const c1 = out ? add(from, out) : from,
        c2 = inn ? add(to, inn) : to;
      o.preview = out || inn ? `M${from.x} ${from.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}` : `M${from.x} ${from.y}L${to.x} ${to.y}`;
    }
    return o;
  }
}
