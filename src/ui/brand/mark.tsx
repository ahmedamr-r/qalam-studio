import clsx from "clsx";
import { MARK_PATH, MARK_STROKE } from "./geometry";

/* Qalam Studio mark: a q in one stroke (./geometry.ts). Colour comes from `currentColor` (the top bar uses text-mark). */
export function QalamMark({ size = 16, className }: { size?: 16 | 20; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Qalam Studio" className={className}>
      <path d={MARK_PATH} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Wordmark: the main-menu trigger's content. The mark sits in the rail-axis cell, not inside this. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-baseline gap-[4px] text-title tracking-[-0.02em]", className)}>
      <b className="font-semibold text-fg">Qalam</b>
      <span className="font-medium text-fg-subtle">Studio</span>
    </span>
  );
}
