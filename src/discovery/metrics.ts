import type { TextProps } from "@/doc/schema";
import { measureText } from "@/doc/measure";
import { CARD_WIDTH } from "./kinds";
import { evidenceLabel, isAIIdea, isAssumed } from "./evidence";
import type { OstCard } from "./types";

/*
 * A card's anatomy, shared by the layout (its height) and the painter (where things go), so a
 * card is always exactly as tall as what's drawn on it. Pure: the text measurer is the engine's
 * once it has loaded (fonts), an estimate before that and in tests.
 *
 *   pad ┌──────────────────────────────┐
 *       │ ◉ OUTCOME          [Active] │  kind row
 *       │ Grow weekly reorders         │  title (up to 5 lines)
 *       │ Reorders/week · 1.2 → 1.5    │  metric (outcome)
 *       │ ▬▬▬▬▬▬▬░░░░░░░░              │
 *       │ [❝ From your answers] [3 as… │  footer chips, in rows
 *       └──────────────────────────────┘
 */

export const CARD = {
  pad: 12,
  radius: 10,
  kindRow: 16,
  gap: 8,
  metricText: 16,
  metricBar: 4,
  metricGap: 6,
  footerGap: 10,
  chip: 20,
  chipPad: 6,
  /** Room for a chip's glyph (the quote mark, the Qalam AI nuqta, the Assumed dots). */
  chipGlyph: 14,
  chipGap: 6,
  chipRowGap: 4,
  maxLines: 5,
} as const;

/** The metric block (outcome): a line of text and a progress bar under it. */
export const METRIC_H = CARD.metricText + CARD.metricGap + CARD.metricBar;

const props = new Map<string, TextProps>();

/** The title's text style; one object per (kind, text), so measurements are cached. */
export function titleProps(card: Pick<OstCard, "kind" | "title">): TextProps {
  const outcome = card.kind === "outcome";
  const content = card.title.trim() || placeholderTitle(card.kind);
  const key = `${card.kind}\u0000${content}`;
  let p = props.get(key);
  if (!p) {
    if (props.size > 4000) props.clear();
    p = {
      content,
      fontFamily: "Inter",
      fontSize: outcome ? 15 : 13,
      fontWeight: outcome ? 600 : 500,
      lineHeight: outcome ? 20 : 18,
      letterSpacing: outcome ? -0.15 : 0,
      align: "start",
      direction: "auto",
      autoSize: "height",
      maxLines: CARD.maxLines,
    };
    props.set(key, p);
  }
  return p;
}

export const placeholderTitle = (kind: OstCard["kind"]) =>
  kind === "outcome" ? "Name the outcome" : kind === "opportunity" ? "Describe the need or pain" : kind === "solution" ? "Name the solution" : "Name the test";

export interface Chip {
  text: string;
  tone: "neutral" | "warning" | "ai" | "subtle";
  glyph?: "assumed" | "ai" | "quote";
}

/** Chips along the card's foot: what the card rests on, its assumptions, what's been designed. */
export function footerChips(card: OstCard): Chip[] {
  const out: Chip[] = [];
  const ev = evidenceLabel(card);
  if (ev) {
    if (isAssumed(card)) out.push({ text: ev, tone: "warning", glyph: "assumed" });
    else if (isAIIdea(card)) out.push({ text: ev, tone: "ai", glyph: "ai" });
    else if (card.evidence.length) out.push({ text: ev, tone: "neutral", glyph: "quote" });
    else out.push({ text: ev, tone: "subtle" });
  }
  if (card.kind === "solution") {
    const a = card.assumptions?.length ?? 0;
    if (a) out.push({ text: `${a} ${a === 1 ? "assumption" : "assumptions"}`, tone: "neutral" });
    const d = card.designs?.length ?? 0;
    if (d) out.push({ text: `${d} ${d === 1 ? "design" : "designs"}`, tone: "neutral" });
  }
  if (card.kind === "test" && card.test?.criterion) out.push({ text: "Has a pass mark", tone: "neutral" });
  return out;
}

const chipProps = new Map<string, TextProps>();

/** A chip label's text style (one object per label, so its measurement is cached). */
export function chipTextProps(text: string): TextProps {
  let p = chipProps.get(text);
  if (!p) {
    if (chipProps.size > 400) chipProps.clear();
    p = { content: text, fontFamily: "Inter", fontSize: 11, fontWeight: 500, lineHeight: 14, letterSpacing: 0, align: "start", direction: "auto", autoSize: "width" };
    chipProps.set(text, p);
  }
  return p;
}

export interface PlacedChip extends Chip {
  /** From the footer's top-left. */
  x: number;
  y: number;
  w: number;
}

/** The chips in rows across the card: a chip that doesn't fit beside the last starts a new row. */
export function placeChips(chips: Chip[], width: number): { chips: PlacedChip[]; h: number } {
  const out: PlacedChip[] = [];
  let x = 0;
  let row = 0;
  for (const c of chips) {
    const w = Math.min(width, Math.ceil(measureText(chipTextProps(c.text), null).w) + 1 + CARD.chipPad * 2 + (c.glyph ? CARD.chipGlyph : 0));
    if (x > 0 && x + w > width) {
      row++;
      x = 0;
    }
    out.push({ ...c, x, y: row * (CARD.chip + CARD.chipRowGap), w });
    x += w + CARD.chipGap;
  }
  return { chips: out, h: out.length ? (row + 1) * CARD.chip + row * CARD.chipRowGap : 0 };
}

export interface CardBox {
  w: number;
  h: number;
  titleY: number;
  titleH: number;
  /** Outcome only. */
  metricY: number | null;
  footerY: number | null;
  chips: PlacedChip[];
}

/** Where everything sits on a card, and so its size. */
export function cardBox(card: OstCard): CardBox {
  const w = CARD_WIDTH[card.kind];
  const titleW = w - CARD.pad * 2;
  const t = titleProps(card);
  const lines = Math.max(1, Math.round(measureText(t, titleW).h / t.lineHeight));
  const titleH = Math.min(lines, CARD.maxLines) * t.lineHeight;
  const titleY = CARD.pad + CARD.kindRow + CARD.gap;
  let y = titleY + titleH;
  let metricY: number | null = null;
  if (card.kind === "outcome") {
    metricY = y + CARD.gap;
    y = metricY + METRIC_H;
  }
  let footerY: number | null = null;
  const footer = placeChips(footerChips(card), titleW);
  if (footer.chips.length) {
    footerY = y + CARD.footerGap;
    y = footerY + footer.h;
  }
  return { w, h: Math.ceil(y + CARD.pad), titleY, titleH, metricY, footerY, chips: footer.chips };
}
