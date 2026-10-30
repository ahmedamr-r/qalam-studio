import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { SeenFlow, SeenMove, SeenScreen } from "@/seen/types";
import { Shot } from "./Shot";

/*
 * A flow as a row of its screens in order, the control that leads on written between each two (as
 * the screen shows it), and the branches off the way under the row. The screens are the person's
 * screenshots; a click opens one.
 */

export function moveLabel(m: SeenMove | undefined): string {
  if (!m) return "";
  if (m.via) return m.via;
  return m.how === "back" ? "back" : m.how === "system" ? "by itself" : m.how === "swipe" ? "swipe" : m.how === "type" ? "typing" : "?";
}

export function FlowStrip({ flow, screens, w = 64, onScreen }: { flow: SeenFlow; screens: Map<string, SeenScreen>; w?: number; onScreen?: (key: string) => void }) {
  const along = new Set(flow.steps.slice(1).map((s, k) => `${flow.steps[k]}>${s}`));
  const branches = flow.moves.filter((m) => !along.has(`${m.from}>${m.to}`));
  return (
    <div className="flex flex-col gap-[6px]">
      <ol className="flex items-start gap-[4px] overflow-x-auto pb-[4px]" aria-label={`${flow.name}, step by step`}>
        {flow.steps.map((key, k) => {
          const s = screens.get(key);
          const move = k > 0 ? flow.moves.find((m) => m.from === flow.steps[k - 1] && m.to === key) : undefined;
          return (
            <li key={`${key}-${k}`} className="flex shrink-0 items-start gap-[4px]">
              {k > 0 && (
                <span className="flex flex-col items-center gap-[2px] pt-[24px]" style={{ width: Math.max(44, Math.min(96, moveLabel(move).length * 6 + 16)) }}>
                  <span className={clsx("max-w-full truncate text-micro", move?.via ? "font-medium text-fg-muted" : "text-fg-faint")} title={moveLabel(move)} dir="auto">
                    {moveLabel(move)}
                  </span>
                  <ArrowRight size={12} className="text-fg-subtle" />
                </span>
              )}
              <span className="flex flex-col gap-[4px]" style={{ width: w }}>
                {s ? (
                  onScreen ? (
                    <button type="button" onClick={() => onScreen(key)} className="q-item rounded-md" aria-label={`Open ${s.name}`}>
                      <Shot shot={s.shots[0]} label={s.name} w={w} open={false} />
                    </button>
                  ) : (
                    <Shot shot={s.shots[0]} label={s.name} w={w} />
                  )
                ) : (
                  <span className="block rounded-md bg-active" style={{ width: w, height: Math.round(w * 2.1) }} />
                )}
                <span className="truncate text-micro text-fg" title={s?.name} dir="auto">
                  {s?.name ?? key}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {branches.length > 0 && (
        <ul className="flex flex-col gap-[2px]">
          {branches.map((m) => (
            <li key={`${m.from}>${m.to}`} className="text-caption text-fg-muted" dir="auto">
              From {screens.get(m.from)?.name ?? m.from}, {m.via ? <span className="font-medium text-fg">“{m.via}”</span> : moveLabel(m)} goes to {screens.get(m.to)?.name ?? m.to}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
