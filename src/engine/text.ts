import type { CanvasKit, Paragraph } from "canvaskit-wasm";
import type { TextProps } from "@/doc/schema";
import { getEngine, hexToColor } from "./canvaskit";

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F]/;

/** First strong character decides, like `dir="auto"`. */
export function detectDirection(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return "ltr";
}

export function resolvedDirection(t: TextProps): "ltr" | "rtl" {
  return t.direction === "auto" ? detectDirection(t.content) : t.direction;
}

export function hasArabic(text: string) {
  return RTL_CHAR.test(text);
}

function weightEnum(ck: CanvasKit, w: number) {
  if (w >= 700) return ck.FontWeight.Bold;
  if (w >= 600) return ck.FontWeight.SemiBold;
  if (w >= 500) return ck.FontWeight.Medium;
  return ck.FontWeight.Normal;
}

export function buildParagraph(t: TextProps, color: string, maxWidth: number | null): Paragraph {
  const { ck, fonts } = getEngine();
  const dir = resolvedDirection(t);
  const families = [t.fontFamily, "IBM Plex Sans Arabic", "Inter"];
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: hexToColor(ck, color),
      fontFamilies: families,
      fontSize: t.fontSize,
      fontStyle: { weight: weightEnum(ck, t.fontWeight), ...(t.italic ? { slant: ck.FontSlant.Italic } : {}) },
      letterSpacing: t.letterSpacing,
      heightMultiplier: t.lineHeight > 0 ? t.lineHeight / t.fontSize : undefined,
      halfLeading: true,
      ...(t.decoration
        ? { decoration: t.decoration === "underline" ? ck.UnderlineDecoration : ck.LineThroughDecoration, decorationColor: hexToColor(ck, color), decorationThickness: 1 }
        : {}),
    },
    textAlign: t.align === "center" ? ck.TextAlign.Center : t.align === "end" ? ck.TextAlign.End : t.align === "justify" ? ck.TextAlign.Justify : ck.TextAlign.Start,
    textDirection: dir === "rtl" ? ck.TextDirection.RTL : ck.TextDirection.LTR,
    maxLines: t.maxLines,
    ellipsis: t.maxLines ? "…" : undefined,
  });
  const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, fonts);
  builder.addText(t.content.length ? t.content : "​");
  const p = builder.build();
  builder.delete();
  p.layout(maxWidth ?? 100000);
  return p;
}

export function measureTextProps(t: TextProps, maxWidth: number | null): { w: number; h: number } {
  const p = buildParagraph(t, "#000000", maxWidth);
  const w = maxWidth === null ? p.getMaxIntrinsicWidth() : Math.min(maxWidth, p.getMaxIntrinsicWidth());
  const h = p.getHeight();
  p.delete();
  return { w: Math.max(1, w), h: Math.max(t.lineHeight || t.fontSize, h) };
}
