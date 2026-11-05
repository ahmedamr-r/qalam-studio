import { useState } from "react";
import clsx from "clsx";
import { needLine, strengthOf, type RankedNeed } from "@/hub/needs";
import { topicHref } from "@/projects/model";
import { Tip } from "../controls";
import { r } from "../recipes";
import { StrengthSignal } from "../viz";
import { workOnNeed } from "../space/SpacePanel";

/*
 * Customers' problems in a canvas's panel, the best-backed first: signal bars for how strong the
 * backing is, then its quotes and sources. A row opens the problem's page in the panel, which also
 * brings its card into view; one not on the canvas yet is quieter and can be put there.
 */

const STRENGTH: Record<ReturnType<typeof strengthOf>, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function ProblemsList({ needs, limit }: { needs: RankedNeed[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? needs.slice(0, limit) : needs;
  return (
    <ul className="q-sheet flex flex-col divide-y divide-line-subtle overflow-hidden rounded-xl">
      {shown.map((n) => (
        <Row key={n.topic} n={n} />
      ))}
      {!!limit && needs.length > limit && (
        <li className="px-[12px] py-[6px]">
          <button type="button" onClick={() => setAll((a) => !a)} className={clsx(r.buttonSm, r.buttonGhost, "-ml-[8px]")}>
            {all ? "Show fewer" : `All ${needs.length}`}
          </button>
        </li>
      )}
    </ul>
  );
}

function Row({ n }: { n: RankedNeed }) {
  const [adding, setAdding] = useState(false);
  const on = n.boards.length > 0;
  const word = `${STRENGTH[strengthOf(n)]}, from ${plural(n.sources, "source")}`;
  return (
    <li className="q-item group/need relative flex items-start gap-[12px] px-[12px] py-[10px] hover:bg-hover">
      <Tip label={word}>
        <span className="relative z-[1] pt-[3px]">
          <StrengthSignal of={n} label={word} />
        </span>
      </Tip>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <a href={topicHref(n.topic)} className={clsx("line-clamp-2 text-body outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:shadow-[inset_0_0_0_2px_var(--color-focus)]", on ? "text-fg" : "text-fg-muted")} dir="auto">
          {n.title}
        </a>
        <span className="flex min-h-[20px] items-center justify-between gap-[8px] text-caption text-fg-muted tnum">
          <span className="min-w-0 truncate">
            {needLine(n)}
            {n.against > 0 && <span className="text-warning"> · {n.against} against</span>}
          </span>
          {!on && (
            <button
              type="button"
              disabled={adding}
              onClick={() => {
                setAdding(true);
                void workOnNeed(n.topic).finally(() => setAdding(false));
              }}
              className={clsx(r.buttonSm, r.buttonGhost, "relative z-[1] -my-[4px] shrink-0 opacity-0 group-hover/need:opacity-100 focus-visible:opacity-100", adding && "opacity-100")}
            >
              {adding ? "Adding…" : "Work on it"}
            </button>
          )}
        </span>
      </span>
    </li>
  );
}
