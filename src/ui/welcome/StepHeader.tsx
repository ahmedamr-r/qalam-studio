import clsx from "clsx";
import { Check } from "lucide-react";
import { stepStates, WELCOME_STEPS, type WelcomeStep } from "./steps";

/** The welcome's four steps in a row, the one being done marked; shared with the setup page's first run. */
export function StepHeader({ at }: { at: WelcomeStep }) {
  const states = stepStates(at);
  return (
    <ol aria-label="Setting up" className="flex flex-wrap items-center gap-x-[14px] gap-y-[6px]">
      {WELCOME_STEPS.map((s, i) => {
        const st = states[s.id];
        return (
          <li key={s.id} aria-current={st === "now" ? "step" : undefined} className={clsx("flex items-center gap-[6px] text-caption", st === "now" ? "font-medium text-fg" : st === "done" ? "text-fg-muted" : "text-fg-subtle")}>
            <span className={clsx("grid size-[18px] place-items-center rounded-full text-micro tnum", st === "done" ? "bg-success text-app" : st === "now" ? "bg-fg text-app" : "shadow-[inset_0_0_0_1px_var(--color-line-strong)]")}>
              {st === "done" ? <Check size={11} strokeWidth={2.5} /> : i + 1}
            </span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
