import { Star, Target } from "lucide-react";
import { metricText } from "@/discovery/dump";
import { metricProgress } from "@/discovery/metric";
import { childrenOf, rootsOf } from "@/goals/tree";
import type { Goal, GoalTree } from "@/goals/types";
import { projectHref } from "@/projects/model";
import { Meter } from "../viz";

/**
 * The organization's goals as one tree (goals.md): the North Star on top, each goal under the goal
 * it feeds, then the goals not under one yet. A goal a board works on opens that board on its card.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function GoalsList({ tree, boards, products, keep }: { tree: GoalTree; boards: Map<string, string>; products: Map<string, string>; keep?: (g: Goal) => boolean }) {
  const shown = (g: Goal): boolean => !keep || keep(g) || childrenOf(tree, g.id).some(shown);
  const row = (g: Goal, depth: number) => {
    if (!shown(g)) return null;
    const m = g.metric;
    const progress = metricProgress(m);
    // Where it is against where it's going: "41 / 50 orders", or just the target.
    const nums = m && m.target !== null ? `${m.current ?? m.baseline ?? "?"} / ${m.target}${m.unit ? ` ${m.unit}` : ""}` : null;
    const board = g.on ? boards.get(g.on.board) : undefined;
    const where = [g.product ? products.get(g.product) : null, board].filter(Boolean).join(" · ");
    const north = g.id === tree.north;
    const body = (
      <>
        <span className={north ? "text-fg" : "text-fg-subtle"}>{north ? <Star {...ICON} /> : <Target {...ICON} />}</span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body text-fg">{g.title}</span>
          {(north || where) && <span className="truncate text-micro text-fg-subtle">{[north ? "North Star" : null, where].filter(Boolean).join(" · ")}</span>}
        </span>
        {progress !== null ? <Meter value={progress} label={`${Math.round(progress * 100)}% of the way to the target`} /> : <span />}
        <span className="truncate text-right text-caption text-fg-muted tnum">{nums ?? (m?.name ? "No target yet" : "")}</span>
      </>
    );
    const cls = "q-item grid grid-cols-[16px_minmax(0,1fr)_96px_minmax(0,140px)] items-center gap-x-[10px] rounded-md px-[8px] py-[6px]";
    return (
      <li key={g.id}>
        {g.on && board ? (
          <a href={`${projectHref({ id: g.on.board, type: "discovery" })}?card=${g.on.card}`} title={metricText(m) || undefined} className={`${cls} hover:bg-hover`} style={{ paddingLeft: 8 + depth * 20 }}>
            {body}
          </a>
        ) : (
          <div title={metricText(m) || undefined} className={cls} style={{ paddingLeft: 8 + depth * 20 }}>
            {body}
          </div>
        )}
        {!!childrenOf(tree, g.id).length && <ul>{childrenOf(tree, g.id).map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  return <ul className="flex flex-col">{rootsOf(tree).map((g) => row(g, 0))}</ul>;
}
