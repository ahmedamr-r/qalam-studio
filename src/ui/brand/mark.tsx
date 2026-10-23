import clsx from "clsx";
import { NUQTA_PATH, PENCIL_PATH } from "./pencil";

/*
 * Qalam Studio mark: a pencil whose point is a nuqta (src/ui/brand/pencil.ts), filled here; only the
 * Qalam AI glyph shows it hollow. Colour comes from `currentColor` (the top bar uses text-accent).
 */
export function QalamMark({ size = 16, className }: { size?: 16 | 20; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Qalam Studio" className={className}>
      <path fillRule="evenodd" d={PENCIL_PATH} />
      <path d={NUQTA_PATH} />
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
