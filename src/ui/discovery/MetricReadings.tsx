import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { Upload } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { mergeReadings, readingsFromTable, withReadings } from "@/discovery/readings";
import type { OstMetric } from "@/discovery/types";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";

/*
 * An outcome's number over time: a sparkline of its readings (the latest marked, the target as a
 * hairline, the days solutions under it shipped as ticks), a readout that follows the pointer, and
 * every reading as a list. Readings are typed in as the number moves, or read by code from an
 * export (src/discovery/readings.ts): it says which columns it read and what it skipped first.
 */

export interface ShipMark {
  at: number;
  label: string;
}

const H = 56;
const PAD = { x: 6, top: 10, bottom: 12 };
const date = (at: number) => new Date(at).toLocaleDateString("en", { month: "short", day: "numeric", year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const fmt = (v: number, unit?: string) => `${Number.isInteger(v) ? v.toLocaleString("en") : v.toLocaleString("en", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(240);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function MetricReadings({ metric, marks = [], onChange }: { metric: OstMetric; marks?: ShipMark[]; onChange: (m: OstMetric) => void }) {
  const readings = mergeReadings(metric.readings);
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const importFile = async (f: File) => {
    const found = readingsFromTable(await f.text(), { name: metric.name, from: f.name });
    if (!found) {
      feedback(`${f.name} has no column of dates with a column of numbers beside it.`, { kind: "error", id: "metric.import" });
      return;
    }
    const first = found.readings[0];
    const last = found.readings[found.readings.length - 1];
    const order = found.order === "dmy" ? " (dates read day first)" : found.order === "mdy" ? " (dates read month first)" : "";
    const ok = await confirmDialog({
      title: `Add ${found.readings.length} ${found.readings.length === 1 ? "reading" : "readings"}?`,
      body: `From “${found.valueColumn}” by “${found.dateColumn}”${order}, ${date(first.at)} to ${date(last.at)}.${found.skipped ? ` ${found.skipped} ${found.skipped === 1 ? "row" : "rows"} had no date or number there and ${found.skipped === 1 ? "was" : "were"} skipped.` : ""} The latest, ${fmt(last.value, metric.unit)}, becomes the number now; a reading on a day already here replaces it.`,
      confirmLabel: "Add readings",
    });
    if (ok) onChange(withReadings(metric, found.readings));
  };

  const at = (i: number) => readings[i];
  const shown = hover ?? readings.length - 1;
  const chart = readings.length >= 2;
  const t0 = chart ? readings[0].at : 0;
  const t1 = chart ? readings[readings.length - 1].at : 1;
  // Scaled to the readings, so a small move shows; the target is drawn only when it's within reach of them.
  const values = readings.map((x) => x.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  const targetShown = metric.target !== null && chart && metric.target >= lo - span * 0.25 && metric.target <= hi + span * 0.25;
  const x = (t: number) => PAD.x + ((t - t0) / Math.max(1, t1 - t0)) * (w - PAD.x * 2);
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * (H - PAD.top - PAD.bottom);
  const path = readings.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  const nearest = (clientX: number, el: Element) => {
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < readings.length; i++) if (Math.abs(x(readings[i].at) - px) < Math.abs(x(readings[best].at) - px)) best = i;
    return best;
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => setHover(nearest(e.clientX, e.currentTarget));
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    setHover((h) => Math.min(readings.length - 1, Math.max(0, (h ?? readings.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };
  const inRange = marks.filter((m) => chart && m.at >= t0 && m.at <= t1);

  return (
    <div ref={ref} className="flex flex-col gap-[6px]">
      {readings.length > 0 && (
        <p className="flex items-baseline justify-between gap-[8px] text-caption" aria-live="polite">
          <span className="text-fg">
            <span className="font-semibold">{fmt(at(shown).value, metric.unit)}</span>
            <span className="text-fg-muted"> · {date(at(shown).at)}</span>
          </span>
          {metric.target !== null && <span className="text-fg-subtle">Target {fmt(metric.target, metric.unit)}</span>}
        </p>
      )}
      {chart && (
        <div className="w-full">
          <svg
            width={w}
            height={H}
            role="img"
            tabIndex={0}
            aria-label={`${metric.name || "The number"} over time: ${fmt(readings[0].value)} on ${date(t0)} to ${fmt(readings[readings.length - 1].value)} on ${date(t1)}. Arrow keys move between readings.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            className="block touch-none rounded-md outline-none focus-visible:shadow-focus-field"
          >
            {targetShown && <line x1={PAD.x} x2={w - PAD.x} y1={y(metric.target!)} y2={y(metric.target!)} stroke="var(--color-line-strong)" strokeWidth={1} />}
            {inRange.map((m, i) => (
              <g key={i}>
                <title>{`${m.label}, ${date(m.at)}`}</title>
                <line x1={x(m.at)} x2={x(m.at)} y1={H - PAD.bottom + 2} y2={H - 1} stroke="var(--color-fg-subtle)" strokeWidth={2} strokeLinecap="round" />
              </g>
            ))}
            {hover !== null && <line x1={x(at(hover).at)} x2={x(at(hover).at)} y1={PAD.top - 4} y2={H - PAD.bottom} stroke="var(--color-line)" strokeWidth={1} />}
            <path d={path} fill="none" stroke="var(--color-fg-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(at(shown).at)} cy={y(at(shown).value)} r={4} fill="var(--color-accent)" stroke="var(--color-panel)" strokeWidth={2} />
          </svg>
        </div>
      )}
      {inRange.length > 0 && <p className="text-micro text-fg-subtle">Ticks along the bottom: when solutions under it shipped.</p>}
      <div className="flex flex-wrap items-center gap-[6px]">
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <button type="button" onClick={() => file.current?.click()} className={clsx(r.buttonSm, r.buttonSecondary)}>
          <Upload size={12} absoluteStrokeWidth strokeWidth={1.25} /> Import readings…
        </button>
        {readings.length === 0 && <span className="text-micro text-fg-subtle">A CSV of dates and numbers, from your analytics tool. Or type the number in Now as it moves.</span>}
      </div>
      {readings.length > 0 && (
        <details className="text-caption">
          <summary className="cursor-pointer text-fg-muted hover:text-fg">
            {readings.length} {readings.length === 1 ? "reading" : "readings"}
          </summary>
          <ul className="mt-[6px] flex max-h-[160px] flex-col overflow-y-auto">
            {[...readings].reverse().map((p) => (
              <li key={p.at} className="group flex items-center justify-between gap-[8px] py-[2px]">
                <span className="text-fg-muted">{date(p.at)}</span>
                <span className="flex items-center gap-[6px]">
                  <span className="text-fg tnum">{fmt(p.value, metric.unit)}</span>
                  {p.from && <span className="max-w-[90px] truncate text-micro text-fg-subtle" title={`Read from ${p.from}`}>{p.from}</span>}
                  <button type="button" aria-label={`Remove the reading of ${date(p.at)}`} className="hidden text-micro text-fg-subtle hover:text-fg group-hover:inline" onClick={() => onChange({ ...metric, readings: readings.filter((x) => x.at !== p.at) })}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
