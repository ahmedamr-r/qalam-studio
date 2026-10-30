import { forwardRef, type KeyboardEvent, type MouseEvent } from "react";
import clsx from "clsx";
import type { Segment } from "@/discovery/segments";

/*
 * A source's text with its quotes marked in place (the segments from src/discovery/segments.ts),
 * with no store of its own: the board's sources panel and the setup's reader both draw with it.
 * Each segment keeps its position in `data-start`, so a selection can be turned back into one.
 */

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
    className?: string;
  }
>(function MarkedText({ text, segments, focus, toneOf, onMouseUp, onKeyUp, className }, ref) {
  return (
    <div ref={ref} onMouseUp={onMouseUp} onKeyUp={onKeyUp} className={clsx("text-caption leading-[19px] break-words whitespace-pre-wrap text-fg select-text", className)} dir="auto">
      {segments.map((s) => (
        <span key={s.start}>
          {s.page && (
            <span aria-hidden className="mt-[10px] mb-[4px] block text-micro font-medium text-fg-subtle select-none">
              Page {s.page}
            </span>
          )}
          {s.quote ? (
            <mark data-start={s.start} data-quote={s.quote} className={clsx("rounded-[2px] text-fg", toneOf?.(s.quote) ?? "bg-selection-subtle", s.quote === focus && "shadow-[0_0_0_1px_var(--color-selection)]")}>
              {text.slice(s.start, s.end)}
            </mark>
          ) : (
            <span data-start={s.start}>{text.slice(s.start, s.end)}</span>
          )}
        </span>
      ))}
    </div>
  );
});
