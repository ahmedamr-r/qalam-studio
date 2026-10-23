import type { ReactNode } from "react";
import clsx from "clsx";
import type { RouteStep } from "@/doc/schema";
import { RECIPE_NAMES } from "@/proto/recipes";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { r } from "../../recipes";

/**
 * The session's steps: what the screen does, in the order it was built, numbered like the markers
 * on the device. Picking one starts the prototype where that step begins; the one playing is lit.
 */
export function StepsPanel({
  steps,
  active,
  hover,
  onHover,
  onPick,
  agent,
  onPropose,
  queued = [],
}: {
  steps: RouteStep[];
  active: number | null;
  hover: number | null;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
  /** Qalam AI at work (proposing, building), above the steps. */
  agent?: ReactNode;
  /** Ask Qalam AI what to prototype; absent while it's at work. */
  onPropose?: () => void;
  /** What the brief asked to see on the screen that Generate left for the prototype. */
  queued?: string[];
}) {
  // Waiting for a proposal: while Qalam AI is at work they're in what it proposes.
  const waiting = onPropose && queued.length > 0;
  return (
    <aside aria-label="Steps" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-line-subtle bg-panel">
      <h3 className="flex h-[40px] shrink-0 items-center gap-[6px] pr-[8px] pl-[16px] text-body font-semibold">
        Steps {steps.length > 0 && <span className="font-normal text-fg-subtle">{steps.length}</span>}
        <span className="grow" />
        {onPropose && steps.length > 0 && (
          <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={onPropose}>
            <QalamAIGlyph size={14} /> Propose more
          </button>
        )}
      </h3>
      {agent}
      {waiting && (
        <div className="flex flex-col gap-[4px] px-[16px] pb-[10px]">
          <p className="text-micro text-fg-subtle">From your brief</p>
          <ul className="flex flex-col gap-[2px]">
            {queued.map((a, i) => (
              <li key={i} className="flex gap-[8px] text-caption text-fg" dir="auto">
                <span aria-hidden className="mt-[6px] size-[4px] shrink-0 rounded-full bg-selection" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {steps.length ? (
        <ol className="flex min-h-0 flex-col gap-[2px] overflow-y-auto px-[8px] pb-[12px]">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={active === i ? "step" : undefined}
                onClick={() => onPick(i)}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                className={clsx("flex w-full gap-[10px] rounded-md px-[8px] py-[8px] text-left", active === i ? "bg-selection-subtle" : hover === i ? "bg-hover" : "hover:bg-hover")}
              >
                <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-selection text-micro font-semibold text-white">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-body text-fg">{s.label}</span>
                  <span className="mt-[2px] block text-caption text-fg-subtle">{RECIPE_NAMES[s.recipe] ?? "Rules"}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : onPropose ? (
        <div className="flex flex-col gap-[10px] px-[16px]">
          <p className="text-caption text-fg-muted">
            {waiting
              ? "Generate left these for the prototype: they happen on this screen. Qalam AI proposes how to build them, with what else the screen can do, for you to pick from."
              : "Nothing on this screen is prototyped yet. Qalam AI can propose what to make work — scrolling, picking, the sheets it opens — for you to pick from."}
          </p>
          <button type="button" className={clsx(r.button, r.buttonSecondary, "self-start")} onClick={onPropose}>
            <QalamAIGlyph size={14} /> Propose steps
          </button>
        </div>
      ) : null}
    </aside>
  );
}
