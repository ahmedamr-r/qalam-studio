import { Target } from "lucide-react";
import { metricText } from "@/discovery/dump";
import type { OstMetric } from "@/discovery/types";
import { metricProgress } from "@/discovery/metric";
import { projectHref } from "@/projects/model";
import { Meter } from "../viz";

/**
 * The organization's goals: every outcome on every board, sub-outcomes under the outcome they
 * move. Each opens its board on that card.
 */

export interface Goal {
  board: string;
  boardName: string;
  product: string | null;
  id: string;
  title: string;
  metric?: OstMetric;
  parent: string | null;
}

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function GoalsList({ goals, showBoard = true }: { goals: Goal[]; showBoard?: boolean }) {
  const key = (g: Pick<Goal, "board" | "id">) => `${g.board}:${g.id}`;
  const children = new Map<string, Goal[]>();
  const roots: Goal[] = [];
  for (const g of goals) {
    // A sub-outcome whose parent isn't listed (another product) shows on its own.
    const parent = g.parent && goals.some((x) => x.board === g.board && x.id === g.parent) ? `${g.board}:${g.parent}` : null;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), g]);
    else roots.push(g);
  }
  const row = (g: Goal, depth: number) => {
    const m = g.metric;
    const progress = metricProgress(m);
    // Where it is against where it's going: "41 / 50 orders", or just the target.
    const nums = m && m.target !== null ? `${m.current ?? m.baseline ?? "?"} / ${m.target}${m.unit ? ` ${m.unit}` : ""}` : null;
    return (
      <li key={key(g)}>
        <a
          href={`${projectHref({ id: g.board, type: "discovery" })}?card=${g.id}`}
          title={metricText(m) || undefined}
          className="q-item grid grid-cols-[16px_minmax(0,1fr)_96px_minmax(0,140px)] items-center gap-x-[10px] rounded-md px-[8px] py-[6px] hover:bg-hover"
          style={{ paddingLeft: 8 + depth * 20 }}
        >
          <span className="text-fg-subtle">
            <Target {...ICON} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body text-fg">{g.title}</span>
            {showBoard && <span className="truncate text-micro text-fg-subtle">{g.boardName}</span>}
          </span>
          {progress !== null ? <Meter value={progress} label={`${Math.round(progress * 100)}% of the way to the target`} /> : <span />}
          <span className="truncate text-right text-caption text-fg-muted tnum">{nums ?? (m?.name ? "No target yet" : "")}</span>
        </a>
        {!!children.get(key(g))?.length && <ul>{children.get(key(g))!.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  return <ul className="flex flex-col">{roots.map((g) => row(g, 0))}</ul>;
}
