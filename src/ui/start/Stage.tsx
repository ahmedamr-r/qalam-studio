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
 */

function Dots({ at, of }: { at: number; of: number }) {
  return (
    <span className="flex items-center gap-[6px]" role="img" aria-label={`Step ${at + 1} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={clsx("size-[6px] rounded-full transition-colors duration-base", i <= at ? "bg-accent" : "bg-fg/15")} />
      ))}
    </span>
  );
}

function Said({ pose, line, size }: { pose: ResearcherPose; line: string; size: number }) {
  return (
    <div className="flex flex-col items-center gap-[12px]">
      <p key={line} className="q-rise relative max-w-[340px] rounded-lg bg-raised px-[14px] py-[10px] text-center text-title text-fg shadow-floating">
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
      <div className="q-shell flex h-screen flex-col overflow-y-auto bg-app text-fg">
        <header className="flex h-(--topbar-h) shrink-0 items-center justify-between pr-[16px]">
          <a href={home} aria-label="Qalam" className={r.brandCell}>
            <QalamMark size={20} />
          </a>
          {dots && <Dots at={dots.at} of={dots.of} />}
        </header>
        <main className="mx-auto grid w-full max-w-[1120px] flex-1 grid-cols-1 content-center items-center gap-[32px] px-[24px] pb-[48px] min-[900px]:grid-cols-[minmax(0,1fr)_380px]">
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
        <Toasts />
      </div>
    </Tooltip.Provider>
  );
}

/** Words of their own, Enter going on. */
export const answerInput = "h-[44px] w-full rounded-lg bg-field px-[12px] text-title text-fg outline-none placeholder:text-fg-faint focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)]";

export const choiceChip = "q-item q-press inline-flex h-[36px] items-center rounded-lg bg-raised px-[14px] text-body font-medium text-fg shadow-button hover:bg-elevated light:hover:bg-muted disabled:opacity-50";
