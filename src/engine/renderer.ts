import type { Canvas, CanvasKit, Image as CkImage, MaskFilter, Paint, Paragraph, Path, PathEffect, Surface } from "canvaskit-wasm";
import type { Doc, Effect, FrameNode, Gradient, PathNode, SceneNode, TextNode } from "@/doc/schema";
import type { Camera, ViewOptions } from "@/doc/store";
import { type Box, type Mat, type Pt, apply, localMatrix, worldCorners, worldBounds, worldMatrix, boxesIntersect, selectionBounds, mul, translate, parentWorldMatrix } from "@/doc/geometry";
import { type CardNode, isOstCard, isSealed, rootBounds, treeBounds } from "@/doc/board";
import { OstPainter, type OstRenderInput } from "./ost-painter";
import { RoutePainter, type RouteKit } from "./route-painter";
import { cardDoc } from "@/proto/canvas/cards";
import { isOnPage } from "@/doc/pages";
import { getEngine, hexToColor } from "./canvaskit";
import { buildParagraph } from "./text";
import { iconDrawing, onIconSetLoaded } from "@/design-system/icons";
import { sourceBytes } from "@/doc/assets";
import { fillD, isEditableVector, scaleVector, vectorOf, vectorScale, vectorToD } from "@/doc/vector";
import { strokeEnds, strokeOverhang } from "@/doc/vector-shapes";
import { maskOf } from "@/doc/mask";
import { gridBands, gridLines } from "@/doc/grids";
import { type VectorOverlay, VectorPainter } from "./vector-overlay";
import { type ChromeKey, type ChromeTheme, DEFAULT_CHROME, crisp, formatChromeNumber } from "./chrome";
import type { MeasureLine } from "./measure";
import type { Spacing } from "./snapping";
import { RULER_SIZE, rulerTicks } from "./rulers";

/**
 * Content placeholders (a missing icon, a picture still loading) are part of the design, not the
 * chrome: they stay neutral in both themes, so exports never pick up a theme colour.
 */
const PLACEHOLDER = { missing: "#9A9A9A", image: "#DEDEDE" };

/** The chrome font: CanvasKit has the static Inter files (400–700); 500 stands in for 510. */
const CHROME_FONT = "Inter";

/** Pixel grid: drawn from 400 % zoom (Figma), fading in until 800 %. */
export const PIXEL_GRID_ZOOM = 4;

/** Is this a straight line (Figma's LINE: no height), shown with two end knobs instead of a box? */
export const isLineNode = (n: SceneNode | undefined): n is PathNode => n?.type === "path" && (n.shape?.kind === "line" || (n.vh === 0 && n.h === 0 && n.w > 0));

export interface Guide {
  axis: "x" | "y";
  /** world coordinate of the line */
  at: number;
  from: number;
  to: number;
}

/** An auto-layout drag: the dragged layers dim in their slot while a ghost follows the cursor. */
export interface FlowDrag {
  dimmed: Set<string>;
  /** Layers drawn again under `m` (their parent's world matrix, offset by the drag). */
  ghosts: { id: string; m: Mat }[];
  /** Insertion line in world space. */
  line: [Pt, Pt] | null;
  /** Auto-layout frame the layers would drop into, outlined. */
  target: string | null;
}

export interface RenderInput {
  doc: Doc;
  camera: Camera;
  selection: string[];
  hoverId: string | null;
  editingTextId: string | null;
  marquee: Box | null;
  guides: Guide[];
  showFlags: boolean;
  hideHandles: boolean;
  flow?: FlowDrag | null;
  /** Screens the AI is still building (src/doc/ghosts.ts), drawn above the document. */
  aiGhosts?: Doc[];
  /** Screens a ghost stands in for while they're rebuilt: not drawn. */
  coveredRoots?: Set<string>;
  /** Pen, vector edit mode and shape tools (screen space, see vector-overlay.ts). */
  vector?: VectorOverlay | null;
  /** View menu flags (rulers, outlines, grids…); absent = all off, as in exports. */
  view?: Partial<Pick<ViewOptions, "rulers" | "outlines" | "pixelGrid" | "pixelPreview" | "layoutGrids" | "routeParts">>;
  /** Distances labelled while snapping (world). */
  spacings?: Spacing[];
  /** ⌥ measure: from the selection's box to a layer's box, with the distances between (world). */
  measure?: { source: Box; target: Box; lines: MeasureLine[]; extensions: [Pt, Pt][] } | null;
  /** A rotate drag: the angle so far, shown by the pointer (screen). */
  rotating?: { angle: number; at: Pt } | null;
  /** The resize handle or line end under the pointer. */
  hoverHandle?: HandleKind | LineEnd | null;
  /** Where the rulers count from (world): the frame around the selection, else the canvas origin. */
  rulerOrigin?: Pt;
  /** Discovery boards: cards being dragged, the drop target, the card being typed into (see ost-painter.ts). */
  ost?: OstRenderInput | null;
  /** An export (PNG, thumbnail): board cards take the light palette whatever the theme. */
  exporting?: boolean;
}

export const HANDLE_SIZE = 8;

/** A line's ends: the start (its local x = 0) and the end. */
export type LineEnd = "p0" | "p1";

/** A frame name label as last drawn (screen px), for hit testing. */
export interface LabelRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const toCk = (m: Mat) => [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];

export class Renderer {
  readonly ck: CanvasKit;
  private el: HTMLCanvasElement;
  private surface: Surface | null = null;
  private dpr = 1;
  width = 0;
  height = 0;
  private raf = 0;
  private pending: RenderInput | null = null;

  private fill: Paint;
  private stroke: Paint;
  private shadow: Paint;
  private paraCache = new Map<string, { key: string; p: Paragraph }>();
  private iconCache = new Map<string, { stroke: Path | null; fill: Path | null } | null>();
  /** Path nodes' drawables in node px, by data, size and stroke ends (see drawVector). */
  private vectorPlans = new Map<string, VectorDrawable>();
  private vectorPainter: VectorPainter;
  /** Discovery's tree cards (painted from their data). */
  private ost: OstPainter;
  /** Routes: containers, wires and folds (route-painter.ts). */
  private routes: RoutePainter;
  private offIcons: () => void;
  private imageCache = new Map<string, CkImage | "loading" | "error">();
  private blurCache = new Map<number, MaskFilter>();
  onImageLoaded: (() => void) | null = null;
  /** Chrome colours for the current theme (see chrome.ts), as hex and as CanvasKit colours. */
  private theme: ChromeTheme = DEFAULT_CHROME;
  private colors = new Map<ChromeKey, Float32Array>();
  /** Chrome text (labels, badges, pills) by text, colour and style; laid out to the width last asked for. */
  private chromeCache = new Map<string, { p: Paragraph; width: number }>();
  /** Frame labels as drawn last frame. */
  labelRects: LabelRect[] = [];
  /** Pixel preview's 1× scene surface, kept while the viewport size stays the same. */
  private previewSurface: { s: Surface; w: number; h: number } | null = null;

  constructor(el: HTMLCanvasElement) {
    this.ck = getEngine().ck;
    this.el = el;
    const ck = this.ck;
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setStyle(ck.PaintStyle.Fill);
    this.stroke = new ck.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(ck.PaintStyle.Stroke);
    this.shadow = new ck.Paint();
    this.shadow.setAntiAlias(true);
    this.vectorPainter = new VectorPainter(ck);
    this.ost = new OstPainter(ck);
    this.routes = new RoutePainter(ck);
    // An icon set finished loading: drop what was cached without it and draw again.
    this.offIcons = onIconSetLoaded(() => {
      this.clearIcons();
      this.onImageLoaded?.();
    });
  }

  /** Switch the chrome palette (on load and on every theme change). Labels bake their colour in. */
  setTheme(t: ChromeTheme) {
    this.theme = t;
    this.colors.clear();
    this.clearChromeText();
  }

  get chromeTheme(): ChromeTheme {
    return this.theme;
  }

  /** A chrome colour as a CanvasKit colour (cached until the theme changes), optionally faded. */
  private c(key: ChromeKey, alpha = 1): Float32Array {
    if (alpha !== 1) return hexToColor(this.ck, this.theme[key], alpha);
    let v = this.colors.get(key);
    if (!v) {
      v = hexToColor(this.ck, this.theme[key]);
      this.colors.set(key, v);
    }
    return v;
  }

  private clearChromeText() {
    for (const { p } of this.chromeCache.values()) p.delete();
    this.chromeCache.clear();
  }

  private clearIcons() {
    for (const p of this.iconCache.values()) {
      p?.stroke?.delete();
      p?.fill?.delete();
    }
    this.iconCache.clear();
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr;
    this.width = cssW;
    this.height = cssH;
    this.el.width = Math.max(1, Math.round(cssW * dpr));
    this.el.height = Math.max(1, Math.round(cssH * dpr));
    this.surface?.delete();
    this.surface = this.ck.MakeWebGLCanvasSurface(this.el);
  }

  schedule(input: RenderInput) {
    this.pending = input;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.pending) this.draw(this.pending);
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const { p } of this.paraCache.values()) p.delete();
    this.clearChromeText();
    this.previewSurface?.s.delete();
    this.previewSurface = null;
    this.offIcons();
    this.clearIcons();
    this.clearVectorPlans();
    this.vectorPainter.dispose();
    this.ost.dispose();
    this.routes.dispose();
    for (const i of this.imageCache.values()) if (typeof i === "object") i.delete();
    for (const m of this.blurCache.values()) m.delete();
    this.fill.delete();
    this.stroke.delete();
    this.shadow.delete();
    this.surface?.delete();
    this.surface = null;
  }

  // ---------------------------------------------------------------------------

  draw(input: RenderInput) {
    const surface = this.surface;
    if (!surface) return;
    const canvas = surface.getCanvas();
    const ck = this.ck;
    const { camera: cam, doc } = input;
    canvas.clear(this.c("canvas"));

    const view: Box = { x: cam.x, y: cam.y, w: this.width / cam.zoom, h: this.height / cam.zoom };
    // ⌃P: the design at 1× (its real pixels), scaled up without smoothing.
    if (input.view?.pixelPreview && cam.zoom > 1 && !input.view.outlines) this.drawPixelPreview(canvas, input, view);
    else {
      canvas.save();
      canvas.scale(this.dpr * cam.zoom, this.dpr * cam.zoom);
      canvas.translate(-cam.x, -cam.y);
      this.drawScene(canvas, input, view);
      canvas.restore();
    }

    canvas.save();
    canvas.scale(this.dpr, this.dpr);
    if (input.view?.pixelGrid && cam.zoom >= PIXEL_GRID_ZOOM) this.drawPixelGrid(canvas, cam);
    this.drawOverlay(canvas, input);
    if (input.view?.rulers) this.drawRulers(canvas, input);
    canvas.restore();
    surface.flush();
    this.gcParagraphs(doc, input.view?.routeParts ? [...(input.aiGhosts ?? []), cardDoc(doc)] : input.aiGhosts);
  }

  /** Everything in the document (and the AI's screens in progress), in world space. */
  private drawScene(canvas: Canvas, input: RenderInput, view: Box) {
    const { doc } = input;
    this.ost.begin({ doc, selection: input.selection, hoverId: input.hoverId, zoom: input.camera.zoom, ost: input.ost, exporting: input.exporting }, this.theme.dark);
    if (input.view?.routeParts) this.routes.drawContainers(canvas, doc, input.camera.zoom, this.routeKit);
    // A Discovery tree's root box isn't what it covers: cull by its cards (rootBounds).
    for (const id of doc.roots) {
      if (!doc.nodes[id] || input.coveredRoots?.has(id)) continue;
      if (!boxesIntersect(rootBounds(doc, id), view)) continue;
      this.drawNode(canvas, doc, id, input);
    }
    // Routes' state cards: their components, on the cards the route painter drew.
    const cards = input.view?.routeParts ? cardDoc(doc) : null;
    for (const id of cards?.roots ?? []) if (boxesIntersect(rootBounds(cards!, id), view)) this.drawNode(canvas, cards!, id, input);
    for (const g of input.aiGhosts ?? []) {
      for (const id of g.roots) if (g.nodes[id] && boxesIntersect(rootBounds(g, id), view)) this.drawNode(canvas, g, id, input);
    }
    // Tree cards being dragged: drawn again under the pointer (their own places stay, faded).
    const drag = input.ost?.drag;
    if (drag && (drag.dx || drag.dy)) {
      const still = { ...input, ost: { ...input.ost!, drag: null } };
      for (const id of drag.ids) {
        if (!doc.nodes[id]) continue;
        canvas.save();
        canvas.concat(toCk(mul(translate(drag.dx, drag.dy), parentWorldMatrix(doc, id))));
        this.drawNode(canvas, doc, id, still);
        canvas.restore();
      }
    }
    if (input.flow?.ghosts.length) {
      const plain = { ...input, flow: null };
      for (const g of input.flow.ghosts) {
        canvas.save();
        canvas.concat(toCk(g.m));
        this.drawNode(canvas, doc, g.id, plain);
        canvas.restore();
      }
    }
  }

  /** Pixel preview: draw the scene into a 1× raster the size of the view, then blow it up (nearest). */
  private drawPixelPreview(canvas: Canvas, input: RenderInput, view: Box) {
    const ck = this.ck;
    const cam = input.camera;
    const ox = Math.floor(view.x), oy = Math.floor(view.y);
    const w = Math.ceil(view.x + view.w) - ox + 1, h = Math.ceil(view.y + view.h) - oy + 1;
    let ps = this.previewSurface;
    if (!ps || ps.w !== w || ps.h !== h) {
      ps?.s.delete();
      const s = ck.MakeSurface(w, h);
      ps = this.previewSurface = s ? { s, w, h } : null;
    }
    if (!ps) return;
    const off = ps.s.getCanvas();
    off.clear(ck.TRANSPARENT);
    off.save();
    off.translate(-ox, -oy);
    this.drawScene(off, input, view);
    off.restore();
    ps.s.flush();
    const img = ps.s.makeImageSnapshot();
    canvas.save();
    canvas.scale(this.dpr * cam.zoom, this.dpr * cam.zoom);
    canvas.translate(ox - cam.x, oy - cam.y);
    canvas.drawImageOptions(img, 0, 0, ck.FilterMode.Nearest, ck.MipmapMode.None, null);
    canvas.restore();
    img.delete();
  }

  /** Hairlines on every whole world pixel, from 400 % zoom (⌘'). Screen space. */
  private drawPixelGrid(canvas: Canvas, cam: Camera) {
    const z = cam.zoom;
    const alpha = Math.min(1, 0.45 + ((z - PIXEL_GRID_ZOOM) / PIXEL_GRID_ZOOM) * 0.55);
    const b = new this.ck.PathBuilder();
    const x0 = Math.ceil(cam.x), x1 = Math.floor(cam.x + this.width / z);
    const y0 = Math.ceil(cam.y), y1 = Math.floor(cam.y + this.height / z);
    if (x1 - x0 > 2000 || y1 - y0 > 2000) return b.delete();
    for (let x = x0; x <= x1; x++) {
      const sx = crisp((x - cam.x) * z, this.dpr, 1 / this.dpr);
      b.moveTo(sx, 0);
      b.lineTo(sx, this.height);
    }
    for (let y = y0; y <= y1; y++) {
      const sy = crisp((y - cam.y) * z, this.dpr, 1 / this.dpr);
      b.moveTo(0, sy);
      b.lineTo(this.width, sy);
    }
    const path = b.detachAndDelete();
    this.stroke.setColor(this.c("pixelGrid", alpha));
    this.stroke.setStrokeWidth(0);
    canvas.drawPath(path, this.stroke);
    path.delete();
    this.stroke.setStrokeWidth(1);
  }

  private rrectFor(n: SceneNode, inset = 0): number[] {
    const r = n.radius;
    const w = n.w, h = n.h;
    if (!r) return [inset, inset, w - inset, h - inset, 0, 0, 0, 0, 0, 0, 0, 0];
    const c = (v: number) => Math.max(0, v - inset);
    return [
      inset, inset, w - inset, h - inset,
      c(r.tl.rx), c(r.tl.ry), c(r.tr.rx), c(r.tr.ry), c(r.br.rx), c(r.br.ry), c(r.bl.rx), c(r.bl.ry),
    ];
  }

  /** Drop newly-registered fonts into play: paragraphs are rebuilt on the next draw. */
  invalidateText() {
    for (const { p } of this.paraCache.values()) p.delete();
    this.paraCache.clear();
  }

  private blur(radius: number): MaskFilter | null {
    const sigma = Math.round(radius * 4) / 8; // CSS blur radius ≈ 2σ
    if (sigma <= 0) return null;
    let m = this.blurCache.get(sigma);
    if (!m) {
      m = this.ck.MaskFilter.MakeBlur(this.ck.BlurStyle.Normal, sigma, true);
      this.blurCache.set(sigma, m);
    }
    return m;
  }

  /** Grow (or shrink, d < 0) a rounded rect; square corners stay square like CSS spread. */
  private inflate(rr: number[], d: number): number[] {
    const [l, t, r, b, ...radii] = rr;
    return [l - d, t - d, r + d, b + d, ...radii.map((v) => (v > 0 ? Math.max(0, v + d) : 0))];
  }

  private shapeRR(n: SceneNode, rr: number[]): number[] {
    return n.type === "ellipse" ? [0, 0, n.w, n.h, n.w / 2, n.h / 2, n.w / 2, n.h / 2, n.w / 2, n.h / 2, n.w / 2, n.h / 2] : rr;
  }

  private drawDropShadows(canvas: Canvas, n: SceneNode, rr: number[], effects: Effect[]) {
    const ck = this.ck;
    for (const e of effects) {
      if (e.kind !== "drop") continue;
      this.shadow.setColor(hexToColor(ck, e.color));
      this.shadow.setMaskFilter(this.blur(e.blur));
      canvas.save();
      canvas.translate(e.x, e.y);
      canvas.drawRRect(this.inflate(this.shapeRR(n, rr), e.spread), this.shadow);
      canvas.restore();
    }
    this.shadow.setMaskFilter(null);
  }

  /** Drop shadows of a vector's filled outline (a composed shape: a ticket's shadow follows its notches). */
  private drawVectorShadows(canvas: Canvas, n: PathNode, effects: Effect[]) {
    const fill = this.vectorDrawable(n).fill;
    if (!fill) return;
    const ck = this.ck;
    for (const e of effects) {
      if (e.kind !== "drop") continue;
      this.shadow.setColor(hexToColor(ck, e.color));
      this.shadow.setMaskFilter(this.blur(e.blur));
      canvas.save();
      canvas.translate(e.x, e.y);
      canvas.drawPath(fill, this.shadow);
      if (e.spread > 0) {
        // Spread grows the outline: its stroke, as wide as the spread on each side.
        this.shadow.setStyle(ck.PaintStyle.Stroke);
        this.shadow.setStrokeWidth(e.spread * 2);
        canvas.drawPath(fill, this.shadow);
        this.shadow.setStyle(ck.PaintStyle.Fill);
      }
      canvas.restore();
    }
    this.shadow.setMaskFilter(null);
  }

  private drawInnerShadows(canvas: Canvas, n: SceneNode, rr: number[], effects: Effect[]) {
    const ck = this.ck;
    const shape = this.shapeRR(n, rr);
    for (const e of effects) {
      if (e.kind !== "inner") continue;
      const pad = e.blur * 2 + Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread) + 4;
      const hole = this.inflate(shape, -e.spread);
      hole[0] += e.x;
      hole[2] += e.x;
      hole[1] += e.y;
      hole[3] += e.y;
      if (hole[2] <= hole[0] || hole[3] <= hole[1]) continue;
      const outer = [shape[0] - pad + Math.min(0, e.x), shape[1] - pad + Math.min(0, e.y), shape[2] + pad + Math.max(0, e.x), shape[3] + pad + Math.max(0, e.y), 0, 0, 0, 0, 0, 0, 0, 0];
      this.shadow.setColor(hexToColor(ck, e.color));
      this.shadow.setMaskFilter(this.blur(e.blur));
      canvas.save();
      canvas.clipRRect(shape, ck.ClipOp.Intersect, true);
      canvas.drawDRRect(outer, hole, this.shadow);
      canvas.restore();
    }
    this.shadow.setMaskFilter(null);
  }

  /** Point the fill paint at a gradient shader for a w×h box (CSS angle convention). Returns a cleanup. */
  private useGradient(g: Gradient, w: number, h: number): () => void {
    const ck = this.ck;
    const colors = g.stops.map((s) => hexToColor(ck, s.color));
    const pos = g.stops.map((s) => s.position);
    let shader;
    if (g.kind === "radial") {
      shader = ck.Shader.MakeRadialGradient([w / 2, h / 2], Math.hypot(w, h) / 2, colors, pos, ck.TileMode.Clamp);
    } else {
      const a = (g.angle * Math.PI) / 180;
      const dx = Math.sin(a), dy = -Math.cos(a);
      const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
      shader = ck.Shader.MakeLinearGradient([w / 2 - dx * half, h / 2 - dy * half], [w / 2 + dx * half, h / 2 + dy * half], colors, pos, ck.TileMode.Clamp);
    }
    this.fill.setShader(shader);
    return () => {
      this.fill.setShader(null);
      shader.delete();
    };
  }

  private drawNode(canvas: Canvas, doc: Doc, id: string, input: RenderInput) {
    const n = doc.nodes[id];
    if (!n || !n.visible) return;
    const ck = this.ck;
    if (input.view?.outlines) return this.drawOutline(canvas, doc, n, input);
    if (isOstCard(n)) return this.drawCardNode(canvas, doc, n, input);
    canvas.save();
    canvas.concat(toCk(localMatrix(n)));
    let layer = false;
    const alpha = n.opacity * (input.flow?.dimmed.has(id) ? 0.3 : 1);
    if (alpha < 1) {
      const lp = new ck.Paint();
      lp.setAlphaf(Math.max(0, alpha));
      canvas.saveLayer(lp);
      lp.delete();
      layer = true;
    }

    const rr = this.rrectFor(n);

    // Shadows follow a box; a filled vector casts its own outline's shadow.
    const effects = n.type !== "text" && n.type !== "icon" && n.type !== "path" ? n.effects : undefined;
    if (effects?.length && n.fill) this.drawDropShadows(canvas, n, rr, effects);
    if (n.type === "path" && n.fill && n.effects?.length) this.drawVectorShadows(canvas, n, n.effects);

    switch (n.type) {
      case "frame":
      case "rect":
      case "ellipse":
        if (n.fill) {
          this.fill.setColor(hexToColor(ck, n.fill.color));
          const done = n.fill.gradient ? this.useGradient(n.fill.gradient, n.w, n.h) : null;
          if (n.type === "ellipse") canvas.drawOval(ck.LTRBRect(0, 0, n.w, n.h), this.fill);
          else canvas.drawRRect(rr, this.fill);
          done?.();
        }
        break;
      case "text":
        if (input.editingTextId !== n.id) canvas.drawParagraph(this.paragraphFor(n), 0, 0);
        break;
      case "icon": {
        const paths = this.iconPaths(n.icon);
        // Its icon set is still loading: draw it when it arrives.
        if (paths === "pending") break;
        if (paths && n.fill) {
          canvas.save();
          if (n.mirrored) {
            canvas.translate(n.w, 0);
            canvas.scale(-1, 1);
          }
          canvas.scale(n.w / 24, n.h / 24);
          const color = hexToColor(ck, n.fill.color);
          if (paths.fill) {
            this.fill.setColor(color);
            canvas.drawPath(paths.fill, this.fill);
          }
          if (paths.stroke) {
            this.stroke.setColor(color);
            this.stroke.setStrokeWidth(n.strokeWidth);
            this.stroke.setStrokeCap(ck.StrokeCap.Round);
            this.stroke.setStrokeJoin(ck.StrokeJoin.Round);
            canvas.drawPath(paths.stroke, this.stroke);
            this.stroke.setStrokeCap(ck.StrokeCap.Butt);
            this.stroke.setStrokeJoin(ck.StrokeJoin.Miter);
          }
          canvas.restore();
        } else if (!paths) {
          this.stroke.setColor(hexToColor(ck, PLACEHOLDER.missing));
          this.stroke.setStrokeWidth(1);
          canvas.drawRect(ck.LTRBRect(0, 0, n.w, n.h), this.stroke);
        }
        break;
      }
      case "path":
        this.drawVector(canvas, n);
        break;
      case "image": {
        const img = this.image(n.src);
        canvas.save();
        canvas.clipRRect(rr, ck.ClipOp.Intersect, true);
        if (n.fill) {
          // A background behind the picture (shows around a contained one).
          this.fill.setColor(hexToColor(ck, n.fill.color));
          canvas.drawRect(ck.LTRBRect(0, 0, n.w, n.h), this.fill);
        }
        if (img && n.fit === "contain") {
          const s = Math.min(n.w / img.width(), n.h / img.height());
          const dw = img.width() * s, dh = img.height() * s;
          canvas.drawImageRectOptions(img, ck.XYWHRect(0, 0, img.width(), img.height()), ck.XYWHRect((n.w - dw) / 2, (n.h - dh) / 2, dw, dh), ck.FilterMode.Linear, ck.MipmapMode.None, null);
        } else if (img) {
          // object-fit: cover
          const s = Math.max(n.w / img.width(), n.h / img.height());
          const sw = n.w / s, sh = n.h / s;
          const sx = (img.width() - sw) / 2, sy = (img.height() - sh) / 2;
          canvas.drawImageRectOptions(
            img,
            ck.XYWHRect(sx, sy, sw, sh),
            ck.XYWHRect(0, 0, n.w, n.h),
            ck.FilterMode.Linear,
            ck.MipmapMode.None,
            null,
          );
        } else if (!n.fill) {
          this.fill.setColor(hexToColor(ck, PLACEHOLDER.image));
          canvas.drawRect(ck.LTRBRect(0, 0, n.w, n.h), this.fill);
        }
        canvas.restore();
        break;
      }
    }

    if (effects?.length) this.drawInnerShadows(canvas, n, rr, effects);

    if (n.type === "frame" && n.children.length) {
      canvas.save();
      if (n.clip) canvas.clipRRect(rr, ck.ClipOp.Intersect, true);
      if (maskOf(doc, n)) this.drawMasked(canvas, doc, n, input);
      else for (const c of n.children) this.drawNode(canvas, doc, c, input);
      canvas.restore();
    }

    if (n.stroke && n.stroke.width > 0 && n.type !== "text" && n.type !== "icon" && n.type !== "path") {
      const sw = n.stroke.width;
      this.stroke.setColor(hexToColor(ck, n.stroke.color));
      this.stroke.setStrokeWidth(sw);
      if (n.type === "ellipse") canvas.drawOval(ck.LTRBRect(sw / 2, sw / 2, n.w - sw / 2, n.h - sw / 2), this.stroke);
      else canvas.drawRRect(this.rrectFor(n, sw / 2), this.stroke);
    }

    if (layer) canvas.restore();
    if (n.type === "frame" && n.grids?.length && input.view?.layoutGrids) this.drawLayoutGrids(canvas, n, rr);
    canvas.restore();
  }

  /** A Discovery tree card: painted from its data, then its child cards (faded while dragged). */
  private drawCardNode(canvas: Canvas, doc: Doc, n: CardNode, input: RenderInput) {
    canvas.save();
    canvas.concat(toCk(localMatrix(n)));
    const faded = !!input.ost?.drag?.ids.includes(n.id);
    if (faded) {
      const lp = new this.ck.Paint();
      lp.setAlphaf(0.3);
      canvas.saveLayer(lp);
      lp.delete();
    }
    // A ghost's card is Qalam AI's (faded) unless it's a real card the ghost leaves as it is (same data).
    this.ost.drawCard(canvas, doc, n, doc !== input.doc && input.doc.nodes[n.id]?.meta.ost !== n.meta.ost);
    for (const c of n.children) this.drawNode(canvas, doc, c, input);
    if (faded) canvas.restore();
    canvas.restore();
  }

  /** ⌃G: a frame's layout grids over its content, clipped to it (frame space). */
  private drawLayoutGrids(canvas: Canvas, n: FrameNode, rr: number[]) {
    const ck = this.ck;
    canvas.save();
    canvas.clipRRect(rr, ck.ClipOp.Intersect, true);
    for (const g of n.grids ?? []) {
      if (g.hidden) continue;
      const color = hexToColor(ck, g.color);
      if (g.kind === "grid") {
        const { xs, ys } = gridLines(g, n.w, n.h);
        const b = new ck.PathBuilder();
        for (const x of xs) {
          b.moveTo(x, 0);
          b.lineTo(x, n.h);
        }
        for (const y of ys) {
          b.moveTo(0, y);
          b.lineTo(n.w, y);
        }
        const path = b.detachAndDelete();
        this.stroke.setColor(color);
        this.stroke.setStrokeWidth(0);
        canvas.drawPath(path, this.stroke);
        path.delete();
        this.stroke.setStrokeWidth(1);
      } else {
        this.fill.setColor(color);
        for (const r of gridBands(g, n.w, n.h)) canvas.drawRect(ck.XYWHRect(r.x, r.y, r.w, r.h), this.fill);
      }
    }
    canvas.restore();
  }

  /**
   * Outline mode (⇧⌘O): every layer as a hairline of its geometry, no fills, effects or pictures.
   * Text keeps its glyphs in the outline colour; pictures are a crossed box.
   */
  private drawOutline(canvas: Canvas, doc: Doc, n: SceneNode, input: RenderInput) {
    const ck = this.ck;
    canvas.save();
    canvas.concat(toCk(localMatrix(n)));
    const ink = this.c("outline");
    this.stroke.setColor(ink);
    this.stroke.setStrokeWidth(0);
    const rr = this.rrectFor(n);
    switch (n.type) {
      case "frame":
        if (!n.meta.group) canvas.drawRRect(rr, this.stroke);
        break;
      case "rect":
        canvas.drawRRect(rr, this.stroke);
        break;
      case "ellipse":
        canvas.drawOval(ck.LTRBRect(0, 0, n.w, n.h), this.stroke);
        break;
      case "text":
        if (input.editingTextId !== n.id) canvas.drawParagraph(this.paragraphFor(n, this.theme.outline.slice(0, 7)), 0, 0);
        break;
      case "image":
        canvas.drawRRect(rr, this.stroke);
        canvas.drawLine(0, 0, n.w, n.h, this.stroke);
        canvas.drawLine(n.w, 0, 0, n.h, this.stroke);
        break;
      case "icon": {
        const paths = this.iconPaths(n.icon);
        if (paths && paths !== "pending") {
          canvas.save();
          if (n.mirrored) {
            canvas.translate(n.w, 0);
            canvas.scale(-1, 1);
          }
          canvas.scale(n.w / 24, n.h / 24);
          for (const p of [paths.fill, paths.stroke]) if (p) canvas.drawPath(p, this.stroke);
          canvas.restore();
        }
        break;
      }
      case "path": {
        const v = this.vectorDrawable(n);
        for (const p of [v.fill, v.body, v.wings, v.heads]) if (p) canvas.drawPath(p, this.stroke);
        break;
      }
    }
    if (n.type === "frame") {
      canvas.save();
      if (n.clip) canvas.clipRRect(rr, ck.ClipOp.Intersect, true);
      for (const c of n.children) {
        const child = doc.nodes[c];
        if (child?.visible) this.drawOutline(canvas, doc, child, input);
      }
      canvas.restore();
      if (n.grids?.length && input.view?.layoutGrids) this.drawLayoutGrids(canvas, n, rr);
    }
    this.stroke.setStrokeWidth(1);
    canvas.restore();
  }

  paragraphFor(n: TextNode, override?: string): Paragraph {
    const color = override ?? n.fill?.color ?? "#000000";
    const key = `${JSON.stringify(n.text)}|${color}|${n.w}`;
    const hit = this.paraCache.get(n.id);
    if (hit && hit.key === key) return hit.p;
    hit?.p.delete();
    const p = buildParagraph(n.text, color, n.w);
    this.paraCache.set(n.id, { key, p });
    return p;
  }

  /**
   * A mask group (doc/mask.ts): its layers drawn in a layer of their own, then kept only where the
   * mask (its first layer, drawn with DstIn and never shown itself) has alpha, like Figma's masks.
   */
  private drawMasked(canvas: Canvas, doc: Doc, n: FrameNode, input: RenderInput) {
    const [mask, ...rest] = n.children;
    canvas.saveLayer();
    for (const c of rest) this.drawNode(canvas, doc, c, input);
    const keep = new this.ck.Paint();
    keep.setBlendMode(this.ck.BlendMode.DstIn);
    canvas.saveLayer(keep);
    keep.delete();
    this.drawNode(canvas, doc, mask, input);
    canvas.restore();
    canvas.restore();
  }

  private gcParagraphs(doc: Doc, ghosts: Doc[] = []) {
    if (this.paraCache.size < 64) return;
    for (const [id, v] of this.paraCache) {
      if (!doc.nodes[id] && !ghosts.some((g) => g.nodes[id])) {
        v.p.delete();
        this.paraCache.delete(id);
      }
    }
  }

  private clearVectorPlans() {
    for (const v of this.vectorPlans.values()) for (const p of [v.fill, v.body, v.heads, v.wings]) p?.delete();
    this.vectorPlans.clear();
  }

  private skPath(d: string | null, sx = 1, sy = 1): Path | null {
    if (!d) return null;
    const p = this.ck.Path.MakeFromSVGString(d);
    if (!p || (sx === 1 && sy === 1)) return p;
    return new this.ck.PathBuilder(p).transform([sx, 0, 0, 0, sy, 0, 0, 0, 1]).detachAndDelete();
  }

  /**
   * A path node's geometry in node px: the scale goes into the geometry, never the canvas, so a
   * zero axis (a straight line) still draws and strokes keep their width when stretched.
   * Editable vectors fill closed subpaths only; legacy (AI) path data keeps SVG fill semantics.
   */
  private vectorDrawable(n: PathNode): VectorDrawable {
    const { sx, sy } = vectorScale(n);
    const sw = n.stroke && n.stroke.width > 0 ? n.stroke.width : 0;
    const ends = sw && n.ends ? `${n.ends.start}/${n.ends.end}` : "";
    const editable = isEditableVector(n);
    // What an editable vector fills isn't in its path data: whether it has a fill at all, and which
    // closed regions the paint bucket left on (`filled`).
    const fills = editable ? (n.fill ? vectorOf(n).paths.map((p) => (p.filled === false ? 0 : 1)).join("") : "-") : "";
    const key = `${n.evenOdd ? 1 : 0}|${sx}|${sy}|${sw}|${ends}|${n.vector ? 1 : 0}|${fills}|${n.d}`;
    const hit = this.vectorPlans.get(key);
    if (hit) return hit;
    if (this.vectorPlans.size > 600) this.clearVectorPlans();
    const base = this.skPath(n.d, sx, sy);
    const fill = editable ? (n.fill ? this.skPath(fillD(vectorOf(n)), sx, sy) : null) : base?.copy() ?? null;
    if (fill && n.evenOdd) fill.setFillType(this.ck.FillType.EvenOdd);
    const plan = sw ? strokeEnds(scaleVector(vectorOf(n), sx, sy), sw, n.ends) : null;
    const body = plan?.body ? (base?.delete(), this.skPath(vectorToD(plan.body))) : base;
    const d: VectorDrawable = { fill, body, cap: plan?.cap ?? "round", heads: this.skPath(plan?.fill || null), wings: this.skPath(plan?.stroke || null) };
    this.vectorPlans.set(key, d);
    return d;
  }

  private drawVector(canvas: Canvas, n: PathNode) {
    const ck = this.ck;
    const v = this.vectorDrawable(n);
    if (n.fill && v.fill) {
      this.fill.setColor(hexToColor(ck, n.fill.color));
      const done = n.fill.gradient ? this.useGradient(n.fill.gradient, n.w, n.h) : null;
      canvas.drawPath(v.fill, this.fill);
      done?.();
    }
    if (!n.stroke || n.stroke.width <= 0) return;
    const color = hexToColor(ck, n.stroke.color);
    this.stroke.setColor(color);
    this.stroke.setStrokeWidth(n.stroke.width);
    // Absent cap/join = the look AI-built paths always had (round).
    this.stroke.setStrokeCap(v.cap === "butt" ? ck.StrokeCap.Butt : v.cap === "square" ? ck.StrokeCap.Square : ck.StrokeCap.Round);
    const join = n.join ?? "round";
    this.stroke.setStrokeJoin(join === "miter" ? ck.StrokeJoin.Miter : join === "bevel" ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Round);
    this.stroke.setStrokeMiter(4);
    const dash = n.stroke.dash?.length ? ck.PathEffect.MakeDash(n.stroke.dash.length % 2 ? [...n.stroke.dash, ...n.stroke.dash] : n.stroke.dash, 0) : null;
    if (dash) this.stroke.setPathEffect(dash);
    if (v.body) canvas.drawPath(v.body, this.stroke);
    if (dash) {
      this.stroke.setPathEffect(null);
      dash.delete();
    }
    if (v.wings) canvas.drawPath(v.wings, this.stroke);
    if (v.heads) {
      this.fill.setColor(color);
      canvas.drawPath(v.heads, this.fill);
    }
    this.stroke.setStrokeCap(ck.StrokeCap.Butt);
    this.stroke.setStrokeJoin(ck.StrokeJoin.Miter);
  }

  private iconPaths(name: string): { stroke: Path | null; fill: Path | null } | "pending" | null {
    if (this.iconCache.has(name)) return this.iconCache.get(name)!;
    const d = iconDrawing(name);
    if (d === "pending") return d;
    let p: { stroke: Path | null; fill: Path | null } | null = null;
    if (d) {
      const fill = d.fill ? this.ck.Path.MakeFromSVGString(d.fill) : null;
      if (fill && d.evenOdd) fill.setFillType(this.ck.FillType.EvenOdd);
      p = { stroke: d.stroke ? this.ck.Path.MakeFromSVGString(d.stroke) : null, fill };
    }
    this.iconCache.set(name, p);
    return p;
  }

  /** Decode pictures before an export, so it draws them rather than their placeholders. */
  async loadImages(srcs: string[]): Promise<void> {
    await Promise.all(
      [...new Set(srcs)].map(async (src) => {
        const hit = this.imageCache.get(src);
        if (hit && hit !== "loading") return;
        const bytes = await sourceBytes(src).catch(() => null);
        const img = bytes ? this.ck.MakeImageFromEncoded(bytes) : null;
        this.imageCache.set(src, img ?? "error");
      }),
    );
  }

  private image(src: string): CkImage | null {
    const hit = this.imageCache.get(src);
    if (hit && typeof hit === "object") return hit;
    if (!hit) {
      this.imageCache.set(src, "loading");
      sourceBytes(src)
        .then((bytes) => {
          const img = bytes ? this.ck.MakeImageFromEncoded(bytes) : null;
          this.imageCache.set(src, img ?? "error");
          this.onImageLoaded?.();
        })
        .catch(() => this.imageCache.set(src, "error"));
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Overlay (screen space)

  /** What the route painter borrows: colours, chips, camera maths. */
  private get routeKit(): RouteKit {
    return {
      color: (k, a) => this.c(k, a),
      pill: (canvas, text, at, bg, h, padX, radius) => this.pill(canvas, text, at, bg, h, padX, radius),
      toScreen: (cam, p) => this.toScreen(cam, p),
      label: (canvas, text, tl, maxWidth, strong) => {
        const p = this.chromeText(text, strong ? this.theme.selectionLabel : this.theme.canvasLabel, 11, 500, false, maxWidth);
        canvas.drawParagraph(p, Math.round(tl.x * this.dpr) / this.dpr, Math.round((tl.y - 4 - p.getHeight()) * this.dpr) / this.dpr);
      },
      dpr: this.dpr,
    };
  }

  private toScreen(cam: Camera, p: Pt): Pt {
    return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
  }

  private polygon(canvas: Canvas, pts: Pt[], paint: Paint) {
    const b = new this.ck.PathBuilder();
    b.addPolygon(pts.flatMap((p) => [p.x, p.y]), true);
    const path = b.detachAndDelete();
    canvas.drawPath(path, paint);
    path.delete();
  }

  /** Snap a screen value to the device-pixel grid for a line `width` px wide (see chrome.ts). */
  private px(v: number, width = 1) {
    return crisp(v, this.dpr, width);
  }

  /** A rect's edges on whole device pixels (for fills: pills, handles, ruler strips). */
  private snapRect(x: number, y: number, w: number, h: number) {
    const d = this.dpr;
    const l = Math.round(x * d) / d, t = Math.round(y * d) / d;
    return this.ck.LTRBRect(l, t, Math.round((x + w) * d) / d, Math.round((y + h) * d) / d);
  }

  /**
   * Outline through screen points with the stroke paint. Axis-aligned boxes are drawn on the
   * device-pixel grid so a 1 px line stays one crisp line; rotated ones stay anti-aliased.
   */
  private outline(canvas: Canvas, pts: Pt[], width: number) {
    this.stroke.setStrokeWidth(width);
    const straight = pts.every((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return Math.abs(p.x - q.x) < 1e-3 || Math.abs(p.y - q.y) < 1e-3;
    });
    if (!straight) return this.polygon(canvas, pts, this.stroke);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const l = this.px(Math.min(...xs), width), r = this.px(Math.max(...xs), width);
    const t = this.px(Math.min(...ys), width), b = this.px(Math.max(...ys), width);
    canvas.drawRect(this.ck.LTRBRect(l, t, r, b), this.stroke);
  }

  /** A straight chrome line; horizontal and vertical ones land on device pixels. */
  private line(canvas: Canvas, a: Pt, b: Pt, width = 1) {
    this.stroke.setStrokeWidth(width);
    if (Math.abs(a.y - b.y) < 1e-3) {
      const y = this.px(a.y, width);
      canvas.drawLine(a.x, y, b.x, y, this.stroke);
    } else if (Math.abs(a.x - b.x) < 1e-3) {
      const x = this.px(a.x, width);
      canvas.drawLine(x, a.y, x, b.y, this.stroke);
    } else canvas.drawLine(a.x, a.y, b.x, b.y, this.stroke);
  }

  /**
   * Chrome text in the UI font: one line, ellipsised to `maxWidth`. Cached per text, colour and
   * style; the cache empties on a theme change because the colour is baked in.
   */
  private chromeText(text: string, color: string, size = 11, weight = 500, tnum = false, maxWidth = Infinity): Paragraph {
    const key = `${text}|${color}|${size}|${weight}|${tnum ? 1 : 0}`;
    let hit = this.chromeCache.get(key);
    if (!hit) {
      if (this.chromeCache.size > 400) this.clearChromeText();
      const { ck, fonts } = getEngine();
      const style = new ck.ParagraphStyle({
        textStyle: {
          color: hexToColor(ck, color),
          fontFamilies: [CHROME_FONT, "IBM Plex Sans Arabic"],
          fontSize: size,
          fontStyle: { weight: weight >= 600 ? ck.FontWeight.SemiBold : weight >= 500 ? ck.FontWeight.Medium : ck.FontWeight.Normal },
          letterSpacing: size <= 11 ? 0.01 * size : 0,
          heightMultiplier: (size <= 11 ? 14 : 16) / size,
          halfLeading: true,
          ...(tnum ? { fontFeatures: [{ name: "tnum", value: 1 }, { name: "zero", value: 1 }] } : {}),
        },
        maxLines: 1,
        ellipsis: "…",
      });
      const b = ck.ParagraphBuilder.MakeFromFontProvider(style, fonts);
      b.addText(text || " ");
      const p = b.build();
      b.delete();
      p.layout(100000);
      hit = { p, width: -1 };
      this.chromeCache.set(key, hit);
    }
    const width = Math.max(1, Math.min(Math.ceil(hit.p.getMaxIntrinsicWidth()) + 1, Math.floor(maxWidth)));
    if (hit.width !== width) {
      hit.p.layout(width);
      hit.width = width;
    }
    return hit.p;
  }

  /**
   * A value pill (W×H badge, distances, angle) centred on `cx`, with its top at `top` or centred
   * on `cy`. Returns its screen rect.
   */
  private pill(canvas: Canvas, text: string, at: { cx: number; top?: number; cy?: number }, bg: Float32Array, h = 16, padX = 4, radius = 3): Box {
    const p = this.chromeText(text, this.theme.pillInk, 11, 600, true);
    const tw = Math.ceil(p.getMaxIntrinsicWidth());
    const w = tw + padX * 2;
    const x = Math.round((at.cx - w / 2) * this.dpr) / this.dpr;
    const y = Math.round((at.top ?? (at.cy ?? 0) - h / 2) * this.dpr) / this.dpr;
    this.fill.setColor(bg);
    canvas.drawRRect(this.ck.RRectXY(this.snapRect(x, y, w, h), radius, radius), this.fill);
    canvas.drawParagraph(p, x + padX, y + (h - p.getHeight()) / 2);
    return { x, y, w, h };
  }

  /** A short bar across a line's end (measure and spacing lines). */
  private tick(canvas: Canvas, p: Pt, axis: "x" | "y", half: number) {
    if (axis === "x") this.line(canvas, { x: p.x, y: p.y - half }, { x: p.x, y: p.y + half });
    else this.line(canvas, { x: p.x - half, y: p.y }, { x: p.x + half, y: p.y });
  }

  /** A distance along `axis` (world) as a line with end bars and a value pill (screen). */
  private distance(canvas: Canvas, cam: Camera, d: { axis: "x" | "y"; at: number; from: number; to: number }, color: Float32Array, pillBg: Float32Array, dashed: boolean) {
    const a = this.toScreen(cam, d.axis === "x" ? { x: d.from, y: d.at } : { x: d.at, y: d.from });
    const b = this.toScreen(cam, d.axis === "x" ? { x: d.to, y: d.at } : { x: d.at, y: d.to });
    this.stroke.setColor(color);
    let dash: PathEffect | null = null;
    if (dashed) {
      dash = this.ck.PathEffect.MakeDash([3, 2], 0);
      this.stroke.setPathEffect(dash);
    }
    this.line(canvas, a, b);
    this.stroke.setPathEffect(null);
    dash?.delete();
    this.tick(canvas, a, d.axis, 3.5);
    this.tick(canvas, b, d.axis, 3.5);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pill(canvas, formatChromeNumber(d.to - d.from), { cx: mid.x, cy: mid.y }, pillBg);
  }

  private drawOverlay(canvas: Canvas, input: RenderInput) {
    const ck = this.ck;
    const { doc, camera: cam, selection } = input;
    const sel = new Set(selection);
    const isComponent = (d: Doc, id: string) => !!d.nodes[id]?.meta.component;
    const selComponent = selection.length > 0 && selection.every((id) => isComponent(doc, id));
    const accent = selComponent ? this.c("component") : this.c("selection");

    // Frame name labels for top-level frames (and screens the AI is building); groups have none.
    this.labelRects = [];
    const labelled = [...doc.roots.filter((id) => !input.coveredRoots?.has(id)).map((id) => [doc, id] as const), ...(input.aiGhosts ?? []).flatMap((g) => g.roots.map((id) => [g, id] as const))];
    for (const [d, id] of labelled) {
      const n = d.nodes[id];
      // Groups, tree cards and sticky notes have no name label.
      if (!n || n.type !== "frame" || !n.visible || n.meta.group || isSealed(n)) continue;
      const tl = this.toScreen(cam, apply(worldMatrix(d, id), { x: 0, y: 0 }));
      const room = n.w * cam.zoom;
      if (room < 16 || tl.x > this.width || tl.x + room < 0 || tl.y < -4 || tl.y > this.height + 24) continue;
      const color = sel.has(id) || input.hoverId === id ? this.theme.selectionLabel : isComponent(d, id) ? this.theme.component : this.theme.canvasLabel;
      const p = this.chromeText(n.name, color, 11, 500, false, room);
      const x = Math.round(tl.x * this.dpr) / this.dpr;
      const y = Math.round((tl.y - 4 - p.getHeight()) * this.dpr) / this.dpr;
      canvas.drawParagraph(p, x, y);
      if (d === doc) this.labelRects.push({ id, x, y, w: Math.min(room, p.getMaxIntrinsicWidth() + 1), h: p.getHeight() + 4 });
    }

    // Routes: the wires from what's tapped to what it opens, over the screens.
    if (input.view?.routeParts) this.routes.drawWires(canvas, input, this.routeKit);

    // Lint marks: a ring at each flagged layer's top-right corner (FlagTips hit-tests the same spot).
    if (input.showFlags) {
      for (const id in doc.nodes) {
        const n = doc.nodes[id];
        const flags = n.meta.flags;
        // Only the page showing (other pages' layers share the node map).
        if (!flags?.length || !n.visible || !isOnPage(doc, id)) continue;
        const b = worldBounds(doc, id);
        const s = this.toScreen(cam, { x: b.x + b.w, y: b.y });
        if (s.x < 0 || s.y < 0 || s.x > this.width || s.y > this.height) continue;
        const error = flags.some((f) => f.severity === "error");
        const cx = s.x - 1, cy = s.y + 1;
        this.fill.setColor(this.c("canvas"));
        canvas.drawCircle(cx, cy, 5, this.fill);
        this.stroke.setColor(this.c(error ? "danger" : "lintWarning"));
        this.stroke.setStrokeWidth(1.5);
        canvas.drawCircle(cx, cy, 4.25, this.stroke);
        if (error) {
          this.fill.setColor(this.c("danger"));
          canvas.drawCircle(cx, cy, 1.75, this.fill);
        }
      }
    }

    // Hover outline (also on a screen the AI is building, hovered from the chat). Tree cards draw their own rounded ring.
    const hoverDoc = input.hoverId ? (doc.nodes[input.hoverId] ? doc : input.aiGhosts?.find((g) => g.nodes[input.hoverId!])) : undefined;
    if (input.hoverId && !sel.has(input.hoverId) && hoverDoc && !input.measure && !isOstCard(hoverDoc.nodes[input.hoverId])) {
      this.stroke.setColor(isComponent(hoverDoc, input.hoverId) ? this.c("component") : this.c("hover"));
      this.outline(canvas, worldCorners(hoverDoc, input.hoverId).map((p) => this.toScreen(cam, p)), 1.5);
    }

    // Selection outlines (tree cards draw their own rounded ring).
    for (const id of selection) {
      if (!doc.nodes[id] || isOstCard(doc.nodes[id])) continue;
      this.stroke.setColor(isComponent(doc, id) ? this.c("component") : this.c("selection"));
      if (isLineNode(doc.nodes[id])) {
        const [a, b] = worldCorners(doc, id).map((p) => this.toScreen(cam, p));
        this.line(canvas, a, b);
      } else this.outline(canvas, worldCorners(doc, id).map((p) => this.toScreen(cam, p)), 1);
    }

    // ⌥ measure: the target in the measure colour, distances to it.
    if (input.measure) {
      const m = input.measure;
      const red = this.c("measure");
      this.stroke.setColor(red);
      const t = m.target;
      this.outline(canvas, [{ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y }, { x: t.x + t.w, y: t.y + t.h }, { x: t.x, y: t.y + t.h }].map((p) => this.toScreen(cam, p)), 1);
      const dash = ck.PathEffect.MakeDash([3, 2], 0);
      for (const [a, b] of m.extensions) {
        this.stroke.setColor(red);
        this.stroke.setPathEffect(dash);
        this.line(canvas, this.toScreen(cam, a), this.toScreen(cam, b));
        this.stroke.setPathEffect(null);
      }
      dash.delete();
      for (const l of m.lines) this.distance(canvas, cam, l, red, red, false);
    }

    // Handles and the size badge (a line has its two end knobs instead).
    const showChrome = !input.editingTextId && selection.some((id) => doc.nodes[id]);
    const ends = showChrome ? this.lineEnds(doc, cam, selection) : null;
    const handles = showChrome && !ends ? this.handlePoints(doc, cam, selection) : null;
    if (handles && !input.hideHandles) {
      this.stroke.setColor(accent);
      if (selection.length > 1) this.outline(canvas, handles.corners, 1);
      const hs = HANDLE_SIZE;
      const rotated = Math.abs(handles.angle % 90) > 1e-3;
      for (const h of handles.points) {
        const hover = input.hoverHandle === h.h;
        this.fill.setColor(hover ? accent : this.c("handleFill"));
        this.stroke.setColor(accent);
        this.stroke.setStrokeWidth(1);
        if (rotated) {
          canvas.save();
          canvas.translate(h.p.x, h.p.y);
          canvas.rotate(handles.angle, 0, 0);
          const r = ck.XYWHRect(-hs / 2, -hs / 2, hs, hs);
          canvas.drawRect(r, this.fill);
          canvas.drawRect(r, this.stroke);
          canvas.restore();
        } else {
          // Fill on whole device pixels, the 1 px ring centred on its edge.
          const l = this.px(h.p.x - hs / 2), t = this.px(h.p.y - hs / 2);
          const r = ck.LTRBRect(l, t, l + hs, t + hs);
          canvas.drawRect(r, this.fill);
          canvas.drawRect(r, this.stroke);
        }
      }
    }
    if (ends && !input.hideHandles) {
      this.vectorPainter.draw(canvas, { handles: [], anchors: [], lineEnds: [{ p: ends.p0, hover: input.hoverHandle === "p0" }, { p: ends.p1, hover: input.hoverHandle === "p1" }] }, { accent: this.theme.selection, knob: this.theme.handleFill });
    }
    if (showChrome && (handles || ends) && !input.rotating && !input.measure?.lines.length) {
      const live = selection.filter((id) => doc.nodes[id]);
      const b = selectionBounds(doc, live)!;
      const one = live.length === 1 ? doc.nodes[live[0]] : null;
      const text = ends && one ? formatChromeNumber(one.w) : `${formatChromeNumber(one ? one.w : b.w)} × ${formatChromeNumber(one ? one.h : b.h)}`;
      const bottom = this.toScreen(cam, { x: b.x + b.w / 2, y: b.y + b.h });
      this.pill(canvas, text, { cx: bottom.x, top: bottom.y + 8 }, selComponent ? this.c("component") : this.c("selectionStrong"), 18, 5, 4);
    }

    // Auto-layout drop target and insertion line.
    if (input.flow?.target && doc.nodes[input.flow.target]) {
      this.stroke.setColor(this.c("selection"));
      this.outline(canvas, worldCorners(doc, input.flow.target).map((p) => this.toScreen(cam, p)), 1);
    }
    if (input.flow?.line) {
      const [a, b] = input.flow.line.map((p) => this.toScreen(cam, p));
      this.stroke.setColor(this.c("selection"));
      this.stroke.setStrokeCap(ck.StrokeCap.Round);
      this.line(canvas, a, b, 2);
      this.stroke.setStrokeCap(ck.StrokeCap.Butt);
    }

    // Smart guides, and the distances they line up.
    if (input.guides.length) {
      this.stroke.setColor(this.c("guide"));
      for (const g of input.guides) {
        const a = g.axis === "x" ? this.toScreen(cam, { x: g.at, y: g.from }) : this.toScreen(cam, { x: g.from, y: g.at });
        const b = g.axis === "x" ? this.toScreen(cam, { x: g.at, y: g.to }) : this.toScreen(cam, { x: g.to, y: g.at });
        this.line(canvas, a, b);
      }
    }
    for (const s of input.spacings ?? []) this.distance(canvas, cam, s, this.c("guide"), this.c("measure"), true);

    // Discovery: where dragged cards would land (a card to go under, or a gap between siblings).
    const drop = input.ost?.drop;
    if (drop?.target && doc.nodes[drop.target]) {
      const b = selectionBounds(doc, [drop.target])!;
      const a = this.toScreen(cam, { x: b.x, y: b.y });
      const pad = 4;
      const rad = 10 * cam.zoom + pad;
      this.stroke.setColor(this.c(drop.ok ? "selection" : "danger"));
      this.stroke.setStrokeWidth(2);
      canvas.drawRRect(ck.RRectXY(ck.XYWHRect(a.x - pad, a.y - pad, b.w * cam.zoom + pad * 2, b.h * cam.zoom + pad * 2), rad, rad), this.stroke);
    }
    if (drop?.line) {
      const [a, b] = drop.line.map((p) => this.toScreen(cam, p));
      this.stroke.setColor(this.c(drop.ok ? "selection" : "danger"));
      this.stroke.setStrokeCap(ck.StrokeCap.Round);
      this.line(canvas, a, b, 2);
      this.stroke.setStrokeCap(ck.StrokeCap.Butt);
    }

    // Marquee.
    if (input.marquee) {
      const m = input.marquee;
      const a = this.toScreen(cam, { x: m.x, y: m.y });
      const r = this.snapRect(a.x, a.y, m.w * cam.zoom, m.h * cam.zoom);
      this.fill.setColor(this.c("selectionFill"));
      canvas.drawRect(r, this.fill);
      this.stroke.setColor(this.c("selection"));
      const r2 = { x: a.x + m.w * cam.zoom, y: a.y + m.h * cam.zoom };
      this.outline(canvas, [a, { x: r2.x, y: a.y }, r2, { x: a.x, y: r2.y }], 1);
    }

    // Vector tools (pen, edit mode, line ends): the palette follows the theme.
    if (input.vector) this.vectorPainter.draw(canvas, input.vector, { accent: this.theme.selection, knob: this.theme.handleFill });

    // The angle of a rotate drag, by the pointer.
    if (input.rotating) {
      const r = input.rotating;
      this.pill(canvas, `${formatChromeNumber(r.angle)}°`, { cx: r.at.x + 22, top: r.at.y + 14 }, this.c("selectionStrong"), 18, 5, 4);
    }
    this.stroke.setStrokeWidth(1);
  }

  /** Rulers (⇧R): strips along the top and left, numbered from the origin, the selection marked. */
  private drawRulers(canvas: Canvas, input: RenderInput) {
    const ck = this.ck;
    const S = RULER_SIZE;
    const cam = input.camera;
    const z = cam.zoom;
    const o = input.rulerOrigin ?? { x: 0, y: 0 };
    const W = this.width, H = this.height;
    this.fill.setColor(this.c("rulerBg"));
    canvas.drawRect(ck.LTRBRect(0, 0, W, S), this.fill);
    canvas.drawRect(ck.LTRBRect(0, S, S, H), this.fill);

    // The selection's extent as a band, its two ends numbered in the selection colour.
    const live = input.selection.filter((id) => input.doc.nodes[id]);
    const b = live.length ? selectionBounds(input.doc, live) : null;
    const marks: { axis: "x" | "y"; at: number; value: number; side: -1 | 1 }[] = [];
    if (b) {
      const a = this.toScreen(cam, { x: b.x, y: b.y }), e = this.toScreen(cam, { x: b.x + b.w, y: b.y + b.h });
      this.fill.setColor(this.c("rulerBand"));
      canvas.drawRect(this.snapRect(Math.max(S, a.x), 0, Math.max(0, e.x - Math.max(S, a.x)), S), this.fill);
      canvas.drawRect(this.snapRect(0, Math.max(S, a.y), S, Math.max(0, e.y - Math.max(S, a.y))), this.fill);
      marks.push({ axis: "x", at: a.x, value: b.x - o.x, side: -1 }, { axis: "x", at: e.x, value: b.x + b.w - o.x, side: 1 });
      marks.push({ axis: "y", at: a.y, value: b.y - o.y, side: -1 }, { axis: "y", at: e.y, value: b.y + b.h - o.y, side: 1 });
    }

    const ink = this.theme.rulerInk, strong = this.theme.selectionLabel;
    const tickPaint = this.c("rulerTick");
    // Where each selection number sits along its strip, so the regular numbers stay clear of it.
    const taken = { x: [] as [number, number][], y: [] as [number, number][] };
    const textAlong = (axis: "x" | "y", at: number, value: string, color: string, side: -1 | 1) => {
      const p = this.chromeText(value, color, 11, color === strong ? 500 : 400, true);
      const w = Math.ceil(p.getMaxIntrinsicWidth()), h = p.getHeight();
      const start = side > 0 ? at + 3 : at - 3 - w;
      if (axis === "x") canvas.drawParagraph(p, start, (S - h) / 2);
      else {
        canvas.save();
        canvas.translate((S - h) / 2, side > 0 ? at + 3 + w : at - 3);
        canvas.rotate(-90, 0, 0);
        canvas.drawParagraph(p, 0, 0);
        canvas.restore();
      }
      return [start - 4, start + w + 4] as [number, number];
    };
    for (const m of marks) {
      if (m.at < S || m.at > (m.axis === "x" ? W : H)) continue;
      taken[m.axis].push(textAlong(m.axis, m.at, formatChromeNumber(m.value), strong, m.side));
    }

    for (const axis of ["x", "y"] as const) {
      const len = axis === "x" ? W : H;
      const t = rulerTicks(axis === "x" ? cam.x : cam.y, len, z, axis === "x" ? o.x : o.y);
      this.stroke.setColor(tickPaint);
      for (const m of t.minor) {
        if (m < S) continue;
        if (axis === "x") this.line(canvas, { x: m, y: S - 4 }, { x: m, y: S });
        else this.line(canvas, { x: S - 4, y: m }, { x: S, y: m });
      }
      for (const tk of t.major) {
        if (tk.at < S || tk.at > len) continue;
        this.stroke.setColor(tickPaint);
        if (axis === "x") this.line(canvas, { x: tk.at, y: S - 8 }, { x: tk.at, y: S });
        else this.line(canvas, { x: S - 8, y: tk.at }, { x: S, y: tk.at });
        const label = formatChromeNumber(tk.value);
        const w = Math.ceil(this.chromeText(label, ink, 11, 400, true).getMaxIntrinsicWidth());
        const span: [number, number] = [tk.at - 8, tk.at + 3 + w + 8];
        if (taken[axis].some(([a, c]) => span[0] < c && span[1] > a)) continue;
        textAlong(axis, tk.at, label, ink, 1);
      }
    }

    // Hairlines between the strips and the canvas, and the corner square.
    this.stroke.setColor(this.c("rulerLine"));
    this.line(canvas, { x: 0, y: S - 0.5 }, { x: W, y: S - 0.5 });
    this.line(canvas, { x: S - 0.5, y: S }, { x: S - 0.5, y: H });
    this.fill.setColor(this.c("rulerBg"));
    canvas.drawRect(ck.LTRBRect(0, 0, S - 0.5, S - 0.5), this.fill);
  }

  /** Screen-space resize handles for the current selection (rotated with a single node), and the box's angle. */
  handlePoints(doc: Doc, cam: Camera, selection: string[]) {
    const ids = selection.filter((id) => doc.nodes[id]);
    if (!ids.length) return null;
    // Tree cards keep the size their content gives them: no resize or rotate handles.
    if (ids.some((id) => isOstCard(doc.nodes[id]))) return null;
    if (this.lineEnds(doc, cam, ids)) return null;
    let corners: Pt[];
    if (ids.length === 1) corners = worldCorners(doc, ids[0]).map((p) => this.toScreen(cam, p));
    else {
      const b = selectionBounds(doc, ids)!;
      corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ].map((p) => this.toScreen(cam, p));
    }
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const [tl, tr, br, bl] = corners;
    const angle = (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
    const small = Math.hypot(tr.x - tl.x, tr.y - tl.y) < 24 || Math.hypot(bl.x - tl.x, bl.y - tl.y) < 24;
    const points: { h: HandleKind; p: Pt }[] = [
      { h: "nw", p: tl },
      { h: "ne", p: tr },
      { h: "se", p: br },
      { h: "sw", p: bl },
    ];
    if (!small) {
      points.push({ h: "n", p: mid(tl, tr) }, { h: "e", p: mid(tr, br) }, { h: "s", p: mid(br, bl) }, { h: "w", p: mid(bl, tl) });
    }
    return { corners, points, angle };
  }

  /** A single selected line's two ends on screen (its start, local x = 0, then its end), else null. */
  lineEnds(doc: Doc, cam: Camera, selection: string[]): { p0: Pt; p1: Pt } | null {
    if (selection.length !== 1) return null;
    const n = doc.nodes[selection[0]];
    if (!isLineNode(n)) return null;
    const m = worldMatrix(doc, n.id);
    return { p0: this.toScreen(cam, apply(m, { x: 0, y: 0 })), p1: this.toScreen(cam, apply(m, { x: n.w, y: 0 })) };
  }

  snapshotPNG(): Uint8Array | null {
    const img = this.surface?.makeImageSnapshot();
    if (!img) return null;
    const bytes = img.encodeToBytes();
    img.delete();
    return bytes;
  }

  /** Render one node subtree to PNG bytes at the given scale (offscreen, CPU surface). Board cards export light. */
  exportNode(doc: Doc, id: string, scale = 2): Uint8Array | null {
    const n = doc.nodes[id];
    if (!n) return null;
    const card = isOstCard(n);
    // A tree card brings the cards under it (and their shadows).
    const wb = card ? treeBounds(doc, id) : worldBounds(doc, id);
    // Leave room for the node's own drop shadows, and for a vector's stroke and arrowheads.
    const shadowPad = card ? 16 : Math.max(0, ...(n.effects ?? []).filter((e) => e.kind === "drop").map((e) => e.blur + e.spread + Math.max(Math.abs(e.x), Math.abs(e.y))));
    const pad = Math.ceil(Math.max(shadowPad, n.type === "path" ? strokeOverhang(n) : 0));
    const b = { x: wb.x - pad, y: wb.y - pad, w: wb.w + pad * 2, h: wb.h + pad * 2 };
    const surf = this.ck.MakeSurface(Math.max(1, Math.ceil(b.w * scale)), Math.max(1, Math.ceil(b.h * scale)));
    if (!surf) return null;
    const canvas = surf.getCanvas();
    canvas.clear(this.ck.TRANSPARENT);
    canvas.scale(scale, scale);
    canvas.translate(-b.x, -b.y);
    // Walk from root to the node's parent to apply ancestor transforms.
    const chain: string[] = [];
    let p = n.parentId;
    while (p) {
      chain.unshift(p);
      p = doc.nodes[p].parentId;
    }
    for (const a of chain) canvas.concat(toCk(localMatrix(doc.nodes[a])));
    this.ost.begin({ doc, selection: [], hoverId: null, zoom: 1, exporting: true }, false);
    this.drawNode(canvas, doc, id, {
      exporting: true,
      doc,
      camera: { x: 0, y: 0, zoom: 1 },
      selection: [],
      hoverId: null,
      editingTextId: null,
      marquee: null,
      guides: [],
      showFlags: false,
      hideHandles: true,
    });
    surf.flush();
    const img = surf.makeImageSnapshot();
    const bytes = img.encodeToBytes();
    img.delete();
    surf.delete();
    return bytes;
  }
}

export type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface VectorDrawable {
  fill: Path | null;
  /** The stroke's centre line (trimmed under filled arrowheads). */
  body: Path | null;
  cap: "butt" | "round" | "square";
  /** Filled arrowheads and caps, in the stroke colour. */
  heads: Path | null;
  /** Line arrows, stroked like the body. */
  wings: Path | null;
}
