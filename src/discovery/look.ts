import { logoFor } from "@/connectors/logos";
import type { OstKind } from "./types";

/*
 * How cards, sources and wires look on a canvas, said once (pure). Two renderers draw them: a board
 * paints with CanvasKit (src/engine/ost-painter.ts, lane-painter.ts) and the setup's canvas draws
 * HTML over SVG (src/ui/onboarding/SetupCanvas.tsx). Both take their sizes, marks and wires from
 * here. Their colours are theme tokens in src/ui/globals.css (`--color-kind-*`, `--color-card*`,
 * `--color-wire`); the board's palette (src/engine/ost-palette.ts) repeats them, and a test keeps
 * the two the same. A change to the look is a change here or there, never in one renderer alone.
 */

/** What a canvas shows a tag for, each kind in its own colour. */
export type Kind = "goal" | "problem" | "solution" | "test";

export const KIND_OF: Record<OstKind, Kind> = { outcome: "goal", opportunity: "problem", solution: "solution", test: "test" };

/** Each kind's colour, as its theme token. */
export const KIND_TOKEN: Record<Kind, string> = { goal: "--color-kind-goal", problem: "--color-kind-problem", solution: "--color-kind-solution", test: "--color-kind-test" };

/**
 * ◉ ○ ▸ ◇: each kind's mark as SVG paths in a 12-unit box, one stroked (MARK_STROKE wide) and one
 * filled. Shapes, not emoji, so they're crisp at any size.
 */
export const KIND_MARK: Record<Kind, { stroke?: string; fill?: string }> = {
  goal: { stroke: "M6 .75a5.25 5.25 0 1 1 0 10.5a5.25 5.25 0 1 1 0-10.5Z", fill: "M6 3.75a2.25 2.25 0 1 1 0 4.5a2.25 2.25 0 1 1 0-4.5Z" },
  problem: { stroke: "M6 1a5 5 0 1 1 0 10a5 5 0 1 1 0-10Z" },
  solution: { fill: "M2.5 1.5L10.5 6L2.5 10.5Z" },
  test: { stroke: "M6 1L11 6L6 11L1 6Z" },
};
export const MARK_STROKE = 1.5;

/** A card: its corners, its padding, and where its title starts (below its tag's lower half). */
export const CARD_LOOK = { radius: 8, pad: 14, top: 22 } as const;

/**
 * A card's kind, as a tag on its top edge: half above it, `pad` in from the card's left, opaque (the
 * kind's colour at `fill` over the card), a hairline of the kind's colour at `edge`. A quiet tag (a
 * sub-goal, something not settled yet) is fainter.
 */
export const TAG = { h: 20, pad: 7, mark: 16, markSize: 10, radius: 5, size: 11, weight: 600, tracking: 0.1, fill: 0.16, edge: 0.45, quietFill: 0.06, quietEdge: 0.32 } as const;

/** A card's footer: a rule `ruleGap` under what it says, then a shaded band with `pad` above and below its row. */
export const FOOTER = { ruleGap: 14, pad: 10 } as const;

/** Where something stands, at the end of a footer: a dot and a word, no chip around them. */
export const STATE = { dot: 3, room: 12, size: 11, weight: 500 } as const;

/**
 * A source, as a workflow tool draws a step: a square tile with its mark (a connector's logo at
 * `logo`, else an icon at `icon`), a port on the tile's right edge its wires leave from, and under
 * the tile, centred in `w`, its title (up to two lines) and where it's from in mono.
 */
export const SOURCE = { w: 168, tile: 64, radius: 14, logo: 30, icon: 26, port: 4.5, labelGap: 10, titleSize: 12, titleLines: 2, lineSize: 10.5, lineGap: 2, h: 124 } as const;

/** Wires: their widths at rest and lit, the dot where one meets a card, how far a curve reaches, how faint what isn't lit gets. */
export const WIRE = { width: 1.25, lit: 2, dot: 3, reach: 40, enter: 36, dim: 0.3, dimItem: 0.45 } as const;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A source's tile, centred over its words, and the port on its right edge its wires leave from. */
export function sourceTile(it: Pick<Box, "x" | "y" | "w">): { x: number; y: number; s: number; port: { x: number; y: number } } {
  const x = it.x + (it.w - SOURCE.tile) / 2;
  return { x, y: it.y, s: SOURCE.tile, port: { x: x + SOURCE.tile, y: it.y + SOURCE.tile / 2 } };
}

/** Where a wire meets a card (its left edge) or leaves one (its right), level with its title. */
export const wireIn = (b: Box) => ({ x: b.x, y: b.y + Math.min(b.h / 2, WIRE.enter) });
export const wireOut = (b: Box) => ({ x: b.x + b.w, y: b.y + Math.min(b.h / 2, WIRE.enter) });

/** A wire's curve from one point to the next: it leaves and arrives level. Its two control points. */
export function wireCurve(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  const reach = Math.max(WIRE.reach, Math.abs(x2 - x1) / 2);
  return [x1 + reach, y1, x2 - reach, y2];
}

/** The icons a source without a logo shows (Lucide's names). */
export type SourceIcon = "pen-line" | "globe" | "file-text" | "audio-lines";

/**
 * A source's mark, by what it's from (a connector's id, "said", "dump", "page", "url", "computer", a
 * source's kind): the connector's logo, else what it is: their words a pen, a page a globe, a call a
 * waveform, anything else a page of text.
 */
export function sourceMark(mark: string | undefined): { logo: string } | { icon: SourceIcon } {
  const logo = mark ? logoFor(mark) : null;
  if (mark && logo?.kind === "mark") return { logo: mark };
  if (logo?.kind === "audio") return { icon: "audio-lines" };
  if (mark === "said" || mark === "dump") return { icon: "pen-line" };
  if (mark === "page" || mark === "url") return { icon: "globe" };
  return { icon: "file-text" };
}
