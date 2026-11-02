import { useState } from "react";
import clsx from "clsx";
import type { Bearing } from "@/goals/bearings";
import type { Goal } from "@/goals/types";
import { needLine, strengthFill, strengthOf, type RankedNeed } from "@/hub/needs";
import { goalHref, topicHref } from "@/projects/model";
import { Tip } from "../controls";
import { r } from "../recipes";
import { Meter, Sparkline, StatusDot } from "../viz";
import { workOnNeed } from "../space/SpacePanel";
import { cardHref } from "../space/href";

/*
 * Customers' problems in a canvas's panel, the best-backed first: ● on the canvas, ○ not yet; a
 * meter for how strong its backing is (four sources fill it), its quotes and sources, when that
 * evidence arrived, and the goals it bears on. Its title opens its page in the panel; one not on
 * the canvas can be put there.
 */

const STRENGTH: Record<ReturnType<typeof strengthOf>, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function ProblemsList({ needs, links, goals, limit }: { needs: RankedNeed[]; links: Bearing[]; goals: Goal[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? needs.slice(0, limit) : needs;
  return (
    <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {shown.map((n) => (
        <Row key={n.topic} n={n} goals={links.filter((l) => l.need === n.topic).flatMap((l) => goals.find((g) => g.id === l.goal) ?? [])} />
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

function Row({ n, goals }: { n: RankedNeed; goals: Goal[] }) {
  const [adding, setAdding] = useState(false);
  const on = n.boards.length > 0;
  const strength = strengthOf(n);
  return (
    <li className="group/need grid grid-cols-[16px_minmax(0,1fr)_56px] items-start gap-x-[10px] gap-y-[4px] px-[12px] py-[8px] hover:bg-hover">
      <span className="pt-[3px]">
        <StatusDot tone={on ? "ok" : "off"} hollow={!on} />
      </span>
      <a href={topicHref(n.topic)} className="line-clamp-2 text-body text-fg hover:underline" dir="auto">
        {n.title}
      </a>
      <Tip label={`${STRENGTH[strength]}: from ${plural(n.sources, "source")}`}>
        <span className="pt-[6px]">
          <Meter value={strengthFill(n)} label={`${STRENGTH[strength]}, from ${plural(n.sources, "source")}`} />
        </span>
      </Tip>
      <span className="col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <span className="text-caption text-fg-muted tnum">
          {needLine(n)}
          {n.against > 0 && <span className="text-warning"> · {n.against} against</span>}
        </span>
        <Sparkline values={n.weeks} label={`Quotes added each week, last ${n.weeks.length} weeks: ${n.weeks.join(", ")}`} />
        {goals.slice(0, 1).map((g) => (
          <a key={g.id} href={goalHref(g.id)} title={g.title} className="max-w-[160px] truncate rounded-sm bg-muted px-[6px] py-[1px] text-micro text-fg-muted hover:text-fg">
            {g.title}
          </a>
        ))}
        {goals.length > 1 && <span className="text-micro text-fg-subtle">+{goals.length - 1}</span>}
        <span className="ml-auto">
          {on ? (
            <a href={cardHref(n.boards[0].board, n.boards[0].card)} className="text-caption text-fg-muted hover:text-fg hover:underline">
              On the canvas
            </a>
          ) : (
            <button
              type="button"
              disabled={adding}
              onClick={() => {
                setAdding(true);
                void workOnNeed(n.topic).finally(() => setAdding(false));
              }}
              className={clsx(r.buttonSm, r.buttonGhost, "-my-[4px] opacity-0 group-hover/need:opacity-100 focus-visible:opacity-100", adding && "opacity-100")}
            >
              {adding ? "Adding…" : "Work on it"}
            </button>
          )}
        </span>
      </span>
    </li>
  );
}
