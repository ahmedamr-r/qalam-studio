import { forwardRef, type KeyboardEvent, type MouseEvent } from "react";
import clsx from "clsx";
import { shapeSegments, type BlockKind, type Segment } from "@/discovery/segments";
import type { TextBlock } from "@/discovery/sources";

/*
 * A source's text with its quotes marked in place (the segments from src/discovery/segments.ts),
 * with no store of its own: the board's sources panel and the setup's reader both draw with it.
 * Each segment keeps its position in `data-start`, so a selection can be turned back into one.
 * With the source's shape (`blocks`, a PDF's headings and list items, the segments cut for it) it's
 * drawn as a converter to Markdown would show it: headings, bullets, paragraphs.
 */

const BLOCK: Record<BlockKind, string> = {
  h1: "text-title font-semibold text-fg",
  h2: "text-body font-medium text-fg",
  h3: "text-caption font-semibold text-fg",
  li: "relative pl-[14px] before:absolute before:left-[3px] before:text-fg-subtle before:content-['•']",
  p: "",
};

export const MarkedText = forwardRef<
  HTMLDivElement,
  {
    text: string;
    segments: readonly Segment[];
    /** The quote to ring (and that the reader scrolls to). */
    focus?: string;
    /** A mark's tint, by its quote (default: the selection's). */
    toneOf?: (quote: string) => string | undefined;
    onMouseUp?: (e: MouseEvent<HTMLDivElement>) => void;
    onKeyUp?: (e: KeyboardEvent<HTMLDivElement>) => void;
    /** The source's shape: drawn in blocks (the segments must be cut with it). */
    blocks?: readonly TextBlock[];
    className?: string;
  }
>(function MarkedText({ text, segments, focus, toneOf, onMouseUp, onKeyUp, blocks, className }, ref) {
  const piece = (s: Segment) =>
    s.quote ? (
      <mark key={s.start} data-start={s.start} data-quote={s.quote} className={clsx("rounded-[2px] text-fg", toneOf?.(s.quote) ?? "bg-selection-subtle", s.quote === focus && "shadow-[0_0_0_1px_var(--color-selection)]")}>
        {text.slice(s.start, s.end)}
      </mark>
    ) : (
      <span key={s.start} data-start={s.start}>
        {text.slice(s.start, s.end)}
      </span>
    );
  const page = (n: number) => (
    <span aria-hidden className="mt-[10px] mb-[4px] block text-micro font-medium text-fg-subtle select-none">
      Page {n}
    </span>
  );
  if (blocks?.length)
    return (
      <div ref={ref} onMouseUp={onMouseUp} onKeyUp={onKeyUp} className={clsx("flex flex-col gap-[8px] text-caption leading-[19px] break-words text-fg select-text", className)} dir="auto">
        {shapeSegments(text, segments, blocks).map((b) => (
          <div key={b.segments[0].start}>
            {b.page && page(b.page)}
            <div className={clsx("whitespace-pre-wrap", BLOCK[b.kind], (b.kind === "h1" || b.kind === "h2") && "mt-[4px]")}>{b.segments.map(piece)}</div>
          </div>
        ))}
      </div>
    );
  return (
    <div ref={ref} onMouseUp={onMouseUp} onKeyUp={onKeyUp} className={clsx("text-caption leading-[19px] break-words whitespace-pre-wrap text-fg select-text", className)} dir="auto">
      {segments.map((s) => (
        <span key={s.start}>
          {s.page && page(s.page)}
          {piece(s)}
        </span>
      ))}
    </div>
  );
});
