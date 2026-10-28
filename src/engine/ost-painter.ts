import type { Canvas, CanvasKit, MaskFilter, Paint, Paragraph } from "canvaskit-wasm";
import type { Doc } from "@/doc/schema";
import { type CardNode, isOstCard } from "@/doc/board";
import type { Pt } from "@/doc/geometry";
import { CARD, cardBox, placeholderTitle, titleProps } from "@/discovery/metrics";
import { foldToggle, isSubOutcome, kindLabel, orientationOf } from "@/discovery/tree";
import { stageLabel } from "@/discovery/kinds";
import { isAssumed } from "@/discovery/evidence";
import { NUQTA_POLYGON, PENCIL_POLYGONS } from "@/ui/brand/pencil";
import type { OstCard, OstKind } from "@/discovery/types";
import { getEngine, hexToColor } from "./canvaskit";
import { buildParagraph } from "./text";
import { OST_PALETTE, type OstPalette } from "./ost-palette";

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

const FONT = ["Inter", "IBM Plex Sans Arabic"];
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100));

export class OstPainter {
  private fill: Paint;
  private stroke: Paint;
  private shadow: Paint;
  private blur: MaskFilter | null = null;
  private titles = new Map<string, { key: string; p: Paragraph }>();
  private labels = new Map<string, Paragraph>();
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

  /** ◉ ○ ▸ ◇: the kind of a card, 12 px around (cx, cy). Shapes, not emoji, so they're crisp at any zoom. */
  private kindMark(canvas: Canvas, kind: OstKind, cx: number, cy: number, color: string) {
    const c = this.col(color);
    this.fill.setColor(c);
    this.stroke.setColor(c);
    this.stroke.setStrokeWidth(1.5);
    if (kind === "outcome") {
      canvas.drawCircle(cx, cy, 5.25, this.stroke);
      canvas.drawCircle(cx, cy, 2.25, this.fill);
    } else if (kind === "opportunity") canvas.drawCircle(cx, cy, 5, this.stroke);
    else if (kind === "solution") this.poly(canvas, [cx - 3.5, cy - 4.5, cx + 4.5, cy, cx - 3.5, cy + 4.5], this.fill);
    else this.poly(canvas, [cx, cy - 5, cx + 5, cy, cx, cy + 5, cx - 5, cy], this.stroke);
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
    const dashed = assumed || ghost;
    const dash = dashed ? this.ck.PathEffect.MakeDash([5, 4], 0) : null;
    this.stroke.setColor(this.col(ghost ? p.ai : assumed ? p.subtle : p.border));
    this.stroke.setStrokeWidth(dashed ? 1.25 : 1);
    this.stroke.setPathEffect(dash);
    canvas.drawRRect(this.rrect(0.5, 0.5, w - 1, h - 1, CARD.radius - 0.5), this.stroke);
    this.stroke.setPathEffect(null);
    dash?.delete();

    const inner = w - CARD.pad * 2;
    // Kind row: mark, label, stage on the right.
    const stage = stageLabel(card.kind, card.stage);
    const st = this.tone(STAGE_TONE[card.stage] ?? "neutral");
    const sp = this.label(stage, st.ink, 11, 500, inner / 2);
    const sw = Math.min(inner / 2, this.width(sp) + 12);
    const sx = w - CARD.pad - sw;
    this.fill.setColor(this.col(st.bg));
    canvas.drawRRect(this.rrect(sx, CARD.pad - 1, sw, 18, 5), this.fill);
    canvas.drawParagraph(sp, sx + 6, CARD.pad - 1 + (18 - sp.getHeight()) / 2);
    // Something needs a look at it (the card panel says what): a dot beside the stage.
    if (!ghost && !f.exporting && f.ost?.noticed?.has(n.id)) {
      this.fill.setColor(this.col(p.warning));
      canvas.drawCircle(sx - 8, CARD.pad - 1 + 9, 3.5, this.fill);
    }
    // A sub-outcome's mark is muted, so the goal above it reads first.
    this.kindMark(canvas, card.kind, CARD.pad + 6, CARD.pad + CARD.kindRow / 2, card.kind === "outcome" && !isSubOutcome(doc, n.id) ? p.ink : p.muted);
    const kp = this.label(kindLabel(doc, n.id).toUpperCase(), p.muted, 10.5, 600, Math.max(10, sx - CARD.pad - 24), 0.6);
    canvas.drawParagraph(kp, CARD.pad + 18, CARD.pad + (CARD.kindRow - kp.getHeight()) / 2);

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

    // Footer chips, in the rows the layout gave them.
    if (box.footerY !== null) {
      for (const c of box.chips) {
        const glyph = c.glyph === "assumed" ? this.assumedGlyph : c.glyph === "ai" ? this.aiGlyph : c.glyph === "quote" ? this.quoteGlyph : undefined;
        this.chip(canvas, CARD.pad + c.x, box.footerY + c.y, CARD.chip, c.text, c.tone, c.w, glyph, c.tone === "subtle");
      }
    }

    if (layer) canvas.restore();

    // Selection and hover: a rounded ring of constant screen width.
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

  /** The outcome's number: its name, from → to, and how far it has come. */
  private drawMetric(canvas: Canvas, card: OstCard, y: number, inner: number) {
    const p = this.pal;
    const m = card.metric;
    const x = CARD.pad;
    const nums = m && m.baseline !== null && m.target !== null;
    const unit = m?.unit ? ` ${m.unit}` : "";
    const right = nums ? `${fmt(m!.baseline!)} → ${fmt(m!.target!)}${unit}` : "";
    const rp = right ? this.label(right, p.ink, 12, 600, inner / 2) : null;
    const rw = rp ? this.width(rp) : 0;
    const named = !!m?.name?.trim();
    const lp = this.label(named ? m!.name.trim() : "Add the metric it moves", named ? p.muted : p.subtle, 12, 500, inner - rw - 8);
    canvas.drawParagraph(lp, x, y + (CARD.metricText - lp.getHeight()) / 2);
    if (rp) canvas.drawParagraph(rp, x + inner - rw, y + (CARD.metricText - rp.getHeight()) / 2);
    const by = y + CARD.metricText + CARD.metricGap;
    this.fill.setColor(this.col(p.chip));
    canvas.drawRRect(this.rrect(x, by, inner, CARD.metricBar, 2), this.fill);
    if (nums && m!.current !== null && m!.target !== m!.baseline) {
      const k = Math.max(0, Math.min(1, (m!.current! - m!.baseline!) / (m!.target! - m!.baseline!)));
      if (k > 0) {
        this.fill.setColor(this.col(k >= 1 ? p.success : p.ink));
        canvas.drawRRect(this.rrect(x, by, Math.max(4, inner * k), CARD.metricBar, 2), this.fill);
      }
    }
  }
}

/** A card and every card under it (folded or not). */
export function countCards(doc: Doc, id: string): number {
  const n = doc.nodes[id];
  if (!isOstCard(n)) return 0;
  return 1 + n.children.reduce((s, c) => s + countCards(doc, c), 0);
}
