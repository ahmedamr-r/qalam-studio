import type { Canvas, CanvasKit, Paint } from "canvaskit-wasm";
import type { Doc } from "@/doc/schema";
import type { Box, Pt } from "@/doc/geometry";
import type { Camera } from "@/doc/store";
import { routeGeometry, type Wire } from "@/proto/canvas/layout";
import { CARD_GAP, stateCards } from "@/proto/canvas/cards";
import type { ChromeKey } from "./chrome";
import { hexToColor } from "./canvaskit";

/*
 * Painting routes on the canvas (CanvasKit): behind the screens, a quiet container around a
 * screen and the parts it opens or shows (its sheets, dialogs, bars), and the cards of its
 * components' other states on the screen's background (the renderer draws the components); over
 * everything, the wires from what's tapped to what it opens, each with its trigger on a chip
 * (Figma's prototype connections, in the same blue), dashed ones from a component to its cards
 * under their captions, and a dashed fold where a phone screen's first view ends. The wires of the
 * route you're on are drawn strong, the others faint. Hidden with View ▸ Prototype parts, which
 * also takes the parts off the canvas (controller.ts covers them).
 */

/** What the renderer lends the painter: its colours, its chips and its camera maths. */
export interface RouteKit {
  color: (key: ChromeKey, alpha?: number) => Float32Array;
  pill: (canvas: Canvas, text: string, at: { cx: number; cy: number }, bg: Float32Array, h?: number, padX?: number, radius?: number) => Box;
  toScreen: (cam: Camera, p: Pt) => Pt;
  /** A caption over a box's top-left corner (screen space), like a frame's name. */
  label: (canvas: Canvas, text: string, tl: Pt, maxWidth: number, strong: boolean) => void;
  dpr: number;
}

export interface RouteFrame {
  doc: Doc;
  camera: Camera;
  selection: string[];
  hoverId: string | null;
}

export class RoutePainter {
  private fill: Paint;
  private stroke: Paint;

  constructor(private ck: CanvasKit) {
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
    this.stroke = new ck.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(ck.PaintStyle.Stroke);
  }

  dispose() {
    this.fill.delete();
    this.stroke.delete();
  }

  /** The routes the selection or hover is in (their screen or one of their parts). */
  private focused(f: RouteFrame): Set<string> {
    const ids = new Set([...f.selection, ...(f.hoverId ? [f.hoverId] : [])]);
    const out = new Set<string>();
    if (!ids.size) return out;
    for (const g of routeGeometry(f.doc)) {
      const r = f.doc.proto?.routes?.[g.screen];
      const frames = [g.screen, ...Object.values(r?.overlays ?? {}).map((o) => o.frame), ...Object.values(r?.addOns ?? {}).map((a) => a.frame)];
      if (frames.some((id) => ids.has(id) || [...ids].some((s) => isInside(f.doc, s, id)))) out.add(g.screen);
    }
    return out;
  }

  /** World space, before the screens are drawn. */
  drawContainers(canvas: Canvas, doc: Doc, zoom: number, kit: RouteKit) {
    for (const g of routeGeometry(doc)) {
      if (!g.container) continue;
      const b = g.container;
      const r = 24;
      const rr = this.ck.RRectXY(this.ck.XYWHRect(b.x, b.y, b.w, b.h), r, r);
      this.fill.setColor(kit.color("canvasLabel", 0.06));
      canvas.drawRRect(rr, this.fill);
      this.stroke.setColor(kit.color("canvasLabel", 0.22));
      this.stroke.setStrokeWidth(1 / zoom);
      canvas.drawRRect(rr, this.stroke);
    }
    // State cards: the screen's background under the component, a dashed edge (a preview, not a frame).
    const dash = this.ck.PathEffect.MakeDash([4 / zoom, 3 / zoom], 0);
    for (const c of stateCards(doc)) {
      const b = c.box;
      const rr = this.ck.RRectXY(this.ck.XYWHRect(b.x, b.y, b.w, b.h), 12, 12);
      this.fill.setColor(c.bg ? hexToColor(this.ck, c.bg) : kit.color("canvas"));
      canvas.drawRRect(rr, this.fill);
      this.stroke.setPathEffect(dash);
      this.stroke.setColor(kit.color("canvasLabel", 0.45));
      this.stroke.setStrokeWidth(1 / zoom);
      canvas.drawRRect(rr, this.stroke);
      this.stroke.setPathEffect(null);
    }
    dash.delete();
    // Pages not designed yet: an outline where the screen will be, in the wires' blue.
    const long = this.ck.PathEffect.MakeDash([6 / zoom, 4 / zoom], 0);
    for (const g of routeGeometry(doc))
      for (const p of g.pages) {
        const b = p.box;
        const rr = this.ck.RRectXY(this.ck.XYWHRect(b.x, b.y, b.w, b.h), 16, 16);
        this.fill.setColor(kit.color("canvas"));
        canvas.drawRRect(rr, this.fill);
        this.stroke.setPathEffect(long);
        this.stroke.setColor(kit.color("selection", 0.6));
        this.stroke.setStrokeWidth(1.5 / zoom);
        canvas.drawRRect(rr, this.stroke);
        this.stroke.setPathEffect(null);
      }
    long.delete();
  }

  /** Screen space, over everything: wires with their chips, and folds. */
  drawWires(canvas: Canvas, f: RouteFrame, kit: RouteKit) {
    const cam = f.camera;
    const on = this.focused(f);
    for (const g of routeGeometry(f.doc)) {
      const strong = on.has(g.screen);
      if (g.fold) this.drawFold(canvas, g.fold, cam, kit, strong);
      // A component's wires to its cards only while you're on the route: their captions say what they are.
      for (const w of g.wires) if (w.kind !== "state" || strong) this.drawWire(canvas, w, cam, kit, strong || on.size === 0);
    }
    // Each card's caption: the state it shows (it may run on into the gap after the card).
    for (const c of stateCards(f.doc)) {
      const room = c.box.w * cam.zoom;
      if (room >= 40) kit.label(canvas, c.label, kit.toScreen(cam, { x: c.box.x, y: c.box.y }), (c.box.w + CARD_GAP - 8) * cam.zoom, on.has(c.screen));
    }
    // Each page's caption: its name, and that it isn't designed yet.
    for (const g of routeGeometry(f.doc))
      for (const p of g.pages) if (p.box.w * cam.zoom >= 40) kit.label(canvas, `${p.name} · not designed yet`, kit.toScreen(cam, { x: p.box.x, y: p.box.y }), (p.box.w + CARD_GAP - 8) * cam.zoom, on.has(g.screen));
  }

  private drawFold(canvas: Canvas, fold: { y: number; x0: number; x1: number }, cam: Camera, kit: RouteKit, strong: boolean) {
    const a = kit.toScreen(cam, { x: fold.x0, y: fold.y });
    const b = kit.toScreen(cam, { x: fold.x1, y: fold.y });
    if (b.x - a.x < 40) return;
    const dash = this.ck.PathEffect.MakeDash([4, 4], 0);
    this.stroke.setPathEffect(dash);
    this.stroke.setColor(kit.color("selection", strong ? 0.7 : 0.35));
    this.stroke.setStrokeWidth(1);
    const y = Math.round(a.y * kit.dpr) / kit.dpr + 0.5;
    canvas.drawLine(a.x, y, b.x, y, this.stroke);
    this.stroke.setPathEffect(null);
    dash.delete();
    if (strong && b.x - a.x > 120) kit.pill(canvas, "Fold", { cx: b.x - 20, cy: y }, kit.color("selection"), 16, 5, 3);
  }

  private drawWire(canvas: Canvas, w: Wire, cam: Camera, kit: RouteKit, strong: boolean) {
    const [start, c1, c2, end, heading] = wirePath(w, cam, kit);
    // A component's other state is quieter than what a tap does: dashed, lighter, no chip (its card has the caption).
    const state = w.kind === "state";
    const color = kit.color("selection", (strong ? 1 : 0.4) * (state ? 0.6 : 1));
    // To a page not designed yet: dashed, like the card it lands on.
    const p = new this.ck.PathBuilder();
    p.moveTo(start.x, start.y);
    p.cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    const path = p.detachAndDelete();
    const dash = state || w.kind === "next" ? this.ck.PathEffect.MakeDash([5, 4], 0) : null;
    this.stroke.setPathEffect(dash);
    this.stroke.setColor(color);
    this.stroke.setStrokeWidth(1.5);
    canvas.drawPath(path, this.stroke);
    this.stroke.setPathEffect(null);
    dash?.delete();
    path.delete();
    // Where it starts: a dot on the tapped layer; where it lands: an arrowhead.
    this.fill.setColor(color);
    canvas.drawCircle(start.x, start.y, 3, this.fill);
    const s = 6;
    const [dx, dy] = heading;
    const head = new this.ck.PathBuilder();
    head.moveTo(end.x, end.y);
    head.lineTo(end.x - dx * s - dy * s * 0.6, end.y - dy * s + dx * s * 0.6);
    head.lineTo(end.x - dx * s + dy * s * 0.6, end.y - dy * s - dx * s * 0.6);
    const hp = head.detachAndDelete();
    canvas.drawPath(hp, this.fill);
    hp.delete();
    if (strong && !state) {
      const mid = bezierAt(start, c1, c2, end, 0.5);
      kit.pill(canvas, w.label, { cx: mid.x, cy: mid.y }, color, 18, 6, 9);
    }
  }
}

/** Is `id` inside the frame `root` (or the frame itself)? */
function isInside(doc: Doc, id: string, root: string): boolean {
  let n = doc.nodes[id];
  while (n) {
    if (n.id === root) return true;
    n = n.parentId ? doc.nodes[n.parentId] : (undefined as never);
  }
  return false;
}

/**
 * A wire's curve in screen space: out of the tapped layer's side that faces the target, into the
 * target's top when it's below (a sheet under its screen), else into its near side. Returns the
 * start, the two control points, the end and the direction it arrives in.
 */
export function wirePath(w: Wire, cam: Camera, kit: Pick<RouteKit, "toScreen">): [Pt, Pt, Pt, Pt, [number, number]] {
  const s = (p: Pt) => kit.toScreen(cam, p);
  const f = w.from;
  const t = w.to;
  const right = t.x >= f.x + f.w;
  const left = t.x + t.w <= f.x;
  const below = t.y >= f.y + f.h;
  const start = s(right || !left ? { x: f.x + f.w, y: f.y + f.h / 2 } : { x: f.x, y: f.y + f.h / 2 });
  const out = right || !left ? 1 : -1;
  if (below && !right) {
    const end = s({ x: Math.min(Math.max(f.x + f.w + 24, t.x + 24), t.x + t.w - 24), y: t.y });
    const reach = Math.max(40, Math.abs(end.y - start.y) / 2);
    // Out of the screen it starts in before it turns down, so it doesn't run along the screen's edge over its layers.
    const edge = w.around ? s({ x: w.around.x + w.around.w, y: 0 }).x + 48 : start.x + out * Math.max(40, Math.abs(end.x - start.x) / 2);
    return [start, { x: Math.max(edge, start.x + 40), y: start.y }, { x: Math.max(edge, end.x), y: end.y - reach }, end, [0, 1]];
  }
  const end = s(right ? { x: t.x, y: t.y + Math.min(t.h / 2, 80) } : left ? { x: t.x + t.w, y: t.y + Math.min(t.h / 2, 80) } : { x: t.x + t.w / 2, y: t.y + t.h });
  const reach = Math.max(40, Math.abs(end.x - start.x) / 2);
  return [start, { x: start.x + out * reach, y: start.y }, { x: end.x - out * reach, y: end.y }, end, [out, 0]];
}

const bezierAt = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
};
