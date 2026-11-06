import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { QalamMark } from "../brand";
import { Researcher, type ResearcherPose } from "../brand/Researcher";
import { armMotion } from "../motion";
import { r } from "../recipes";
import Toasts from "../toast";

/*
 * The first run's screens: what's asked on one side, the researcher saying a line on the other. No
 * chat and no canvas yet. Under a narrow window the researcher moves above what's asked, smaller.
 * It lies on the Desk as the organizations page does: one glass panel under the shell's bar, and
 * what's in it a quiet sheet (the cards, the chips, the researcher's line), the field solid.
 */

function Dots({ at, of }: { at: number; of: number }) {
  return (
    <span className="flex items-center gap-[6px]" role="img" aria-label={`Step ${at + 1} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={clsx("size-[6px] rounded-full transition-colors duration-base", i <= at ? "bg-fg" : "bg-fg/20")} />
      ))}
    </span>
  );
}

function Said({ pose, line, size }: { pose: ResearcherPose; line: string; size: number }) {
  return (
    <div className="flex flex-col items-center gap-[12px]">
      <p key={line} className="q-sheet q-rise relative max-w-[340px] rounded-xl px-[14px] py-[10px] text-center text-title text-fg">
        {line}
      </p>
      <Researcher pose={pose} size={size} className="q-researcher text-fg" />
    </div>
  );
}

export function Stage({ pose, line, home, dots, title, children, foot }: { pose: ResearcherPose; line: string; home: string; dots?: { at: number; of: number }; title: string; children: ReactNode; foot?: ReactNode }) {
  useEffect(() => {
    armMotion();
    document.title = `${title} · Qalam`;
  }, [title]);
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="q-shell grid h-screen grid-rows-[var(--topbar-h)_minmax(0,1fr)] overflow-hidden bg-app text-fg">
        <header className={clsx(r.shellBar, "justify-between pr-[16px]")} data-region="topbar">
          <a href={home} aria-label="Qalam" className={r.brandCell}>
            <QalamMark size={20} />
          </a>
          {dots && <Dots at={dots.at} of={dots.of} />}
        </header>
        <div className="relative min-h-0 px-[8px] pb-[8px]">
          <div className="q-glass h-full overflow-y-auto rounded-xl bg-app shadow-panel">
            <main className="mx-auto grid min-h-full w-full max-w-[1120px] grid-cols-1 content-center items-center gap-[32px] px-[32px] py-[48px] min-[900px]:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-[900px]:hidden">
                <Said pose={pose} line={line} size={150} />
              </div>
              <div className="flex min-w-0 flex-col gap-[20px]">
                <h1 className="text-hero font-medium text-fg">{title}</h1>
                {children}
                {foot}
              </div>
              <div className="hidden min-[900px]:block">
                <Said pose={pose} line={line} size={340} />
              </div>
            </main>
          </div>
          <Toasts />
        </div>
      </div>
    </Tooltip.Provider>
  );
}

/** Words of their own, Enter going on. */
export const answerInput = "h-[44px] w-full rounded-xl bg-raised px-[14px] text-title text-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)] outline-none transition-shadow duration-fast placeholder:text-fg-faint hover:shadow-[inset_0_0_0_1px_var(--color-line)] focus-visible:shadow-focus-field disabled:opacity-60";

export const choiceChip = "q-sheet q-item q-press inline-flex h-[36px] items-center rounded-lg px-[14px] text-body font-medium text-fg hover:bg-active light:hover:bg-hover disabled:opacity-50";

/** A choice that's a whole card, as the questionnaire's options lie in a panel. */
export const choiceCard = "q-sheet q-item q-press q-press-card flex min-w-0 flex-col gap-[12px] rounded-xl p-[16px] text-left hover:bg-active light:hover:bg-hover";
