import { metricProgress } from "@/discovery/metric";
import type { Canvas, CanvasKit, MaskFilter, Paint, Paragraph, Path } from "canvaskit-wasm";
import type { Doc } from "@/doc/schema";
import { type CardNode, isOstCard } from "@/doc/board";
import type { Pt } from "@/doc/geometry";
import { CARD, cardBox, METRIC_H, placeholderTitle, titleProps } from "@/discovery/metrics";
import { type Kind, KIND_MARK, KIND_OF, MARK_STROKE, TAG } from "@/discovery/look";
import { foldToggle, isSubOutcome, kindLabel, orientationOf } from "@/discovery/tree";
import { isAssumed } from "@/discovery/evidence";
import { NUQTA_POLYGON, PENCIL_POLYGONS } from "@/ui/brand/pencil";
import type { OstCard } from "@/discovery/types";
import { getEngine, hexToColor } from "./canvaskit";
import { buildParagraph } from "./text";
import { OST_PALETTE, type OstPalette } from "./ost-palette";
import type { LaneRender } from "./lane-painter";

/*
 * Painting the Discovery board's tree cards (CanvasKit). A card is a frame with no paint of its
 * own: everything on it is drawn here from its data (`meta.ost`), so what it says about its
 * evidence is worked out by code each frame and can't drift from it. Each card also draws the
 * connectors down to its showing children, before them, so culling, folding, exports and the AI's
 * ghost drafts all come for free. Sizes and positions come from discovery/metrics.ts, which the
 * layout uses too: a card is exactly as tall as what's painted on it.
 */

/** What the board's interaction adds to a frame (from the Discovery canvas delegate). */
export interface OstRenderInput {
  /** The card whose title is being typed (drawn without its title: the editor sits there). */
  editingId: string | null;
  /** Cards being dragged: faded in their place, and drawn again under the pointer (world offset). */
  drag: { ids: string[]; dx: number; dy: number } | null;
  /** Where they'd land: a card to go under (its ring), or a gap between siblings (a line, world). */
  drop: { target: string | null; line: [Pt, Pt] | null; ok: boolean } | null;
  /** The fold toggle under the pointer. */
  hoverToggle: string | null;
  /** Cards something needs a look at (marked beside their stage). */
  noticed?: ReadonlySet<string>;
  /** Solutions' linked work, as its tool says it stands ("Merged", "In Progress"), after the kind. */
  work?: ReadonlyMap<string, { label: string; tone: "ok" | "warn" | "off" }>;
  /** The board's sources lane, wired to its cards (painted by ./lane-painter.ts). */
  lane?: LaneRender | null;
}

export interface OstFrame {
  doc: Doc;
  selection: string[];
  hoverId: string | null;
  zoom: number;
  ost?: OstRenderInput | null;
  /** Exports and thumbnails: always the light palette, no selection or hover. */
  exporting?: boolean;
}

type Tone = "neutral" | "inverse" | "selection" | "success" | "warning" | "danger" | "subtle" | "ai";

const STAGE_TONE: Record<string, Tone> = {
  active: "neutral",
  achieved: "success",
  paused: "subtle",
  exploring: "neutral",
  target: "inverse",
  parked: "subtle",
  solved: "success",
  idea: "neutral",
  testing: "selection",
  building: "selection",
  shipped: "success",
  dropped: "subtle",
  planned: "neutral",
  running: "selection",
  passed: "success",
  failed: "danger",
  inconclusive: "warning",
};

/** Each kind's colour in the palette. */
const KIND_HUE: Record<Kind, "kindGoal" | "kindProblem" | "kindSolution" | "kindTest"> = { goal: "kindGoal", problem: "kindProblem", solution: "kindSolution", test: "kindTest" };

const FONT = ["Inter", "IBM Plex Sans Arabic"];
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100));

export class OstPainter {
  private fill: Paint;
  private stroke: Paint;
  private shadow: Paint;
  private blur: MaskFilter | null = null;
  private titles = new Map<string, { key: string; p: Paragraph }>();
  private labels = new Map<string, Paragraph>();
  private marks = new Map<Kind, { stroke: Path | null; fill: Path | null }>();
  private pal: OstPalette = OST_PALETTE.dark;
  private frame: OstFrame | null = null;
  private selected = new Set<string>();
  /** Cards on the way down to a selected card (their connector to it is highlighted). */
  private onPath = new Set<string>();

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
    for (const { p } of this.titles.values()) p.delete();
    this.titles.clear();
    this.clearLabels();
    for (const m of this.marks.values()) {
      m.stroke?.delete();
      m.fill?.delete();
    }
    this.marks.clear();
    this.blur?.delete();
    this.fill.delete();
    this.stroke.delete();
    this.shadow.delete();
  }

  private clearLabels() {
    for (const p of this.labels.values()) p.delete();
    this.labels.clear();
  }

  /** Once per frame, before any card: the palette and what's selected. */
  begin(f: OstFrame, dark: boolean) {
    this.frame = f;
    const pal = f.exporting || !dark ? OST_PALETTE.light : OST_PALETTE.dark;
    if (pal !== this.pal) {
      this.pal = pal;
      this.clearLabels();
    }
    this.selected = new Set(f.exporting ? [] : f.selection);
    this.onPath = new Set();
    for (const id of this.selected) {
      let n = f.doc.nodes[id];
      while (isOstCard(n)) {
        this.onPath.add(n.id);
        n = n.parentId ? f.doc.nodes[n.parentId] : undefined!;
      }
    }
    if (this.titles.size > 400) {
      for (const [id, v] of this.titles)
        if (!f.doc.nodes[id]) {
          v.p.delete();
          this.titles.delete(id);
        }
    }
  }

  private col(hex: string, alpha = 1) {
    return hexToColor(this.ck, hex, alpha);
  }

  /** One line of text in the board's UI font (cached; colour baked in). */
  private label(text: string, color: string, size: number, weight: number, maxWidth: number, tracking = 0): Paragraph {
    const key = `${text}\u0000${color}\u0000${size}\u0000${weight}\u0000${tracking}\u0000${Math.round(maxWidth)}`;
    let p = this.labels.get(key);
    if (p) return p;
    if (this.labels.size > 600) this.clearLabels();
    const { ck, fonts } = getEngine();
    const style = new ck.ParagraphStyle({
      textStyle: {
        color: this.col(color),
        fontFamilies: FONT,
        fontSize: size,
        fontStyle: { weight: weight >= 600 ? ck.FontWeight.SemiBold : weight >= 500 ? ck.FontWeight.Medium : ck.FontWeight.Normal },
        letterSpacing: tracking,
        heightMultiplier: (size <= 11 ? 14 : 16) / size,
        halfLeading: true,
      },
      maxLines: 1,
      ellipsis: "…",
    });
    const b = ck.ParagraphBuilder.MakeFromFontProvider(style, fonts);
    b.addText(text || " ");
    p = b.build();
    b.delete();
    p.layout(Math.max(1, maxWidth));
    this.labels.set(key, p);
    return p;
  }

  private width(p: Paragraph) {
    return Math.ceil(p.getMaxIntrinsicWidth());
  }

  private rrect(x: number, y: number, w: number, h: number, r: number) {
    return this.ck.RRectXY(this.ck.XYWHRect(x, y, w, h), r, r);
  }

  private tone(t: Tone): { bg: string; ink: string } {
    const p = this.pal;
    switch (t) {
      case "inverse":
        return { bg: p.inverse, ink: p.inverseInk };
      case "selection":
        return { bg: `${p.selection.slice(0, 7)}29`, ink: p.selection };
      case "success":
        return { bg: p.successSubtle, ink: p.success };
      case "warning":
        return { bg: p.warningSubtle, ink: p.warning };
      case "danger":
        return { bg: p.dangerSubtle, ink: p.danger };
      case "ai":
        return { bg: p.aiSubtle, ink: p.ai };
      case "subtle":
        return { bg: "#00000000", ink: p.subtle };
      default:
        return { bg: p.chip, ink: p.chipInk };
    }
  }

  /** A chip: rounded fill, an optional glyph, its text. Returns its width. */
  private chip(canvas: Canvas, x: number, y: number, h: number, text: string, t: Tone, maxW: number, glyph?: (cx: number, cy: number, ink: string) => void, outline = false): number {
    const { bg, ink } = this.tone(t);
    const pad = CARD.chipPad;
    const g = glyph ? CARD.chipGlyph : 0;
    const p = this.label(text, ink, 11, 500, Math.max(8, maxW - pad * 2 - g));
    const w = Math.min(maxW, this.width(p) + pad * 2 + g);
    if (w < 24) return 0;
    this.fill.setColor(this.col(bg));
    canvas.drawRRect(this.rrect(x, y, w, h, 5), this.fill);
    if (outline) {
      this.stroke.setColor(this.col(this.pal.border));
      this.stroke.setStrokeWidth(1);
      canvas.drawRRect(this.rrect(x + 0.5, y + 0.5, w - 1, h - 1, 4.5), this.stroke);
    }
    glyph?.(x + pad + 5, y + h / 2, ink);
    canvas.drawParagraph(p, x + pad + g, y + (h - p.getHeight()) / 2);
    return w;
  }

  // -------------------------------------------------------------------------
  // marks

  /** A kind's mark (◉ ○ ▸ ◇, src/discovery/look.ts), `size` px square around (cx, cy). */
  private kindMark(canvas: Canvas, kind: Kind, cx: number, cy: number, color: string, size: number) {
    let paths = this.marks.get(kind);
    if (!paths) {
      const m = KIND_MARK[kind];
      paths = { stroke: m.stroke ? this.ck.Path.MakeFromSVGString(m.stroke) : null, fill: m.fill ? this.ck.Path.MakeFromSVGString(m.fill) : null };
      this.marks.set(kind, paths);
    }
    const k = size / 12;
    canvas.save();
    canvas.translate(cx - size / 2, cy - size / 2);
    canvas.scale(k, k);
    if (paths.stroke) {
      this.stroke.setColor(this.col(color));
      this.stroke.setStrokeWidth(MARK_STROKE);
      canvas.drawPath(paths.stroke, this.stroke);
    }
    if (paths.fill) {
      this.fill.setColor(this.col(color));
      canvas.drawPath(paths.fill, this.fill);
    }
    canvas.restore();
  }

  /**
   * The kind, as a tag on the card's top edge (TAG in src/discovery/look.ts: half above it, half on
   * the card) in the kind's own colour. Opaque, so the edge doesn't run through it. A sub-goal's is
   * quieter, so the goal above it reads first.
   */
  private kindTag(canvas: Canvas, kind: Kind, label: string, quiet: boolean) {
    const hue = this.pal[KIND_HUE[kind]];
    const tp = this.label(label, hue, TAG.size, TAG.weight, 160, TAG.tracking);
    const x = CARD.pad;
    const y = -TAG.h / 2;
    const w = TAG.pad * 2 + TAG.mark + this.width(tp);
    const body = this.rrect(x, y, w, TAG.h, TAG.radius);
    this.fill.setColor(this.col(this.pal.card));
    canvas.drawRRect(body, this.fill);
    this.fill.setColor(this.col(hue, quiet ? TAG.quietFill : TAG.fill));
    canvas.drawRRect(body, this.fill);
    this.stroke.setColor(this.col(hue, quiet ? TAG.quietEdge : TAG.edge));
    this.stroke.setStrokeWidth(1);
    canvas.drawRRect(this.rrect(x + 0.5, y + 0.5, w - 1, TAG.h - 1, TAG.radius - 0.5), this.stroke);
    this.kindMark(canvas, kind, x + TAG.pad + TAG.markSize / 2, 0, hue, TAG.markSize);
    canvas.drawParagraph(tp, x + TAG.pad + TAG.mark, y + (TAG.h - tp.getHeight()) / 2);
  }

  /** Where its linked work stands, as its tool says it: a quiet tag at the top edge's other end. Returns its left. */
  private workTag(canvas: Canvas, w: number, work: { label: string; tone: "ok" | "warn" | "off" }): number {
    const p = this.pal;
    const ink = work.tone === "ok" ? p.success : work.tone === "warn" ? p.warning : p.subtle;
    const tp = this.label(work.label, p.muted, 10.5, 500, w / 2);
    const tw = 8 + 10 + this.width(tp) + 8;
    const x = w - CARD.pad - tw;
    const y = -CARD.tag / 2;
    this.fill.setColor(this.col(p.card));
    canvas.drawRRect(this.rrect(x, y, tw, CARD.tag, 5), this.fill);
    this.stroke.setColor(this.col(p.lineStrong, 0.55));
    this.stroke.setStrokeWidth(1);
    canvas.drawRRect(this.rrect(x + 0.5, y + 0.5, tw - 1, CARD.tag - 1, 4.5), this.stroke);
    this.fill.setColor(this.col(ink));
    canvas.drawCircle(x + 8 + 3, 0, 3, this.fill);
    canvas.drawParagraph(tp, x + 8 + 10, y + (CARD.tag - tp.getHeight()) / 2);
    return x;
  }

  /** Where the card stands, first in its footer: a dot and the stage's word, no chip around them. */
  private stageMark(canvas: Canvas, card: OstCard, text: string, x: number, y: number, w: number) {
    const p = this.pal;
    const t = STAGE_TONE[card.stage] ?? "neutral";
    const ink = t === "neutral" ? p.muted : t === "subtle" ? p.subtle : t === "inverse" ? p.ink : this.tone(t).ink;
    const cy = y + CARD.chip / 2;
    if (t === "subtle") {
      this.stroke.setColor(this.col(ink));
      this.stroke.setStrokeWidth(1.25);
      canvas.drawCircle(x + 3.5, cy, 2.75, this.stroke);
    } else {
      this.fill.setColor(this.col(t === "neutral" ? p.subtle : ink));
      canvas.drawCircle(x + 3.5, cy, 3, this.fill);
    }
    const tp = this.label(text, ink, 11, 500, Math.max(8, w - CARD.stageDot));
    canvas.drawParagraph(tp, x + CARD.stageDot, cy - tp.getHeight() / 2);
  }

  private poly(canvas: Canvas, pts: number[], paint: Paint) {
    const b = new this.ck.PathBuilder();
    b.addPolygon(pts, true);
    const path = b.detachAndDelete();
    canvas.drawPath(path, paint);
    path.delete();
  }

  /** Qalam AI's pencil, small (src/ui/brand/pencil.ts), its nuqta point filled at this size. */
  private aiGlyph = (cx: number, cy: number, ink: string) => {
    this.fill.setColor(this.col(ink));
    const canvas = this.canvas!;
    const k = 11 / 24;
    const at = (pts: readonly number[]) => pts.map((v, i) => (i % 2 ? cy : cx) + (v - 12) * k);
    for (const poly of [...PENCIL_POLYGONS, NUQTA_POLYGON]) this.poly(canvas, at(poly), this.fill);
  };

  /** A dotted ring: nothing behind it yet. */
  private assumedGlyph = (cx: number, cy: number, ink: string) => {
    const dash = this.ck.PathEffect.MakeDash([1.6, 1.6], 0);
    this.stroke.setColor(this.col(ink));
    this.stroke.setStrokeWidth(1.25);
    this.stroke.setPathEffect(dash);
    this.canvas!.drawCircle(cx, cy, 4.5, this.stroke);
    this.stroke.setPathEffect(null);
    dash?.delete();
  };

  /** “ : words someone said. */
  private quoteGlyph = (cx: number, cy: number, ink: string) => {
    const p = this.label("“", ink, 14, 600, 20);
    this.canvas!.drawParagraph(p, cx - this.width(p) / 2, cy - p.getHeight() / 2 + 2);
  };

  private canvas: Canvas | null = null;

  // -------------------------------------------------------------------------
  // a card

  /** A card's body, its connectors to its showing children, and its fold toggle (card space). */
  drawCard(canvas: Canvas, doc: Doc, n: CardNode, ghost: boolean) {
    const f = this.frame;
    if (!f) return;
    this.canvas = canvas;
    const card = n.meta.ost;
    const p = this.pal;
    const w = n.w;
    const h = n.h;
    const orient = orientationOf(doc, n.id);
    const kids = card.collapsed ? [] : n.children.filter((c) => isOstCard(doc.nodes[c]) && doc.nodes[c].visible);

    // Connectors first, so they tuck under the cards' edges.
    for (const c of kids) {
      const k = doc.nodes[c];
      const hot = this.onPath.has(c);
      this.stroke.setColor(this.col(hot ? p.lineStrong : p.line));
      this.stroke.setStrokeWidth(hot ? 2 : 1.5);
      const b = new this.ck.PathBuilder();
      if (orient === "tb") {
        const mid = h + (k.y - h) / 2;
        b.moveTo(w / 2, h);
        b.lineTo(w / 2, mid);
        b.lineTo(k.x + k.w / 2, mid);
        b.lineTo(k.x + k.w / 2, k.y);
      } else {
        const mid = w + (k.x - w) / 2;
        b.moveTo(w, h / 2);
        b.lineTo(mid, h / 2);
        b.lineTo(mid, k.y + k.h / 2);
        b.lineTo(k.x, k.y + k.h / 2);
      }
      const path = b.detachAndDelete();
      const corner = this.ck.PathEffect.MakeCorner(10);
      this.stroke.setPathEffect(corner);
      canvas.drawPath(path, this.stroke);
      this.stroke.setPathEffect(null);
      corner?.delete();
      path.delete();
    }

    const box = cardBox(card);
    const assumed = isAssumed(card);
    const body = this.rrect(0, 0, w, h, CARD.radius);
    let layer = false;
    if (ghost) {
      const lp = new this.ck.Paint();
      lp.setAlphaf(0.72);
      canvas.saveLayer(lp);
      lp.delete();
      layer = true;
    }
    // Shadow, body, hairline (dashed while Assumed, or while Qalam AI is still writing it).
    this.blur ??= this.ck.MaskFilter.MakeBlur(this.ck.BlurStyle.Normal, 6, true);
    this.shadow.setColor(this.col(p.shadow));
    this.shadow.setMaskFilter(this.blur);
    canvas.save();
    canvas.translate(0, 2);
    canvas.drawRRect(body, this.shadow);
    canvas.restore();
    this.shadow.setMaskFilter(null);
    this.fill.setColor(this.col(p.card));
    canvas.drawRRect(body, this.fill);
    // The footer, a shade apart.
    canvas.save();
    canvas.clipRRect(body, this.ck.ClipOp.Intersect, true);
    this.fill.setColor(this.col(p.footer));
    canvas.drawRect(this.ck.XYWHRect(0, box.ruleY, w, h - box.ruleY), this.fill);
    canvas.restore();
    const dashed = assumed || ghost;
    const dash = dashed ? this.ck.PathEffect.MakeDash([5, 4], 0) : null;
    this.stroke.setColor(this.col(ghost ? p.ai : assumed ? p.subtle : p.border));
    this.stroke.setStrokeWidth(dashed ? 1.25 : 1);
    this.stroke.setPathEffect(dash);
    canvas.drawRRect(this.rrect(0.5, 0.5, w - 1, h - 1, CARD.radius - 0.5), this.stroke);
    this.stroke.setPathEffect(null);
    dash?.delete();
    // A lit top edge on the dark board, as the studio's raised surfaces have.
    if (p.edge) {
      this.stroke.setColor(this.col(p.edge));
      this.stroke.setStrokeWidth(1);
      canvas.drawLine(CARD.radius, 1.5, w - CARD.radius, 1.5, this.stroke);
    }

    const inner = w - CARD.pad * 2;

    // Title (not while it's being typed over).
    if (f.ost?.editingId !== n.id) {
      const empty = !card.title.trim();
      const color = empty ? p.subtle : p.ink;
      const t = titleProps(card);
      const key = `${t.content}\u0000${color}\u0000${inner}\u0000${t.fontSize}`;
      let hit = this.titles.get(n.id);
      if (!hit || hit.key !== key) {
        hit?.p.delete();
        hit = { key, p: buildParagraph(empty ? { ...t, content: placeholderTitle(card.kind) } : t, color, inner) };
        this.titles.set(n.id, hit);
      }
      canvas.save();
      canvas.clipRect(this.ck.XYWHRect(CARD.pad - 2, box.titleY - 2, inner + 4, box.titleH + 4), this.ck.ClipOp.Intersect, true);
      canvas.drawParagraph(hit.p, CARD.pad, box.titleY);
      canvas.restore();
    }

    if (card.kind === "outcome" && box.metricY !== null) this.drawMetric(canvas, card, box.metricY, inner);

    // The footer under its rule: the chips in the rows the layout gave them, the stage at the end.
    this.fill.setColor(this.col(p.border));
    canvas.drawRect(this.ck.XYWHRect(1, box.ruleY, w - 2, 1), this.fill);
    for (const c of box.chips) {
      if (c.glyph === "stage") {
        this.stageMark(canvas, card, c.text, CARD.pad + c.x, box.footerY + c.y, c.w);
        continue;
      }
      const glyph = c.glyph === "assumed" ? this.assumedGlyph : c.glyph === "ai" ? this.aiGlyph : c.glyph === "quote" ? this.quoteGlyph : undefined;
      this.chip(canvas, CARD.pad + c.x, box.footerY + c.y, CARD.chip, c.text, c.tone, c.w, glyph, c.tone === "subtle");
    }

    // Selection and hover: a rounded ring of constant screen width (under the tags on the edge).
    if (!ghost && !f.exporting) {
      const sel = this.selected.has(n.id);
      const hover = f.hoverId === n.id;
      if (sel || hover) {
        const sw2 = (sel ? 2 : 1.5) / f.zoom;
        this.stroke.setColor(this.col(p.selection));
        this.stroke.setStrokeWidth(sw2);
        canvas.drawRRect(this.rrect(-sw2 / 2, -sw2 / 2, w + sw2, h + sw2, CARD.radius + sw2 / 2), this.stroke);
      }
    }

    // On the top edge: the kind on the left; on the right, its linked work and whether something needs a look at it (the card panel says what).
    this.kindTag(canvas, KIND_OF[card.kind], kindLabel(doc, n.id), isSubOutcome(doc, n.id));
    let right = w - CARD.pad;
    const work = !ghost && !f.exporting ? f.ost?.work?.get(n.id) : undefined;
    if (work) right = this.workTag(canvas, w, work) - 6;
    if (!ghost && !f.exporting && f.ost?.noticed?.has(n.id)) {
      this.fill.setColor(this.col(p.card));
      canvas.drawCircle(right - 4, 0, 6, this.fill);
      this.fill.setColor(this.col(p.warning));
      canvas.drawCircle(right - 4, 0, 4, this.fill);
    }

    if (layer) canvas.restore();

    // The fold toggle at the child edge: "+N" while folded, "−" on hover or selection.
    const childCards = n.children.filter((c) => isOstCard(doc.nodes[c]));
    if (childCards.length && !ghost && !f.exporting) {
      const t = foldToggle(n, orient);
      const hot = f.ost?.hoverToggle === n.id;
      if (card.collapsed) {
        const count = countCards(doc, n.id) - 1;
        const tp = this.label(`+${count}`, hot ? p.ink : p.muted, 11, 600, 60);
        const tw = Math.max(t.r * 2, this.width(tp) + 12);
        this.fill.setColor(this.col(p.card));
        canvas.drawRRect(this.rrect(t.x - tw / 2, t.y - t.r, tw, t.r * 2, t.r), this.fill);
        this.stroke.setColor(this.col(hot ? p.lineStrong : p.line));
        this.stroke.setStrokeWidth(1);
        canvas.drawRRect(this.rrect(t.x - tw / 2 + 0.5, t.y - t.r + 0.5, tw - 1, t.r * 2 - 1, t.r - 0.5), this.stroke);
        canvas.drawParagraph(tp, t.x - this.width(tp) / 2, t.y - tp.getHeight() / 2);
      } else if (hot || f.hoverId === n.id || this.selected.has(n.id)) {
        this.fill.setColor(this.col(p.card));
        canvas.drawCircle(t.x, t.y, t.r, this.fill);
        this.stroke.setColor(this.col(hot ? p.lineStrong : p.line));
        this.stroke.setStrokeWidth(1);
        canvas.drawCircle(t.x, t.y, t.r - 0.5, this.stroke);
        this.stroke.setColor(this.col(hot ? p.ink : p.muted));
        this.stroke.setStrokeWidth(1.5);
        canvas.drawLine(t.x - 3.5, t.y, t.x + 3.5, t.y, this.stroke);
      }
    }
    this.canvas = null;
  }

  /**
   * The outcome's number: its name, from → to, and how far it has come, in the goal's colour. With
   * no number yet, the place it goes, dashed, rather than an empty bar.
   */
  private drawMetric(canvas: Canvas, card: OstCard, y: number, inner: number) {
    const p = this.pal;
    const m = card.metric;
    const x = CARD.pad;
    const named = !!m?.name?.trim();
    const nums = m && m.baseline !== null && m.target !== null;
    if (!named && !nums) {
      const dash = this.ck.PathEffect.MakeDash([3, 3], 0);
      this.stroke.setColor(this.col(p.line));
      this.stroke.setStrokeWidth(1);
      this.stroke.setPathEffect(dash);
      canvas.drawRRect(this.rrect(x + 0.5, y + 0.5, inner - 1, METRIC_H - 1, 5.5), this.stroke);
      this.stroke.setPathEffect(null);
      dash?.delete();
      const cy = y + METRIC_H / 2;
      this.stroke.setColor(this.col(p.subtle));
      this.stroke.setStrokeWidth(1.25);
      canvas.drawLine(x + 10, cy, x + 18, cy, this.stroke);
      canvas.drawLine(x + 14, cy - 4, x + 14, cy + 4, this.stroke);
      const lp = this.label("Add the number it moves", p.subtle, 12, 500, inner - 32);
      canvas.drawParagraph(lp, x + 24, cy - lp.getHeight() / 2);
      return;
    }
    const unit = m?.unit ? ` ${m.unit}` : "";
    const right = nums ? `${fmt(m!.baseline!)} → ${fmt(m!.target!)}${unit}` : "No target yet";
    const rp = this.label(right, nums ? p.ink : p.subtle, 12, nums ? 600 : 500, inner / 2);
    const rw = this.width(rp);
    const lp = this.label(named ? m!.name.trim() : "Its number", p.muted, 12, 500, inner - rw - 8);
    canvas.drawParagraph(lp, x, y + (CARD.metricText - lp.getHeight()) / 2);
    canvas.drawParagraph(rp, x + inner - rw, y + (CARD.metricText - rp.getHeight()) / 2);
    const by = y + CARD.metricText + CARD.metricGap;
    this.fill.setColor(this.col(p.chip));
    canvas.drawRRect(this.rrect(x, by, inner, CARD.metricBar, 2), this.fill);
    const k = metricProgress(m);
    if (k !== null && k > 0) {
      this.fill.setColor(this.col(k >= 1 ? p.success : p.kindGoal));
      canvas.drawRRect(this.rrect(x, by, Math.max(4, inner * k), CARD.metricBar, 2), this.fill);
    }
  }
}

/** A card and every card under it (folded or not). */
export function countCards(doc: Doc, id: string): number {
  const n = doc.nodes[id];
  if (!isOstCard(n)) return 0;
  return 1 + n.children.reduce((s, c) => s + countCards(doc, c), 0);
}
