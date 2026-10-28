import { useState } from "react";
import clsx from "clsx";
import { strengthFill, strengthOf, type RankedNeed } from "@/hub/needs";
import type { NeedsNow } from "@/org/needs";
import { placeHref, projectHref, topicHref, type Project } from "@/projects/model";
import { Tip } from "../controls";
import { r } from "../recipes";
import { Meter, Sparkline, StatusDot } from "../viz";
import { startBoardForNeed } from "../topics/start-board";
import type { Scope } from "./scope";

/*
 * What to work on next: the customer needs, the best-backed first. One row per need: ● a board has
 * it, ○ none does; a meter for how strong its backing is (four sources fill it), its quotes and
 * sources, and when that evidence arrived over eight weeks. A need no board has can start one.
 */

const SHOWN = 6;
const STRENGTH: Record<ReturnType<typeof strengthOf>, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function NextUp({ now, scope, projects }: { now: NeedsNow | null; scope: Scope; projects: Project[] }) {
  const [all, setAll] = useState(false);
  const needs = now?.needs.filter((n) => scope === "all" || (scope === "org" ? !n.products.length : n.products.includes(scope))) ?? null;
  const shown = needs && (all ? needs : needs.slice(0, SHOWN));
  const boardName = (id: string) => projects.find((p) => p.id === id)?.name ?? "A board";

  return (
    <section aria-labelledby="next-up" className="flex flex-col gap-[10px]">
      <div className="flex items-end justify-between gap-[12px]">
        <h2 id="next-up" className="text-title font-medium">
          What to work on next
        </h2>
        <span className="flex items-center gap-[12px] text-micro text-fg-subtle">
          <span className="inline-flex items-center gap-[6px]">
            <StatusDot tone="ok" /> On a board
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <StatusDot tone="off" hollow /> On no board
          </span>
        </span>
      </div>
      {!needs ? (
        <div className="flex flex-col gap-[6px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className={clsx(r.skeleton, "h-[40px] rounded-lg")} />
          ))}
        </div>
      ) : !now?.indexed ? (
        <p className="text-caption text-fg-subtle">Ranking needs takes this computer&apos;s search, which isn&apos;t running. Connections says why.</p>
      ) : !needs.length ? (
        <Empty />
      ) : (
        <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {shown!.map((n) => (
            <Row key={n.topic} n={n} boardName={boardName} />
          ))}
          {needs.length > SHOWN && (
            <li className="px-[12px] pt-[2px] pb-[4px]">
              <button type="button" onClick={() => setAll((a) => !a)} className={clsx(r.buttonSm, r.buttonGhost, "-ml-[8px]")}>
                {all ? "Show fewer" : `All ${needs.length} needs`}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Row({ n, boardName }: { n: RankedNeed; boardName: (id: string) => string }) {
  const [starting, setStarting] = useState(false);
  const on = n.boards.length > 0;
  const strength = strengthOf(n);
  return (
    <li className="group/need grid h-[40px] grid-cols-[16px_minmax(0,1fr)_96px_210px_56px_140px] items-center gap-x-[12px] px-[12px] hover:bg-hover max-[760px]:grid-cols-[16px_minmax(0,1fr)_72px_minmax(0,140px)] max-[760px]:[&>.wide]:hidden">
      <StatusDot tone={on ? "ok" : "off"} hollow={!on} />
      <a href={topicHref(n.topic)} className="truncate text-body text-fg hover:underline">
        {n.title}
      </a>
      <Tip label={`${STRENGTH[strength]}: from ${plural(n.sources, "source")}`}>
        <span>
          <Meter value={strengthFill(n)} label={`${STRENGTH[strength]}, from ${plural(n.sources, "source")}`} />
        </span>
      </Tip>
      <span className="wide truncate text-caption text-fg-muted tnum">
        {n.quotes ? `${plural(n.quotes, "quote")} · ${plural(n.sources, "source")}` : "No customer words yet"}
        {n.against > 0 && <span className="text-warning"> · {n.against} against</span>}
      </span>
      <span className="wide">
        <Sparkline values={n.weeks} label={`Quotes added each week, last ${n.weeks.length} weeks: ${n.weeks.join(", ")}`} />
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

/** Before any need page: what the list will look like, faded, and where material goes in. */
function Empty() {
  return (
    <div className="relative overflow-hidden rounded-lg bg-panel px-[12px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div aria-hidden className="flex flex-col opacity-40">
        {[0.9, 0.6, 0.35].map((v, i) => (
          <div key={i} className="grid h-[32px] grid-cols-[16px_minmax(0,1fr)_96px] items-center gap-x-[12px]">
            <StatusDot tone="off" hollow />
            <span className="h-[8px] w-[60%] rounded-full bg-active" />
            <Meter value={v} label="" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-[12px]">
        <p className="text-body text-fg-muted">Needs show here once Qalam AI reads what customers say.</p>
        <a href={placeHref("sources")} className={clsx(r.buttonSm, r.buttonSecondary)}>
          Add material
        </a>
      </div>
    </div>
  );
}
