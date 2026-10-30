import type { Canvas, CanvasKit, Paint, Paragraph, Path } from "canvaskit-wasm";
import { logoFor, TILE } from "@/connectors/logos";
import type { Lane, LaneItem } from "@/discovery/lane";
import type { Doc } from "@/doc/schema";
import { worldBounds } from "@/doc/geometry";
import { getEngine, hexToColor } from "./canvaskit";
import { OST_PALETTE, type OstPalette } from "./ost-palette";

/*
 * Painting a board's sources lane (CanvasKit, world space; the lane itself is worked out in
 * src/discovery/lane.ts): the wires first, behind the cards, from each source to the cards it backs,
 * then the source cards in their column, each with its mark (a connector's logo on its light tile,
 * or what it is), where it came from, and its title. Hovering a source or selecting a card lights its
 * wires and dims the rest.
 */

export interface LaneRender {
  lane: Lane;
  /** What's lit (a hovered source, the selected cards' sources), null: nothing, all at rest. */
  lit: { items: ReadonlySet<string>; cards: ReadonlySet<string>; edges: ReadonlySet<string> } | null;
  /** The source under the pointer. */
  hover: string | null;
}

const FONT = ["Inter", "IBM Plex Sans Arabic"];
const PAD = 10;
const TILE_S = 16;

export class LanePainter {
  private fill: Paint;
  private stroke: Paint;
  private texts = new Map<string, Paragraph>();
  private paths = new Map<string, Path | null>();
  private pal: OstPalette = OST_PALETTE.dark;

  constructor(private ck: CanvasKit) {
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setStyle(ck.PaintStyle.Fill);
    this.stroke = new ck.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(ck.PaintStyle.Stroke);
  }

  dispose() {
    this.clearTexts();
    for (const p of this.paths.values()) p?.delete();
    this.paths.clear();
    this.fill.delete();
    this.stroke.delete();
  }

  private clearTexts() {
    for (const p of this.texts.values()) p.delete();
    this.texts.clear();
  }

  private col(hex: string, alpha = 1) {
    return hexToColor(this.ck, hex, alpha);
  }

  /** Text in the board's UI font, up to `lines` lines (cached; colour baked in). */
  private text(text: string, color: string, size: number, weight: number, maxWidth: number, lines = 1): Paragraph {
    const key = `${text}\u0000${color}\u0000${size}\u0000${weight}\u0000${lines}\u0000${Math.round(maxWidth)}`;
    let p = this.texts.get(key);
    if (p) return p;
    if (this.texts.size > 400) this.clearTexts();
    const { ck, fonts } = getEngine();
    const style = new ck.ParagraphStyle({
      textStyle: { color: this.col(color), fontFamilies: FONT, fontSize: size, fontStyle: { weight: weight >= 600 ? ck.FontWeight.SemiBold : weight >= 500 ? ck.FontWeight.Medium : ck.FontWeight.Normal }, heightMultiplier: (size <= 11 ? 14 : 16) / size, halfLeading: true },
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

  /** The wires, behind the cards: out of a source's right side, into the card's left. */
  drawWires(canvas: Canvas, doc: Doc, r: LaneRender, zoom: number) {
    const p = this.pal;
    const items = new Map(r.lane.items.map((i) => [i.key, i]));
    for (const e of r.lane.edges) {
      const a = items.get(e.from);
      if (!a || !doc.nodes[e.to]) continue;
      const b = worldBounds(doc, e.to);
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x;
      const y2 = b.y + Math.min(b.h / 2, 36);
      const reach = Math.max(40, Math.abs(x2 - x1) / 2);
      const lit = r.lit?.edges.has(e.id) ?? false;
      const dim = !!r.lit && !lit;
      const color = this.col(lit ? p.selection : p.line, dim ? 0.3 : 1);
      const path = new this.ck.PathBuilder();
      path.moveTo(x1, y1);
      path.cubicTo(x1 + reach, y1, x2 - reach, y2, x2, y2);
      const built = path.detachAndDelete();
      this.stroke.setColor(color);
      this.stroke.setStrokeWidth((lit ? 2 : 1.25) / Math.min(1, zoom));
      canvas.drawPath(built, this.stroke);
      built.delete();
      // A dot where it leaves the source and where it meets the card.
      for (const [cx, cy] of [
        [x1, y1],
        [x2, y2],
      ]) {
        this.fill.setColor(this.col(p.card));
        canvas.drawCircle(cx, cy, 3, this.fill);
        this.stroke.setStrokeWidth(1.25);
        canvas.drawCircle(cx, cy, 3, this.stroke);
      }
    }
  }

  /** The source cards in their column. */
  drawItems(canvas: Canvas, r: LaneRender) {
    for (const it of r.lane.items) this.drawItem(canvas, it, r);
  }

  private drawItem(canvas: Canvas, it: LaneItem, r: LaneRender) {
    const p = this.pal;
    const lit = r.lit?.items.has(it.key) ?? false;
    const dim = !!r.lit && !lit;
    const body = this.ck.RRectXY(this.ck.XYWHRect(it.x, it.y, it.w, it.h), 8, 8);
    const layer = dim ? new this.ck.Paint() : null;
    if (layer) {
      layer.setAlphaf(0.45);
      canvas.saveLayer(layer);
      layer.delete();
    }
    this.fill.setColor(this.col(p.card));
    canvas.drawRRect(body, this.fill);
    this.stroke.setColor(this.col(lit || r.hover === it.key ? p.selection : p.border));
    this.stroke.setStrokeWidth(lit || r.hover === it.key ? 1.5 : 1);
    canvas.drawRRect(this.ck.RRectXY(this.ck.XYWHRect(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1), 7.5, 7.5), this.stroke);
    this.mark(canvas, it.mark, it.x + PAD, it.y + PAD);
    const line = this.text(it.line, p.muted, 10.5, 500, it.w - PAD * 2 - TILE_S - 6);
    canvas.drawParagraph(line, it.x + PAD + TILE_S + 6, it.y + PAD + (TILE_S - line.getHeight()) / 2);
    const title = this.text(it.title, p.ink, 12.5, 500, it.w - PAD * 2, 2);
    canvas.drawParagraph(title, it.x + PAD, it.y + PAD + TILE_S + 6);
    if (layer) canvas.restore();
  }

  /** A source's mark on its tile: a connector's logo (its brand colour, or ink when too pale), else what it is. */
  private mark(canvas: Canvas, mark: string, x: number, y: number) {
    const ck = this.ck;
    const ink = "#1C1A18";
    this.fill.setColor(this.col(TILE));
    canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x, y, TILE_S, TILE_S), 3, 3), this.fill);
    const logo = logoFor(mark);
    if (logo.kind === "mark") {
      let path = this.paths.get(mark);
      if (path === undefined) {
        path = ck.Path.MakeFromSVGString(logo.path);
        this.paths.set(mark, path);
      }
      if (path) {
        canvas.save();
        canvas.translate(x + 3, y + 3);
        canvas.scale(10 / 24, 10 / 24);
        this.fill.setColor(this.col(logo.tone === "brand" ? `#${logo.hex}` : ink));
        canvas.drawPath(path, this.fill);
        canvas.restore();
        return;
      }
    }
    // What it is: their words a quote mark, a page a ring, anything else a page of text.
    this.stroke.setColor(this.col(ink, 0.75));
    this.stroke.setStrokeWidth(1.2);
    const cx = x + TILE_S / 2;
    const cy = y + TILE_S / 2;
    if (mark === "said" || mark === "dump") {
      const q = this.text("“", ink, 14, 600, 20);
      canvas.drawParagraph(q, cx - Math.ceil(q.getMaxIntrinsicWidth()) / 2, cy - q.getHeight() / 2 + 2);
    } else if (mark === "page" || mark === "url") {
      canvas.drawCircle(cx, cy, 4.5, this.stroke);
      canvas.drawLine(cx - 4.5, cy, cx + 4.5, cy, this.stroke);
    } else {
      canvas.drawRRect(ck.RRectXY(ck.XYWHRect(cx - 3.5, cy - 4.5, 7, 9), 1, 1), this.stroke);
      canvas.drawLine(cx - 1.5, cy - 1.5, cx + 1.5, cy - 1.5, this.stroke);
      canvas.drawLine(cx - 1.5, cy + 1, cx + 1.5, cy + 1, this.stroke);
    }
  }
}
