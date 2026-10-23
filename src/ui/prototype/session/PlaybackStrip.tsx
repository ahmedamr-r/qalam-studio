import clsx from "clsx";
import { Pause, Play } from "lucide-react";
import { RECIPE_NAMES } from "@/proto/recipes";
import type { Clip } from "@/proto/walk";
import { r } from "../../recipes";

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * The playback strip: the screen's steps as clips in a row. Play performs them on the live
 * prototype with the cursor, one after another; picking a clip starts the prototype where it
 * begins. The playing clip fills as its moves go by.
 */
export function PlaybackStrip({
  clips,
  at,
  onPlay,
  onPause,
  onPick,
}: {
  clips: Clip[];
  at: { clip: number; action: number } | null;
  onPlay: () => void;
  onPause: () => void;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex h-[56px] shrink-0 items-center gap-[12px] border-t border-line-subtle bg-panel px-[16px]" aria-label="Playback">
      <button type="button" className={clsx(r.button, r.buttonSecondary, "w-[88px] justify-center")} onClick={at ? onPause : onPlay} disabled={!clips.length}>
        {at ? <Pause {...ICON} /> : <Play {...ICON} />} {at ? "Pause" : "Play"}
      </button>
      <ol className="flex min-w-0 flex-1 gap-[4px]">
        {clips.map((c, i) => {
          const on = at?.clip === i;
          const done = !!at && i < at.clip;
          const fill = on ? (at.action + 1) / Math.max(1, c.actions.length) : done ? 1 : 0;
          return (
            <li key={c.step.id} className="min-w-0 flex-1">
              <button
                type="button"
                title={c.step.label}
                aria-current={on ? "step" : undefined}
                onClick={() => onPick(i)}
                className={clsx("relative flex h-[32px] w-full items-center gap-[6px] overflow-hidden rounded-md px-[8px] text-caption", on ? "bg-selection-subtle text-fg" : "bg-hover text-fg-muted hover:text-fg")}
              >
                <span className="font-semibold">{i + 1}</span>
                <span className="truncate">{RECIPE_NAMES[c.step.recipe] ?? c.step.label}</span>
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-selection transition-transform duration-300" style={{ transform: `scaleX(${fill})` }} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
