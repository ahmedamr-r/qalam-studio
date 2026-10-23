import type { Canvas, CanvasKit, Paint, Path } from "canvaskit-wasm";
import type { Box, Pt } from "@/doc/geometry";
import { reducedMotion } from "@/ui/motion";
import { hexToColor } from "./canvaskit";

/**
 * What the vector tools draw over the canvas, already in screen space (CSS px; the renderer has
 * applied the device pixel ratio). VectorTools.overlay() builds it, so the painter does no geometry.
 */
export interface VectorOverlay {
  /** Path data of the edited vector (all subpaths). */
  skeleton?: string;
  /** A hovered or selected segment (bend, add point, segment select). */
  highlight?: string;
  /** Pen rubber band from the last anchor to the cursor. */
  preview?: string;
  /** `grow`: 0–1 hover tween of the knob. */
  handles: { a: Pt; b: Pt; selected: boolean; hover: boolean; grow?: number }[];
  /** `born`: performance.now() when the anchor was placed (pops in). `grow`: 0–1 hover tween. */
  anchors: { p: Pt; selected: boolean; hover: boolean; first?: boolean; born?: number; grow?: number }[];
  /** The next anchor at the cursor (hollow). */
  ghost?: Pt;
  /** Where a click adds an anchor on the hovered segment (filled dot). */
  addPoint?: Pt;
  /** Hovering the start point while drawing: closes the path. `t`: 0–1 appear tween. */
  closeRing?: Pt & { t?: number };
  marquee?: Box;
  /** A live freehand stroke. */
  pencil?: { pts: Pt[]; width: number; color: string };
  /** End knobs of a selected line or arrow (outside edit mode). */
  lineEnds?: { p: Pt; hover: boolean }[];
}

export interface OverlayPalette {
  accent: string;
  knob: string;
}

/** Durations (ms) of the overlay's micro-interactions; all 0 under reduced motion. */
export const OVERLAY_MOTION = { pop: 90, hover: 80, ring: 120, stagger: 8, staggerCap: 96 };

const FULL_MOTION = { ...OVERLAY_MOTION };
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  // reducedMotion() honours the in-app data-motion override before the OS setting.
  const apply = () => Object.assign(OVERLAY_MOTION, reducedMotion() ? { pop: 0, hover: 0, ring: 0, stagger: 0, staggerCap: 0 } : FULL_MOTION);
  apply();
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", apply);
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
}

const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/** CanvasKit painter for the vector overlay. Owns its paints. */
export class VectorPainter {
  private fill: Paint;
  private stroke: Paint;

  constructor(private ck: CanvasKit) {
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setStyle(ck.PaintStyle.Fill);
    this.stroke = new ck.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(ck.PaintStyle.Stroke);
  }

  private color(hex: string, alpha = 1) {
    return hexToColor(this.ck, hex, alpha);
  }

  private path(canvas: Canvas, d: string, width: number, color: Float32Array) {
    const p: Path | null = this.ck.Path.MakeFromSVGString(d);
    if (!p) return;
    this.stroke.setColor(color);
    this.stroke.setStrokeWidth(width);
    canvas.drawPath(p, this.stroke);
    p.delete();
  }

  private knob(canvas: Canvas, p: Pt, r: number, fill: Float32Array, ring: Float32Array, ringW: number) {
    this.fill.setColor(fill);
    canvas.drawCircle(p.x, p.y, r, this.fill);
    this.stroke.setColor(ring);
    this.stroke.setStrokeWidth(ringW);
    canvas.drawCircle(p.x, p.y, r, this.stroke);
  }

  draw(canvas: Canvas, o: VectorOverlay, pal: OverlayPalette, now = performance.now()) {
    const ck = this.ck;
    const accent = this.color(pal.accent),
      knob = this.color(pal.knob);
    this.stroke.setStrokeCap(ck.StrokeCap.Butt);
    this.stroke.setStrokeJoin(ck.StrokeJoin.Miter);

    if (o.pencil && o.pencil.pts.length > 1) {
      const b = new ck.PathBuilder();
      b.moveTo(o.pencil.pts[0].x, o.pencil.pts[0].y);
      for (const q of o.pencil.pts.slice(1)) b.lineTo(q.x, q.y);
      const p = b.detachAndDelete();
      this.stroke.setColor(this.color(o.pencil.color));
      this.stroke.setStrokeWidth(o.pencil.width);
      this.stroke.setStrokeCap(ck.StrokeCap.Round);
      this.stroke.setStrokeJoin(ck.StrokeJoin.Round);
      canvas.drawPath(p, this.stroke);
      p.delete();
      this.stroke.setStrokeCap(ck.StrokeCap.Butt);
      this.stroke.setStrokeJoin(ck.StrokeJoin.Miter);
    }

    if (o.skeleton) this.path(canvas, o.skeleton, 1, accent);
    if (o.highlight) this.path(canvas, o.highlight, 2, accent);

    for (const h of o.handles) {
      this.stroke.setColor(this.color(pal.accent, h.selected || h.hover ? 1 : 0.8));
      this.stroke.setStrokeWidth(1);
      canvas.drawLine(h.a.x, h.a.y, h.b.x, h.b.y, this.stroke);
    }
    if (o.preview) this.path(canvas, o.preview, 1, accent);
    for (const h of o.handles) {
      const grow = h.grow ?? (h.hover ? 1 : 0);
      this.knob(canvas, h.b, 2.75 + 0.75 * grow, h.selected ? accent : knob, h.selected ? knob : accent, 1);
    }

    for (const a of o.anchors) {
      const pop = a.born === undefined || !OVERLAY_MOTION.pop ? 1 : easeOut((now - a.born) / OVERLAY_MOTION.pop);
      const grow = a.grow ?? (a.hover ? 1 : 0);
      const r = (3.5 + grow) * pop;
      if (r <= 0) continue;
      if (a.selected) this.knob(canvas, a.p, r, accent, knob, 1.5);
      else this.knob(canvas, a.p, r, knob, accent, 1 + 0.5 * grow);
    }

    for (const e of o.lineEnds ?? []) this.knob(canvas, e.p, e.hover ? 5 : 4, knob, accent, 1);

    if (o.closeRing) {
      const t = easeOut(o.closeRing.t ?? 1);
      const r = 7 * (0.6 + 0.4 * t);
      this.fill.setColor(this.color(pal.accent, 0.2 * t));
      canvas.drawCircle(o.closeRing.x, o.closeRing.y, r, this.fill);
      this.stroke.setColor(this.color(pal.accent, t));
      this.stroke.setStrokeWidth(1.5);
      canvas.drawCircle(o.closeRing.x, o.closeRing.y, r, this.stroke);
    }
    if (o.ghost) {
      this.stroke.setColor(this.color(pal.accent, 0.6));
      this.stroke.setStrokeWidth(1);
      canvas.drawCircle(o.ghost.x, o.ghost.y, 3.5, this.stroke);
    }
    if (o.addPoint) {
      this.fill.setColor(accent);
      canvas.drawCircle(o.addPoint.x, o.addPoint.y, 3, this.fill);
    }

    if (o.marquee) {
      const m = o.marquee;
      const r = ck.XYWHRect(m.x, m.y, m.w, m.h);
      this.fill.setColor(this.color(pal.accent, 0.1));
      canvas.drawRect(r, this.fill);
      this.stroke.setColor(accent);
      this.stroke.setStrokeWidth(1);
      canvas.drawRect(r, this.stroke);
    }
  }

  dispose() {
    this.fill.delete();
    this.stroke.delete();
  }
}
