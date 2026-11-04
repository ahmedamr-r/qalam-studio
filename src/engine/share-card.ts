import type { Paragraph } from "canvaskit-wasm";
import { hexToColor, loadEngine } from "./canvaskit";
import { OST_PALETTE } from "./ost-palette";

/*
 * A scan's findings as a picture to post: drawn with CanvasKit as the board's cards are, so Arabic
 * shapes and mixed text lays out right. Always light, as exports are. What doesn't fit is left out
 * whole, never cut off: a quote is either on the card as it was said, or not on it.
 */

export const CARD = { w: 1200, h: 675, pad: 64, gap: 28, indent: 20 } as const;

export interface CardInput {
  title: string;
  quotes: readonly { text: string; from: string }[];
  /** How much was read, along the bottom. */
  foot: string;
}

const FONT = ["Inter", "IBM Plex Sans Arabic"];
const isRtl = (s: string) => /^[^\p{L}]*[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(s);

/** The card as PNG bytes, or null when the engine can't make a surface here. */
export async function shareCardPng(c: CardInput): Promise<Uint8Array | null> {
  const { ck, fonts } = await loadEngine();
  const pal = OST_PALETTE.light;
  const surface = ck.MakeSurface(CARD.w, CARD.h);
  if (!surface) return null;
  const made: Paragraph[] = [];
  const para = (text: string, o: { size: number; weight?: number; color: string; lines: number; line: number; rtl?: boolean; width?: number }) => {
    const b = ck.ParagraphBuilder.MakeFromFontProvider(
      new ck.ParagraphStyle({
        textStyle: { color: hexToColor(ck, o.color), fontFamilies: FONT, fontSize: o.size, fontStyle: { weight: (o.weight ?? 400) >= 600 ? ck.FontWeight.SemiBold : ck.FontWeight.Normal }, heightMultiplier: o.line / o.size, halfLeading: true },
        textDirection: (o.rtl ?? isRtl(text)) ? ck.TextDirection.RTL : ck.TextDirection.LTR,
        textAlign: ck.TextAlign.Start,
        maxLines: o.lines,
        ellipsis: "…",
      }),
      fonts,
    );
    b.addText(text);
    const p = b.build();
    b.delete();
    p.layout(o.width ?? CARD.w - CARD.pad * 2);
    made.push(p);
    return p;
  };
  try {
    const canvas = surface.getCanvas();
    canvas.clear(hexToColor(ck, "#FFFFFF"));
    const left = CARD.pad;
    let y = CARD.pad;

    const title = para(c.title, { size: 46, weight: 600, color: pal.ink, lines: 3, line: 56 });
    canvas.drawParagraph(title, left, y);
    y += title.getHeight() + CARD.gap;

    const foot = para(c.foot, { size: 24, color: pal.muted, lines: 1, line: 32 });
    const mark = para("Qalam Studio", { size: 24, weight: 600, color: pal.muted, lines: 1, line: 32 });
    const bottom = CARD.h - CARD.pad - foot.getHeight();

    const rule = new ck.Paint();
    rule.setColor(hexToColor(ck, pal.border));
    rule.setStrokeWidth(3);
    rule.setStyle(ck.PaintStyle.Stroke);
    for (const q of c.quotes) {
      // Where it came from sits under its quote, on the side the quote reads from.
      const rtl = isRtl(q.text);
      const width = CARD.w - CARD.pad * 2 - CARD.indent;
      const words = para(`“${q.text}”`, { size: 32, color: pal.ink, lines: 3, line: 42, rtl, width });
      const from = para(q.from, { size: 24, color: pal.muted, lines: 1, line: 32, rtl, width });
      const h = words.getHeight() + from.getHeight();
      // A quote that doesn't fit stays off the card, whole, and so do the ones after it.
      if (y + h > bottom - CARD.gap || words.didExceedMaxLines()) break;
      const x = rtl ? CARD.w - left : left;
      canvas.drawLine(x, y + 6, x, y + h - 6, rule);
      const at = rtl ? left : left + CARD.indent;
      canvas.drawParagraph(words, at, y);
      canvas.drawParagraph(from, at, y + words.getHeight());
      y += h + CARD.gap;
    }
    rule.delete();

    canvas.drawParagraph(foot, left, bottom);
    canvas.drawParagraph(mark, CARD.w - CARD.pad - mark.getMaxIntrinsicWidth() - 2, bottom);
    surface.flush();
    const img = surface.makeImageSnapshot();
    const bytes = img.encodeToBytes();
    img.delete();
    return bytes;
  } finally {
    for (const p of made) p.delete();
    surface.delete();
  }
}
