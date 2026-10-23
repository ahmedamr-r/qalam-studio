"use client";

import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";
import { bootEngine } from "@/engine/boot";
import { Renderer } from "@/engine/renderer";
import type { InterviewStage } from "@/projects/interview";
import type { Project } from "@/projects/model";
import { QalamMark } from "../brand";
import { Tag } from "../controls";
import { DialogHost } from "../surfaces/dialog";
import { setExportRenderer } from "../exporter";
import { BriefStep } from "./BriefStep";
import { ComponentsStep } from "./ComponentsStep";
import { DirectionsStep } from "./DirectionsStep";
import { ReadBackStep } from "./ReadBackStep";
import { RefineStep } from "./RefineStep";
import { flushInterview, openInterview, update, useInterview } from "./store";

/**
 * The brand interview of a design-system project, full screen and without the canvas: the brief,
 * what Qalam AI heard, three directions, then refining one on real screens. Previews are drawn by
 * an offscreen renderer (no canvas on this page).
 */

const STEPS: { stage: Exclude<InterviewStage, "saved">; label: string }[] = [
  { stage: "brief", label: "Brief" },
  { stage: "read", label: "What I heard" },
  { stage: "directions", label: "Directions" },
  { stage: "refine", label: "Refine" },
  { stage: "components", label: "Components" },
];

let renderer: Renderer | null = null;
/** CanvasKit, Yoga and a renderer that draws previews off screen. */
function useOffscreenRenderer() {
  useEffect(() => {
    void bootEngine().then(() => {
      renderer ??= new Renderer(document.createElement("canvas"));
      setExportRenderer(renderer);
    });
  }, []);
}

export default function InterviewApp({ project }: { project: Project }) {
  useEffect(() => openInterview(project), [project]);
  useOffscreenRenderer();
  const stage = useInterview((s) => s.state.stage);
  const ready = useInterview((s) => s.project?.id === project.id);
  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="flex h-screen flex-col bg-app text-fg">
        <Header />
        <main className="min-h-0 flex-1">
          {ready && stage === "brief" && <BriefStep />}
          {ready && stage === "read" && <ReadBackStep />}
          {ready && stage === "directions" && <DirectionsStep />}
          {ready && stage === "components" && <ComponentsStep />}
          {/* "saved" here means the system went missing (deleted elsewhere): refine and save again. */}
          {ready && (stage === "refine" || stage === "saved") && <RefineStep />}
        </main>
      </div>
      <DialogHost />
    </Tooltip.Provider>
  );
}

function Header() {
  const name = useInterview((s) => s.project?.name ?? "");
  const state = useInterview((s) => s.state);
  const reachable = (st: InterviewStage) =>
    st === "brief" || (st === "read" && !!state.read) || (st === "directions" && !!state.directions) || ((st === "refine" || st === "components") && !!state.knobs);
  const at = STEPS.findIndex((s) => s.stage === state.stage);
  const home = async () => {
    await flushInterview();
    window.location.assign("/");
  };
  return (
    <header className="flex h-[48px] shrink-0 items-center gap-[12px] border-b border-line-subtle px-[12px] lg:grid lg:grid-cols-[1fr_auto_1fr]">
      <div className="flex min-w-0 flex-1 items-center gap-[8px] text-body">
        <button type="button" onClick={() => void home()} aria-label="Back to projects" className="q-item grid size-[32px] place-items-center rounded-md text-accent hover:bg-hover">
          <QalamMark size={20} />
        </button>
        <button type="button" onClick={() => void home()} className="q-item hidden rounded-md px-[6px] py-[4px] text-fg-subtle hover:bg-hover hover:text-fg-muted md:inline">
          Projects
        </button>
        <span aria-hidden className="hidden text-fg-faint md:inline">
          /
        </span>
        <span className="truncate font-medium">{name}</span>
        {state.sample && <Tag>Sample</Tag>}
      </div>
      <nav aria-label="Interview steps" className="shrink-0">
        <ol className="flex items-center gap-[4px]">
          {STEPS.map((s, i) => {
            const can = reachable(s.stage) && s.stage !== state.stage;
            return (
              <li key={s.stage} className="flex items-center gap-[4px]">
                {i > 0 && <span aria-hidden className="hidden h-px w-[16px] bg-line md:block" />}
                <button
                  type="button"
                  disabled={!can}
                  aria-current={s.stage === state.stage ? "step" : undefined}
                  onClick={() => update((st) => ({ ...st, stage: s.stage }))}
                  className={clsx(
                    "q-item flex h-[28px] items-center gap-[6px] rounded-md px-[8px] text-caption font-medium",
                    s.stage === state.stage ? "bg-active text-fg" : can ? "text-fg-muted hover:bg-hover hover:text-fg" : "text-fg-faint",
                  )}
                >
                  <StepDot n={i + 1} done={i < at} />
                  <span className={s.stage === state.stage ? "" : "hidden xl:inline"}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="hidden lg:block" />
    </header>
  );
}

function StepDot({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={clsx("grid size-[16px] place-items-center rounded-full text-micro tnum", done ? "bg-success-subtle text-success" : "bg-hover text-fg-subtle")}>
      {done ? <Check size={10} strokeWidth={2} /> : n}
    </span>
  );
}

/** A step's heading: what it is, and what to do. */
export function StepHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-micro font-medium uppercase tracking-[0.06em] text-fg-subtle">{eyebrow}</p>
      <h1 className="text-heading font-semibold text-fg">{title}</h1>
      {children && <p className="max-w-[60ch] text-body text-fg-muted">{children}</p>}
    </div>
  );
}
