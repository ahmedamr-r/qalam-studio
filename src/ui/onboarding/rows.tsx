import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Briefcase, Check, Quote, Tags, Target, Users, X, type LucideIcon } from "lucide-react";
import { create } from "zustand";
import { Tip } from "../controls";
import { acceptLines, discardLines } from "../setup/setup";
import type { LineField, LineRow, RestsOn, RowState } from "./places";

/*
 * The setup's rows, for the panels its canvas opens (a place's lines, a goal): a line with what it
 * rests on, and Accept or Leave it out. One working flag for the whole page, so a click on the canvas,
 * in a panel or on the review pill never runs twice at once.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export const useActing = create<{ working: boolean }>(() => ({ working: false }));

/** Run a change unless one is running. */
export function act(fn: () => Promise<void>) {
  if (useActing.getState().working) return;
  useActing.setState({ working: true });
  void fn().finally(() => useActing.setState({ working: false }));
}

const FIELD: Record<LineField, LucideIcon> = { context: Briefcase, audience: Users, segments: Tags, goals: Target };

/** A line's state as the colour of its edge: Qalam AI's rose while proposed, green once accepted. */
const EDGE: Record<RowState, string> = { proposed: "before:bg-ai", accepted: "before:bg-success", discarded: "before:bg-transparent", kept: "before:bg-transparent" };

const card = "relative overflow-hidden rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line-subtle)] before:absolute before:inset-y-0 before:left-0 before:w-[3px]";

/** A small label with an icon (or `lead`); `wrap` lets long words run onto a second line. */
export function Chip({ icon: Icon, lead, children, tone = "text-fg-muted bg-active", wrap }: { icon?: LucideIcon; lead?: ReactNode; children: ReactNode; tone?: string; wrap?: boolean }) {
  return (
    <span className={clsx("inline-flex max-w-full shrink-0 items-center gap-[4px] self-start rounded-sm px-[6px] text-micro font-medium", wrap ? "min-h-[20px] py-[2px]" : "h-[20px]", tone)}>
      {Icon && <Icon size={11} {...ICON} className="shrink-0" />}
      {lead}
      <span className={clsx("tnum", wrap ? "min-w-0" : "truncate")}>{children}</span>
    </span>
  );
}

/** What a line rests on: a count you can open into their words and answers. */
export function Rests({ rests, open: start = false }: { rests?: RestsOn; open?: boolean }) {
  const [open, setOpen] = useState(start);
  const n = (rests?.quotes.length ?? 0) + (rests?.answers.length ?? 0);
  if (!rests || !n) return null;
  return (
    <div className="flex flex-col gap-[4px]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="q-item inline-flex h-[20px] items-center gap-[4px] self-start rounded-sm px-[6px] text-micro font-medium text-fg-muted hover:bg-hover hover:text-fg">
        <Quote size={11} {...ICON} /> Rests on {n === 1 ? "1 thing you said" : `${n} things you said`}
      </button>
      {open && (
        <div className="flex flex-col gap-[4px] border-l-2 border-line pl-[8px]">
          {rests.quotes.map((q, i) => (
            <p key={`q${i}`} className="text-caption text-fg-muted" dir="auto">
              “{q}”
            </p>
          ))}
          {rests.answers.map((a, i) => (
            <p key={`a${i}`} className="text-caption text-fg-muted" dir="auto">
              <span className="text-fg-subtle">{a.question}</span> {a.answer}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Accept and Leave it out, or where it stands once settled. */
export function Settle({ id, state }: { id: string; state: RowState }) {
  const working = useActing((s) => s.working);
  if (state === "accepted")
    return (
      <span className="inline-flex h-[24px] shrink-0 items-center gap-[4px] rounded-md bg-success-subtle px-[7px] text-micro font-semibold text-success">
        <Check size={12} strokeWidth={2.25} /> Accepted
      </span>
    );
  if (state === "discarded") return <span className="inline-flex h-[24px] shrink-0 items-center px-[4px] text-micro font-medium text-fg-subtle">Left out</span>;
  if (state !== "proposed") return null;
  return (
    <span className="flex shrink-0 items-center gap-[4px]">
      <Tip label="Leave it out">
        <button type="button" aria-label="Leave it out" disabled={working} onClick={() => act(() => discardLines([id]))} className="q-item grid size-[26px] place-items-center rounded-md text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-danger-subtle hover:text-danger disabled:opacity-50">
          <X size={14} {...ICON} />
        </button>
      </Tip>
      <Tip label="Accept">
        <button type="button" aria-label="Accept" disabled={working} onClick={() => act(() => acceptLines([id]))} className="q-item grid size-[26px] place-items-center rounded-md bg-success-subtle text-success hover:bg-success hover:text-app disabled:opacity-50">
          <Check size={14} strokeWidth={2} />
        </button>
      </Tip>
    </span>
  );
}

/** A line of a place: its field, its words, what it rests on, and Accept or Leave it out while it's proposed. */
export function LineCard({ l }: { l: LineRow }) {
  const [more, setMore] = useState(false);
  const long = l.text.length > 160;
  return (
    <div className={clsx(card, EDGE[l.state], "flex flex-col gap-[6px] py-[10px] pl-[12px] pr-[10px]", l.state === "discarded" && "opacity-55")}>
      <div className="flex items-start gap-[8px]">
        <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <Chip icon={FIELD[l.field]}>{l.label}</Chip>
          <span className={clsx("text-body leading-[20px] text-fg", !more && "line-clamp-3", l.state === "discarded" && "line-through")} dir="auto">
            {l.text}
          </span>
          {long && (
            <button type="button" className="self-start text-micro font-medium text-fg-muted hover:text-fg" onClick={() => setMore(!more)}>
              {more ? "Less" : "More"}
            </button>
          )}
        </span>
        <Settle id={l.id} state={l.state} />
      </div>
      <Rests rests={l.rests} />
    </div>
  );
}
