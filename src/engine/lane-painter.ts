import type { Canvas, CanvasKit, MaskFilter, Paint, Paragraph, Path } from "canvaskit-wasm";
import { brandOn, logoFor } from "@/connectors/logos";
import { iconDrawing } from "@/design-system/icons";
import type { Lane, LaneItem } from "@/discovery/lane";
import { SOURCE, sourceMark, sourceTile, WIRE, wireCurve } from "@/discovery/look";
import type { Doc } from "@/doc/schema";
import { worldBounds } from "@/doc/geometry";
import { getEngine, hexToColor } from "./canvaskit";
import { OST_PALETTE, type OstPalette } from "./ost-palette";

/*
 * Painting a board's sources lane (CanvasKit, world space; the lane itself is worked out in
 * src/discovery/lane.ts): the wires first, behind the cards, from each source to the cards it backs,
 * then the sources in their column, each as src/discovery/look.ts says a source looks (the setup's
 * canvas draws the same in HTML): a square tile with its mark (a connector's logo in its colour, or
 * what it is), a port on its right edge where its wires leave, and under it its title and, in mono,
 * where it came from. Hovering a source or selecting a card lights its wires and dims the rest.
 */

export interface LaneRender {
  lane: Lane;
  /** What's lit (a hovered source, the selected cards' sources), null: nothing, all at rest. */
  lit: { items: ReadonlySet<string>; cards: ReadonlySet<string>; edges: ReadonlySet<string> } | null;
  /** The source under the pointer. */
  hover: string | null;
}

const FONT = ["Inter", "IBM Plex Sans Arabic"];
const MONO = ["Geist Mono", "Inter", "IBM Plex Sans Arabic"];

export class LanePainter {
  private fill: Paint;
  private stroke: Paint;
  private shadow: Paint;
  private blur: MaskFilter | null = null;
  private texts = new Map<string, Paragraph>();
  private paths = new Map<string, Path | null>();
  private brands = new Map<string, string | null>();
  private pal: OstPalette = OST_PALETTE.dark;

  constructor(private ck: CanvasKit) {
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setStyle(ck.PaintStyle.Fill);
    this.stroke = new ck.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(ck.PaintStyle.Stroke);
    this.shadow = new ck.Paint();
    this.shadow.setAntiAlias(true);
  }

  dispose() {
    this.clearTexts();
    for (const p of this.paths.values()) p?.delete();
    this.paths.clear();
    this.blur?.delete();
    this.fill.delete();
    this.stroke.delete();
    this.shadow.delete();
  }

  private clearTexts() {
    for (const p of this.texts.values()) p.delete();
    this.texts.clear();
  }

  private col(hex: string, alpha = 1) {
    return hexToColor(this.ck, hex, alpha);
  }

  /** Text in the board's UI font (or mono), up to `lines` lines, centred in its width (cached; colour baked in). */
  private text(text: string, color: string, size: number, weight: number, maxWidth: number, lines = 1, mono = false): Paragraph {
    const key = `${text}\u0000${color}\u0000${size}\u0000${weight}\u0000${lines}\u0000${Math.round(maxWidth)}\u0000${mono}`;
    let p = this.texts.get(key);
    if (p) return p;
    if (this.texts.size > 400) this.clearTexts();
    const { ck, fonts } = getEngine();
    const style = new ck.ParagraphStyle({
      textStyle: { color: this.col(color), fontFamilies: mono ? MONO : FONT, fontSize: size, fontStyle: { weight: weight >= 600 ? ck.FontWeight.SemiBold : weight >= 500 ? ck.FontWeight.Medium : ck.FontWeight.Normal }, heightMultiplier: (size <= 11 ? 14 : 16) / size, halfLeading: true },
      textAlign: ck.TextAlign.Center,
      maxLines: lines,
      ellipsis: "…",
    });
    const b = ck.ParagraphBuilder.MakeFromFontProvider(style, fonts);
    b.addText(text || " ");
    p = b.build();
    b.delete();
    p.layout(Math.max(1, maxWidth));
    this.texts.set(key, p);
    return p;
  }

  /** Once per frame: the palette. */
  begin(dark: boolean, exporting: boolean) {
    const pal = exporting || !dark ? OST_PALETTE.light : OST_PALETTE.dark;
    if (pal !== this.pal) {
      this.pal = pal;
      this.clearTexts();
    }
  }

  /** The wires, behind the cards: out of a source's port, into the card's left. */
  drawWires(canvas: Canvas, doc: Doc, r: LaneRender, zoom: number) {
    const p = this.pal;
    const items = new Map(r.lane.items.map((i) => [i.key, i]));
    for (const e of r.lane.edges) {
      const a = items.get(e.from);
      if (!a || !doc.nodes[e.to]) continue;
      const b = worldBounds(doc, e.to);
      const { port } = sourceTile(a);
      const x1 = port.x;
      const y1 = port.y;
      const x2 = b.x;
      const y2 = b.y + Math.min(b.h / 2, WIRE.enter);
      const lit = r.lit?.edges.has(e.id) ?? false;
      const dim = !!r.lit && !lit;
      const color = this.col(lit ? p.selection : p.line, dim ? WIRE.dim : 1);
      const path = new this.ck.PathBuilder();
      path.moveTo(x1, y1);
      path.cubicTo(...wireCurve(x1, y1, x2, y2), x2, y2);
      const built = path.detachAndDelete();
      this.stroke.setColor(color);
      this.stroke.setStrokeWidth((lit ? WIRE.lit : WIRE.width) / Math.min(1, zoom));
      canvas.drawPath(built, this.stroke);
      built.delete();
      // A dot where it meets the card (where it leaves, the source's port is drawn over it).
      this.fill.setColor(this.col(p.card));
      canvas.drawCircle(x2, y2, WIRE.dot, this.fill);
      this.stroke.setStrokeWidth(WIRE.width);
      canvas.drawCircle(x2, y2, WIRE.dot, this.stroke);
    }
  }

  /** The sources in their column. */
  drawItems(canvas: Canvas, r: LaneRender) {
    for (const it of r.lane.items) this.drawItem(canvas, it, r);
  }

  private drawItem(canvas: Canvas, it: LaneItem, r: LaneRender) {
    const p = this.pal;
    const lit = r.lit?.items.has(it.key) ?? false;
    const dim = !!r.lit && !lit;
    const hot = lit || r.hover === it.key;
    const t = sourceTile(it);
    const R = SOURCE.radius;
    const tile = this.ck.RRectXY(this.ck.XYWHRect(t.x, t.y, t.s, t.s), R, R);
    const layer = dim ? new this.ck.Paint() : null;
    if (layer) {
      layer.setAlphaf(WIRE.dimItem);
      canvas.saveLayer(layer);
      layer.delete();
    }
    // The tile: shadow, body, hairline (the selection's colour while lit), a lit top edge on the dark board.
    this.blur ??= this.ck.MaskFilter.MakeBlur(this.ck.BlurStyle.Normal, 6, true);
    this.shadow.setColor(this.col(p.shadow));
    this.shadow.setMaskFilter(this.blur);
    canvas.save();
    canvas.translate(0, 2);
    canvas.drawRRect(tile, this.shadow);
    canvas.restore();
    this.shadow.setMaskFilter(null);
    this.fill.setColor(this.col(p.card));
    canvas.drawRRect(tile, this.fill);
    this.stroke.setColor(this.col(hot ? p.selection : p.border));
    this.stroke.setStrokeWidth(hot ? 1.5 : 1);
    const inset = hot ? 0.75 : 0.5;
    canvas.drawRRect(this.ck.RRectXY(this.ck.XYWHRect(t.x + inset, t.y + inset, t.s - inset * 2, t.s - inset * 2), R - inset, R - inset), this.stroke);
    if (!hot) {
      this.stroke.setColor(this.col(p.edge));
      this.stroke.setStrokeWidth(1);
      canvas.drawLine(t.x + R, t.y + 1.5, t.x + t.s - R, t.y + 1.5, this.stroke);
    }
    this.mark(canvas, it.mark, t.x + t.s / 2, t.y + t.s / 2);
    // Its port, on the right edge, where its wires leave.
    this.fill.setColor(this.col(p.card));
    canvas.drawCircle(t.port.x, t.port.y, SOURCE.port + 1.5, this.fill);
    this.fill.setColor(this.col(hot ? p.selection : p.line));
    canvas.drawCircle(t.port.x, t.port.y, SOURCE.port, this.fill);
    // Under it, centred: its title, then where it came from, in mono.
    const title = this.text(it.title, p.ink, SOURCE.titleSize, 500, it.w, SOURCE.titleLines);
    const ty = t.y + SOURCE.tile + SOURCE.labelGap;
    canvas.drawParagraph(title, it.x, ty);
    const line = this.text(it.line, p.subtle, SOURCE.lineSize, 400, it.w, 1, true);
    canvas.drawParagraph(line, it.x, ty + title.getHeight() + SOURCE.lineGap);
    if (layer) canvas.restore();
  }

  /** A source's mark in the middle of its tile: a connector's logo (its colour where it reads on the tile, else ink), else what it is. */
  private mark(canvas: Canvas, mark: string, cx: number, cy: number) {
    const ck = this.ck;
    const p = this.pal;
    const what = sourceMark(mark);
    const logo = logoFor(mark);
    if ("logo" in what && logo.kind === "mark") {
      let path = this.paths.get(mark);
      if (path === undefined) {
        path = ck.Path.MakeFromSVGString(logo.path);
        this.paths.set(mark, path);
      }
      if (path) {
        const key = `${logo.hex}\u0000${p.card}`;
        if (!this.brands.has(key)) this.brands.set(key, brandOn(logo.hex, p.card));
        canvas.save();
        canvas.translate(cx - SOURCE.logo / 2, cy - SOURCE.logo / 2);
        canvas.scale(SOURCE.logo / 24, SOURCE.logo / 24);
        this.fill.setColor(this.col(this.brands.get(key) ?? p.ink));
        canvas.drawPath(path, this.fill);
        canvas.restore();
        return;
      }
    }
    // What it is (sourceMark): their words a pen, a page a globe, a call a waveform, anything else a page of text.
    const icon = "icon" in what ? what.icon : "file-text";
    let path = this.paths.get(`icon:${icon}`);
    if (path === undefined) {
      const d = iconDrawing(icon);
      path = d && d !== "pending" && d.stroke ? ck.Path.MakeFromSVGString(d.stroke) : null;
      this.paths.set(`icon:${icon}`, path);
    }
    if (!path) return;
    const k = SOURCE.icon / 24;
    canvas.save();
    canvas.translate(cx - SOURCE.icon / 2, cy - SOURCE.icon / 2);
    canvas.scale(k, k);
    this.stroke.setColor(this.col(p.muted));
    this.stroke.setStrokeWidth(1.75 / k);
    this.stroke.setStrokeCap(ck.StrokeCap.Round);
    this.stroke.setStrokeJoin(ck.StrokeJoin.Round);
    canvas.drawPath(path, this.stroke);
    this.stroke.setStrokeCap(ck.StrokeCap.Butt);
    this.stroke.setStrokeJoin(ck.StrokeJoin.Miter);
    canvas.restore();
  }
}
