import { useState } from "react";
import clsx from "clsx";
import { strengthFill, strengthOf, type RankedNeed } from "@/hub/needs";
import { projectHref, topicHref } from "@/projects/model";
import type { ShowsUpOn } from "@/org/topics";
import { r } from "../recipes";
import { Meter, Sparkline, StatusDot } from "../viz";
import { startBoardForNeed } from "./start-board";

/*
 * The strip on top of a need's page: how strong its backing is, at a glance. A meter and a word,
 * its quotes and sources (and what speaks against it), when that evidence arrived over eight weeks,
 * who raises it (the segment pages citing the same words), and the board that has it, or a way to
 * start one.
 */

const STRENGTH: Record<ReturnType<typeof strengthOf>, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function NeedStrip({ s, shows }: { s: RankedNeed; shows: ShowsUpOn[] }) {
  const [starting, setStarting] = useState(false);
  const strength = strengthOf(s);
  const board = s.boards[0];
  const boardName = board && (shows.find((x) => x.board === board.board)?.boardName ?? "A board");
  return (
    <section aria-label="How strong this need is" className="flex flex-col gap-[10px] rounded-lg bg-panel px-[16px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
        <span className="flex w-[160px] flex-col gap-[6px]">
          <span className="text-body font-medium text-fg">{STRENGTH[strength]}</span>
          <Meter value={strengthFill(s)} label={`${STRENGTH[strength]}, from ${plural(s.sources, "source")}`} />
        </span>
        <span className="flex flex-col gap-[2px] text-caption tnum">
          <span className="text-fg">{s.quotes ? `${plural(s.quotes, "quote")} · ${plural(s.sources, "source")}` : "No customer words yet"}</span>
          {/* People online back it, below its own customers' words. */}
          {s.online > 0 && <span className="text-fg-muted">{`${plural(s.online, "quote")} from ${plural(s.onlineSources, "post")} online`}</span>}
          <span className={s.against ? "text-warning" : "text-fg-subtle"}>{s.against ? `${s.against} against` : "Nothing against"}</span>
        </span>
        <span className="flex flex-col gap-[2px]">
          <Sparkline values={s.weeks} width={84} height={20} label={`Quotes added each week, last ${s.weeks.length} weeks: ${s.weeks.join(", ")}`} />
          <span className="text-micro text-fg-subtle">added, {s.weeks.length} weeks</span>
        </span>
        <span className="ml-auto flex items-center gap-[8px]">
          {board ? (
            <a href={`${projectHref({ id: board.board, type: "discovery" })}?card=${encodeURIComponent(board.card)}`} className="inline-flex items-center gap-[6px] text-caption text-fg-muted hover:text-fg hover:underline">
              <StatusDot tone="ok" />
              On {boardName}
              {s.boards.length > 1 ? ` +${s.boards.length - 1}` : ""}
            </a>
          ) : (
            <>
              <span className="inline-flex items-center gap-[6px] text-caption text-fg-subtle">
                <StatusDot tone="off" hollow />
                On no board
              </span>
              <button
                type="button"
                disabled={starting}
                onClick={() => {
                  setStarting(true);
                  void startBoardForNeed(s.topic).finally(() => setStarting(false));
                }}
                className={clsx(r.buttonSm, r.buttonSecondary)}
              >
                {starting ? "Starting…" : "Start a board"}
              </button>
            </>
          )}
        </span>
      </div>
      {!!s.segments.length && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className="text-micro text-fg-subtle">Who</span>
          {s.segments.map((g) => (
            <a key={g.id} href={topicHref(g.id)} className={clsx(r.chip, "hover:text-fg")}>
              {g.title}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
