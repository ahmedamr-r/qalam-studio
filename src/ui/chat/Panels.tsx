import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
import { r } from "../recipes";
import type { ChatStep } from "./types";

/*
 * The panels an AI surface sits in, like Intercom's: floating rounded panels on the app's
 * backdrop. Steps on the left, the conversation in the middle, and what it has made so far on the
 * right, which becomes a drawer when the window is narrow (opened from the chat's header).
 */

/** The window is at least this wide (it follows resizing). */
export function useWide(min: number): boolean {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    on();
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}

/** Below this the right panel is a drawer. */
export const WIDE = 1180;

export function PanelLayout({ left, center, right, rightOpen, onRightOpen }: { left?: ReactNode; center: ReactNode; right?: ReactNode; rightOpen: boolean; onRightOpen: (open: boolean) => void }) {
  const wide = useWide(WIDE);
  const cols = [left ? "232px" : null, "minmax(0,1fr)", right && wide ? "400px" : null].filter(Boolean).join("_");
  useEffect(() => {
    if (!rightOpen || wide) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onRightOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rightOpen, wide, onRightOpen]);
  return (
    <div className={clsx(r.panelBackdrop, "relative")} style={{ gridTemplateColumns: cols.replaceAll("_", " ") }}>
      {left}
      {center}
      {right && wide && right}
      {right && !wide && rightOpen && <div className={r.panelDrawer}>{right}</div>}
    </div>
  );
}

export function Panel({ title, label, actions, children, className, body = true }: { title?: ReactNode; label?: string; actions?: ReactNode; children: ReactNode; className?: string; body?: boolean }) {
  return (
    <section aria-label={label ?? (typeof title === "string" ? title : undefined)} className={clsx(r.panelBox, className)}>
      {(title || actions) && (
        <header className={r.panelHead}>
          {title && <h2 className={r.panelBoxTitle}>{title}</h2>}
          <span className="flex-1" />
          {actions}
        </header>
      )}
      {body ? <div className="min-h-0 flex-1 overflow-y-auto">{children}</div> : children}
    </section>
  );
}

/** Steps down the left: done ✓ · now ● · next ○, the current one's own steps under it. */
export function StepList({ steps, foot }: { steps: ChatStep[]; foot?: ReactNode }) {
  const at = steps.findIndex((s) => s.state === "now");
  const shown = at < 0 ? steps.filter((s) => s.state === "done").length : at + 1;
  return (
    <div className="flex h-full flex-col">
      <ol aria-label="Steps" className="flex flex-col gap-[2px] p-[8px]">
        {steps.map((s, i) => (
          <li key={s.id} aria-current={s.state === "now" ? "step" : undefined} className="flex flex-col">
            <span className={clsx("flex h-[32px] items-center gap-[10px] rounded-md px-[8px] text-body", s.state === "now" ? "bg-active font-medium text-fg" : s.state === "done" ? "text-fg-muted" : "text-fg-subtle")}>
              <span className={clsx(r.stepDot, s.state === "done" ? "bg-success text-app" : s.state === "now" ? "bg-fg text-app" : "shadow-[inset_0_0_0_1px_var(--color-line-strong)]")}>{s.state === "done" ? <Check size={11} strokeWidth={2.5} /> : i + 1}</span>
              <span className="truncate">{s.label}</span>
            </span>
            {s.sub && (
              <ol className="ml-[17px] flex flex-col border-l border-line-subtle py-[2px] pl-[14px]">
                {s.sub.map((x) => (
                  <li key={x.label} className={clsx("flex h-[26px] items-center gap-[8px] text-caption", x.state === "now" ? "font-medium text-fg" : x.state === "done" ? "text-fg-muted" : "text-fg-subtle")}>
                    <span className={clsx("size-[6px] shrink-0 rounded-full", x.state === "done" ? "bg-success" : x.state === "now" ? "bg-fg" : "shadow-[inset_0_0_0_1px_var(--color-line-strong)]")} />
                    {x.label}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-auto flex flex-col gap-[8px] p-[14px]">
        <span className="text-micro text-fg-subtle tnum">
          {Math.min(shown, steps.length)} of {steps.length}
        </span>
        {foot}
      </div>
    </div>
  );
}
