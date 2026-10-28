import { useState } from "react";
import clsx from "clsx";
import type { Bearing } from "@/goals/bearings";
import type { Goal } from "@/goals/types";
import { strengthFill, strengthOf, type RankedNeed } from "@/hub/needs";
import { goalHref, projectHref, topicHref, type Project } from "@/projects/model";
import { Tip } from "../controls";
import { r } from "../recipes";
import { Meter, Sparkline, StatusDot } from "../viz";
import { startBoardForNeed } from "../topics/start-board";

/*
 * Customers' problems, the best-backed first: ● a board has it, ○ none does; a meter for how strong
 * its backing is (four sources fill it), its quotes and sources, when that evidence arrived, and
 * the goals it bears on. A problem no board has can start one.
 */

const STRENGTH: Record<ReturnType<typeof strengthOf>, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function ProblemsList({ needs, links, goals, projects, limit }: { needs: RankedNeed[]; links: Bearing[]; goals: Goal[]; projects: Project[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? needs.slice(0, limit) : needs;
  const boardName = (id: string) => projects.find((p) => p.id === id)?.name ?? "A board";
  return (
    <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {shown.map((n) => (
        <Row key={n.topic} n={n} boardName={boardName} goals={links.filter((l) => l.need === n.topic).flatMap((l) => goals.find((g) => g.id === l.goal) ?? [])} />
      ))}
      {!!limit && needs.length > limit && (
        <li className="px-[12px] pt-[2px] pb-[4px]">
          <button type="button" onClick={() => setAll((a) => !a)} className={clsx(r.buttonSm, r.buttonGhost, "-ml-[8px]")}>
            {all ? "Show fewer" : `All ${needs.length}`}
          </button>
        </li>
      )}
    </ul>
  );
}

function Row({ n, boardName, goals }: { n: RankedNeed; boardName: (id: string) => string; goals: Goal[] }) {
  const [starting, setStarting] = useState(false);
  const on = n.boards.length > 0;
  const strength = strengthOf(n);
  return (
    <li className="group/need grid min-h-[40px] grid-cols-[16px_minmax(0,1fr)_96px_260px_minmax(0,180px)_140px] items-center gap-x-[12px] px-[12px] py-[4px] hover:bg-hover max-[960px]:grid-cols-[16px_minmax(0,1fr)_72px_minmax(0,140px)] max-[960px]:[&>.wide]:hidden">
      <StatusDot tone={on ? "ok" : "off"} hollow={!on} />
      <a href={topicHref(n.topic)} className="truncate text-body text-fg hover:underline">
        {n.title}
      </a>
      <Tip label={`${STRENGTH[strength]}: from ${plural(n.sources, "source")}`}>
        <span>
          <Meter value={strengthFill(n)} label={`${STRENGTH[strength]}, from ${plural(n.sources, "source")}`} />
        </span>
      </Tip>
      <span className="wide flex min-w-0 items-center gap-[10px]">
        <span className="truncate text-caption text-fg-muted tnum">
          {n.quotes ? `${plural(n.quotes, "quote")} · ${plural(n.sources, "source")}` : "No customer words yet"}
          {n.against > 0 && <span className="text-warning"> · {n.against} against</span>}
        </span>
        <Sparkline values={n.weeks} label={`Quotes added each week, last ${n.weeks.length} weeks: ${n.weeks.join(", ")}`} />
      </span>
      <span className="wide flex min-w-0 flex-wrap gap-[4px]">
        {goals.slice(0, 2).map((g) => (
          <a key={g.id} href={goalHref(g.id)} title={g.title} className="max-w-full truncate rounded-sm bg-muted px-[6px] py-[1px] text-micro text-fg-muted hover:text-fg">
            {g.title}
          </a>
        ))}
        {goals.length > 2 && <span className="text-micro text-fg-subtle">+{goals.length - 2}</span>}
        {!goals.length && <span className="text-micro text-fg-subtle">No goal yet</span>}
      </span>
      <span className="flex min-w-0 justify-end">
        {on ? (
          <a href={`${projectHref({ id: n.boards[0].board, type: "discovery" })}?card=${encodeURIComponent(n.boards[0].card)}`} className="truncate text-caption text-fg-muted hover:text-fg hover:underline">
            {boardName(n.boards[0].board)}
            {n.boards.length > 1 ? ` +${n.boards.length - 1}` : ""}
          </a>
        ) : (
          <button
            type="button"
            disabled={starting}
            onClick={() => {
              setStarting(true);
              void startBoardForNeed(n.topic).finally(() => setStarting(false));
            }}
            className={clsx(r.buttonSm, r.buttonGhost, "opacity-0 group-hover/need:opacity-100 focus-visible:opacity-100", starting && "opacity-100")}
          >
            {starting ? "Starting…" : "Start a board"}
          </button>
        )}
      </span>
    </li>
  );
}
