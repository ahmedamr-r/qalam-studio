import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { QalamMark } from "../brand";
import { Researcher, type ResearcherPose } from "../brand/Researcher";
import { armMotion } from "../motion";
import { r } from "../recipes";
import Toasts from "../toast";

/*
 * The first run's page: one column in the middle of a glass panel on the Desk, as the organizations
 * page lies, with the researcher small above it saying a line beside it, as a chat's avatar does.
 * No chat and no canvas yet.
 */

function Beside({ pose, line }: { pose: ResearcherPose; line: string }) {
  return (
    <div className="flex items-end justify-center gap-[10px]">
      <Researcher pose={pose} size={104} className="q-researcher shrink-0 text-fg" />
      <p key={line} className="q-sheet q-rise mb-[30px] max-w-[300px] rounded-xl rounded-bl-[4px] px-[14px] py-[10px] text-body text-fg">
        {line}
      </p>
    </div>
  );
}

export function Stage({ pose, line, home, title, about, children }: { pose: ResearcherPose; line: string; home: string; title: string; /** A line under the title. */ about?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    armMotion();
    document.title = `${title} · Qalam`;
  }, [title]);
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="q-shell grid h-screen grid-rows-[var(--topbar-h)_minmax(0,1fr)] overflow-hidden bg-app text-fg">
        <header className={clsx(r.shellBar)} data-region="topbar">
          <a href={home} aria-label="Qalam" className={r.brandCell}>
            <QalamMark size={20} />
          </a>
        </header>
        <div className="relative min-h-0 px-[8px] pb-[8px]">
          <div className="q-glass h-full overflow-y-auto rounded-xl bg-app shadow-panel">
            <main className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center gap-[20px] px-[24px] pb-[14vh] pt-[40px]">
              <Beside pose={pose} line={line} />
              <div className="flex flex-col items-center gap-[6px] text-center">
                <h1 className="text-hero font-medium text-fg">{title}</h1>
                {about && <p className="text-title text-fg-muted">{about}</p>}
              </div>
              {children}
            </main>
          </div>
          <Toasts />
        </div>
      </div>
    </Tooltip.Provider>
  );
}

/** A suggestion under the box, a quiet sheet on the panel. */
export const choiceChip = "q-sheet q-item q-press inline-flex h-[32px] items-center rounded-lg px-[12px] text-body font-medium text-fg hover:bg-active light:hover:bg-hover disabled:opacity-50";
