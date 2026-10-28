import clsx from "clsx";

/*
 * Small marks that show an amount or a state in place of a sentence: a meter for how strong, a
 * sparkline for how it grew, dots for how many sources, a dot for a status. Neutral by default
 * (saffron is for Generate only); a status dot takes the semantic tones.
 */

/** How full something is (0–1), as a short bar. */
export function Meter({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(v.toFixed(2))} className={clsx("relative block h-[6px] overflow-hidden rounded-full bg-active", className)}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-fg-muted" style={{ width: `${v * 100}%` }} />
    </span>
  );
}

/** Counts over time, oldest first, as a line; the last point is marked. All zero: a faint flat line. */
export function Sparkline({ values, label, width = 56, height = 16 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(...values, 0);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, max ? height - 2 - (v / max) * (height - 4) : height - 2] as const);
  const last = pts[pts.length - 1];
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={clsx("shrink-0", max ? "text-fg-subtle" : "text-fg-faint")}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      {last && max > 0 && <circle cx={last[0]} cy={last[1]} r={1.75} fill="currentColor" />}
    </svg>
  );
}

/** How many of `of` (up to five dots; more shows as five). */
export function Dots({ count, of = 5, label }: { count: number; of?: number; label: string }) {
  const n = Math.min(of, count);
  return (
    <span role="img" aria-label={label} className="inline-flex shrink-0 items-center gap-[2px]">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={clsx("size-[5px] rounded-full", i < n ? "bg-fg-muted" : "bg-line")} />
      ))}
    </span>
  );
}

export type Tone = "ok" | "warn" | "bad" | "off" | "on";

const TONE: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", bad: "bg-danger", off: "bg-fg-faint", on: "bg-fg" };

/** A status in one dot (a word beside it says which). `hollow`: the ring of something that isn't there yet. */
export function StatusDot({ tone, hollow, className }: { tone: Tone; hollow?: boolean; className?: string }) {
  return <span aria-hidden className={clsx("inline-block size-[7px] shrink-0 rounded-full", hollow ? "shadow-[inset_0_0_0_1.25px_var(--color-fg-subtle)]" : TONE[tone], className)} />;
}
