import type { OstKind } from "@/discovery/types";

/** ◉ ○ ▸ ◇: a card's kind, drawn as on the board (12px, current colour). */
export default function KindMark({ kind, size = 12, className }: { kind: OstKind; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className={className ?? "shrink-0 text-fg-muted"}>
      {kind === "outcome" && (
        <>
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        </>
      )}
      {kind === "opportunity" && <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {kind === "solution" && <path d="M3 1.75 10 6 3 10.25Z" fill="currentColor" />}
      {kind === "test" && <path d="M6 1.25 10.75 6 6 10.75 1.25 6Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
    </svg>
  );
}
