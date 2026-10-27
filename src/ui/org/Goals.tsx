import { Target } from "lucide-react";
import { metricText } from "@/discovery/dump";
import type { OstMetric } from "@/discovery/types";
import { projectHref } from "@/projects/model";

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
    const metric = metricText(g.metric);
    return (
      <li key={key(g)}>
        <a href={`${projectHref({ id: g.board, type: "discovery" })}?card=${g.id}`} className="q-item flex items-start gap-[10px] rounded-md px-[8px] py-[6px] hover:bg-hover" style={{ paddingLeft: 8 + depth * 20 }}>
          <span className="mt-[2px] text-fg-subtle">
            <Target {...ICON} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-body text-fg">{g.title}</span>
            {(metric || showBoard) && <span className="truncate text-caption text-fg-muted">{[metric, showBoard && g.boardName].filter(Boolean).join(" · ")}</span>}
          </span>
        </a>
        {!!children.get(key(g))?.length && <ul>{children.get(key(g))!.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  return <ul className="flex flex-col">{roots.map((g) => row(g, 0))}</ul>;
}
