import { Check, Star, Target, X } from "lucide-react";
import { IconBtn, Button } from "../controls";
import { Panel } from "../chat/Panels";
import { acceptLines } from "../setup/setup";
import { pathOf, type Canvas } from "./canvas";
import { focusNode, openRight } from "./dock";
import { act, Chip, LineCard, useActing } from "./rows";
import type { Place } from "./places";

/*
 * A place on the setup's canvas, docked beside it: the About or a product, with Qalam AI's lines for
 * it to accept or leave out (each with what it rests on), what it says now, and the goals in it (a
 * click brings a goal into view and opens it).
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export function PlacePanel({ place, canvas, onClose }: { place: Place; canvas: Canvas; onClose: () => void }) {
  const working = useActing((s) => s.working);
  const id = `place:${place.key}`;
  const open = place.lines.filter((l) => l.state === "proposed").map((l) => l.id);
  const proposed = place.lines.filter((l) => l.state !== "kept");
  const kept = place.lines.filter((l) => l.state === "kept");
  // The goals that reach it: wired in, or feeding one that is.
  const reach = pathOf(canvas, id).nodes;
  const goals = canvas.nodes.filter((n) => n.kind === "goal" && reach.has(n.id) && n.state !== "discarded");
  return (
    <Panel
      label={place.title}
      title={
        <span className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate">{place.title}</span>
          {place.fresh && <Chip tone="text-ai bg-ai-subtle">New product</Chip>}
        </span>
      }
      actions={
        <>
          {open.length > 0 && (
            <Button size="sm" disabled={working} onClick={() => act(() => acceptLines(open))}>
              <Check size={12} strokeWidth={2.25} /> Accept these · {open.length}
            </Button>
          )}
          <IconBtn size="sm" label="Close" onClick={onClose}>
            <X size={14} {...ICON} />
          </IconBtn>
        </>
      }
    >
      <div className="flex flex-col gap-[16px] p-[12px]">
        {proposed.length > 0 && (
          <section aria-label="Qalam AI's lines" className="flex flex-col gap-[8px]">
            {proposed.map((l) => (
              <LineCard key={l.id} l={l} />
            ))}
          </section>
        )}
        {kept.length > 0 && (
          <section aria-label="What it says now" className="flex flex-col gap-[8px]">
            <h3 className="text-micro font-semibold uppercase tracking-[0.04em] text-fg-subtle">What it says now</h3>
            {kept.map((l) => (
              <LineCard key={l.id} l={l} />
            ))}
          </section>
        )}
        {!place.lines.length && <p className="text-caption text-fg-subtle">Nothing written about it yet. Qalam AI proposes lines for it as it reads what you send.</p>}
        {goals.length > 0 && (
          <section aria-label="Goals in it" className="flex flex-col gap-[4px]">
            <h3 className="text-micro font-semibold uppercase tracking-[0.04em] text-fg-subtle">Goals in it</h3>
            {goals.map((g) => (
              <button
                key={g.id}
                type="button"
                className="q-item flex items-center gap-[8px] rounded-md px-[6px] py-[5px] text-left text-body text-fg hover:bg-hover"
                onClick={() => {
                  focusNode(g.id);
                  openRight({ kind: "goal", id: g.id });
                }}
              >
                {g.north ? <Star size={13} {...ICON} className="shrink-0 text-fg-accent" /> : <Target size={13} {...ICON} className="shrink-0 text-kh-you" />}
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {g.title}
                </span>
                {g.state === "proposed" && <span className="shrink-0 text-micro text-ai">Proposed</span>}
              </button>
            ))}
          </section>
        )}
      </div>
    </Panel>
  );
}
