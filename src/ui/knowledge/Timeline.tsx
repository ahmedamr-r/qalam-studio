import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Pause, Play } from "lucide-react";
import { stepAt, steps, timelineEvents, trackPos } from "@/knowledge/timeline";
import { IconBtn } from "../controls";
import type { KnowledgeGraph } from "@/knowledge/types";
import { when } from "./labels";

/**
 * Under the graph: when each fact was learned (grey) and each decision made (pink), from the first
 * to now. Dragging back shows the memory as it was then; Play replays it growing. The graph keeps
 * the latest decisions up to that moment and folds older ones in here.
 */

const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `full`: the graph with every decision (no window, no moment), so every moment is on the track. */
export default function Timeline({ full, asOf, setAsOf, earlier, onPick }: { full: KnowledgeGraph; asOf: number | null; setAsOf: (t: number | null) => void; earlier: number; onPick: (ref: string) => void }) {
  const events = useMemo(() => timelineEvents(full), [full]);
  const stepList = useMemo(() => steps(events), [events]);
  const first = events[0]?.at ?? 0;
  const [now] = useState(() => Date.now());
  const last = Math.max(now, events[events.length - 1]?.at ?? now);
  const i = stepAt(stepList, asOf);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    let at = -1;
    setAsOf(stepList[0] ?? null);
    timer.current = setInterval(() => {
      at++;
      if (at >= stepList.length) {
        setPlaying(false);
        setAsOf(null);
        return;
      }
      setAsOf(stepList[at]);
    }, 650);
    return () => clearInterval(timer.current);
    // Replays from the start each time Play is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (!events.length)
    return (
      <div className="flex h-[48px] shrink-0 items-center border-t border-line-subtle bg-panel px-[16px] text-caption text-fg-subtle">
        The timeline fills in as Qalam AI learns and decides. Built-in rules have no date.
      </div>
    );

  const set = (idx: number) => {
    setPlaying(false);
    setAsOf(idx >= stepList.length ? null : stepList[Math.max(0, idx)]);
  };
  const label = asOf === null ? "Now" : new Date(asOf).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const pos = asOf === null ? 1 : trackPos(asOf, first, last);

  return (
    <div className="flex h-[56px] shrink-0 items-center gap-[12px] border-t border-line-subtle bg-panel pr-[16px] pl-[8px]">
      <IconBtn label={playing ? "Stop the replay" : "Replay how the memory grew"} onClick={() => setPlaying((p) => !p)}>
        {playing ? <Pause size={14} {...ico} /> : <Play size={14} {...ico} />}
      </IconBtn>
      <div className="w-[112px] shrink-0">
        <div className="text-caption font-medium text-fg tnum">{label}</div>
        <div className="text-micro text-fg-subtle tnum">{earlier > 0 ? `${earlier} earlier ${earlier === 1 ? "decision" : "decisions"} folded` : plural(events.filter((e) => e.kind === "decision").length, "decision")}</div>
      </div>
      <div className="relative h-[32px] min-w-0 flex-1">
        {/* The track, the part already happened, and the moments on it. */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div className="absolute top-1/2 left-0 h-[2px] -translate-y-1/2 rounded-full bg-fg-subtle" style={{ width: `${pos * 100}%` }} />
        {events.map((e) => {
          const x = trackPos(e.at, first, last) * 100;
          const past = asOf === null || e.at <= asOf;
          return e.kind === "decision" ? (
            <button
              key={e.ref}
              type="button"
              tabIndex={-1}
              title={`${e.label} · ${when(e.at)}`}
              aria-label={`${e.label}, ${when(e.at)}`}
              onClick={() => {
                setPlaying(false);
                setAsOf(e.at === stepList[stepList.length - 1] ? null : e.at);
                onPick(e.ref);
              }}
              className={clsx("absolute top-[4px] size-[8px] -translate-x-1/2 rotate-45 rounded-[1px] transition-opacity", past ? "opacity-100" : "opacity-30")}
              style={{ left: `${x}%`, background: "var(--color-ai)" }}
            />
          ) : (
            <span key={e.ref} aria-hidden className={clsx("absolute bottom-[5px] size-[4px] -translate-x-1/2 rounded-full bg-fg-subtle", !past && "opacity-30")} style={{ left: `${x}%` }} />
          );
        })}
        <input
          type="range"
          min={0}
          max={stepList.length}
          step={1}
          value={i < 0 ? 0 : i}
          onChange={(e) => set(Number(e.target.value))}
          aria-label="Moment in the project's memory"
          aria-valuetext={label}
          className="q-timeline absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <div className="w-[80px] shrink-0 text-right text-micro text-fg-subtle tnum">{when(first)} – now</div>
    </div>
  );
}
