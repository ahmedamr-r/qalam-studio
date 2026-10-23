import { studio, type Camera } from "@/doc/store";
import type { Paint } from "@/doc/schema";
import { type Mat, type Pt, IDENTITY, apply, invert, worldMatrix } from "@/doc/geometry";
import { insertNodes } from "@/doc/ops";
import { hasAutoLayout } from "@/doc/autolayout";
import { activeTokens, tokensForNode } from "@/design-system/registry";
import { normalizeVectorNode } from "@/doc/vector";
import { pencilToVector } from "@/doc/vector-fit";
import { defaultInk, makeVector } from "@/doc/vector-shapes";
import { canvasIsDark } from "./chrome";
import { deepestFrame, hitPath } from "./hit-test";
import type { VectorOverlay } from "./vector-overlay";

/*
 * The pencil (⇧P): freehand strokes fitted to smooth Béziers on release. Samples come from
 * coalesced pointer events; the live stroke is an overlay polyline, so nothing is written until the
 * stroke ends (one undo step). ⇧ draws a straight line. The tool stays on for the next stroke.
 */

export interface PencilInput {
  screen: Pt;
  world: Pt;
  button: number;
  shift: boolean;
  samples?: Pt[];
}

/** Pencil strokes: 2 px in the icon colour (light on a dark backdrop), round ends and joins. */
export const PENCIL_WIDTH = 2;

interface Stroke {
  parentId: string | null;
  parentInv: Mat;
  pts: Pt[];
  /** The stroke's paint, picked at pen-down so the live line already shows in it. */
  ink: Paint;
}

export class PencilSession {
  private stroke: Stroke | null = null;
  private shift = false;
  /** The last stroke drawn (Esc selects it). */
  lastId: string | null = null;

  constructor(private camera: () => Camera) {}

  get active() {
    return this.stroke !== null;
  }

  down(p: PencilInput) {
    if (p.button !== 0) return;
    const doc = studio().doc;
    const parentId = deepestFrame(doc, hitPath(doc, p.world));
    const ts = parentId ? tokensForNode(doc, parentId) : activeTokens();
    this.shift = p.shift;
    this.stroke = { parentId, parentInv: invert(parentId ? worldMatrix(doc, parentId) : IDENTITY), pts: [p.world], ink: defaultInk(doc, parentId, canvasIsDark(), ts) };
  }

  move(p: PencilInput) {
    const s = this.stroke;
    if (!s) return;
    this.shift = p.shift;
    // Keep samples at least a screen pixel apart.
    const min = 1 / this.camera().zoom;
    for (const q of p.samples?.length ? p.samples : [p.world]) {
      const last = s.pts[s.pts.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) >= min) s.pts.push(q);
    }
  }

  setShift(on: boolean) {
    this.shift = on;
  }

  up(p: PencilInput) {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(p.world.x - last.x, p.world.y - last.y) > 1e-6) s.pts.push(p.world);
    const local = s.pts.map((q) => apply(s.parentInv, q));
    const v = pencilToVector(local, { zoom: this.camera().zoom, straight: p.shift || this.shift });
    if (!v) return;
    const doc = studio().doc;
    const parent = s.parentId && doc.nodes[s.parentId] ? s.parentId : null;
    const ts = parent ? tokensForNode(doc, parent) : activeTokens();
    const node = makeVector({ ends: { start: "round", end: "round" }, join: "round" }, ts, s.ink);
    node.stroke!.width = PENCIL_WIDTH;
    normalizeVectorNode(node, v);
    if (hasAutoLayout(parent ? doc.nodes[parent] : null)) node.absolute = true;
    // Sketching keeps the selection where it was (no Design panel flicker per stroke).
    insertNodes([node], parent, undefined, false);
    this.lastId = node.id;
  }

  cancel() {
    this.stroke = null;
  }

  /** Esc: the last stroke gets selected and the Move tool comes back. */
  keyDown(e: KeyboardEvent): boolean {
    if (e.key === "Shift") {
      this.shift = true;
      return false;
    }
    if (e.key !== "Escape") return false;
    if (this.stroke) {
      this.cancel();
      return true;
    }
    const s = studio();
    if (this.lastId && s.doc.nodes[this.lastId]) s.select([this.lastId]);
    s.setTool("select");
    this.lastId = null;
    return true;
  }

  keyUp(e: KeyboardEvent) {
    if (e.key === "Shift") this.shift = false;
  }

  overlay(): VectorOverlay | null {
    const s = this.stroke;
    if (!s) return null;
    const cam = this.camera();
    const toScreen = (w: Pt): Pt => ({ x: (w.x - cam.x) * cam.zoom, y: (w.y - cam.y) * cam.zoom });
    const pts = this.shift && s.pts.length > 1 ? [s.pts[0], s.pts[s.pts.length - 1]] : s.pts;
    return { handles: [], anchors: [], pencil: { pts: pts.map(toScreen), width: PENCIL_WIDTH * cam.zoom, color: s.ink.color } };
  }
}
