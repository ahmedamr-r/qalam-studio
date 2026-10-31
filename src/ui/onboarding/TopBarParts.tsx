import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button } from "../controls";
import { StepList } from "../chat/Panels";
import { r } from "../recipes";
import { addKnown, useKnow } from "../setup/know";
import { acceptLines, useSetup } from "../setup/setup";
import { reviewNext } from "./dock";
import { reviewOf } from "./places";
import { act, useActing } from "./rows";
import { progressOf, type StepItem } from "./thread";

/*
 * The setup page's top bar, now that the canvas is the page: where the setup is (a slim bar and the
 * step's name; a click shows every step), and how the review stands (what's left to review, which a
 * click opens on the canvas, and Accept all).
 */

export function StepsProgress({ steps, compact }: { steps: StepItem[]; compact?: boolean }) {
  const p = progressOf(steps);
  if (!p.total) return null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Step ${p.at} of ${p.total}: ${p.label}. Show every step`} className="q-item flex h-[28px] items-center gap-[8px] rounded-md px-[8px] text-caption text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-active">
          <span aria-hidden className="flex gap-[2px]">
            {steps.map((s) => (
              <span key={s.id} className={clsx("h-[4px] w-[10px] rounded-full", s.state === "done" ? "bg-success" : s.state === "now" ? "bg-fg" : "bg-line-strong")} />
            ))}
          </span>
          {compact ? <span className="tnum">{`${p.at}/${p.total}`}</span> : <span className="max-w-[220px] truncate">{p.label}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={clsx(r.menu, "w-[240px] p-0")}>
          <StepList steps={steps} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ReviewPill({ compact }: { compact?: boolean }) {
  const session = useSetup((s) => s.source?.setup);
  const know = useKnow((s) => (s.phase === "review" ? s.goals.length : 0));
  const working = useActing((s) => s.working);
  // Their own goals, written at the know door: added together.
  if (know)
    return (
      <Button size="sm" disabled={working} onClick={() => act(async () => void (await addKnown()))}>
        {know === 1 ? "Add the goal" : `${know} goals · Add them`}
      </Button>
    );
  if (!session?.proposal) return null;
  const { accepted, discarded, open } = reviewOf(session);
  if (!open.length)
    return accepted + discarded ? (
      <span className="inline-flex h-[28px] items-center gap-[6px] px-[8px] text-caption font-medium text-success" role="status">
        <Check size={13} strokeWidth={2.25} /> All settled
      </span>
    ) : null;
  return (
    <span className="flex items-center gap-[4px]">
      <button type="button" onClick={() => reviewNext(session)} className="q-item inline-flex h-[28px] items-center gap-[6px] rounded-md px-[8px] text-caption font-medium text-fg hover:bg-hover">
        <QalamAIGlyph size={12} /> {compact ? open.length : `${open.length} to review`}
      </button>
      <Button size="sm" disabled={working} onClick={() => act(() => acceptLines(open))}>
        <Check size={12} strokeWidth={2.25} /> Accept all
      </Button>
    </span>
  );
}
