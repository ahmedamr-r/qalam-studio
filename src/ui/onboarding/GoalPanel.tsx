import { ArrowUpRight, CircleDashed, TrendingUp, X } from "lucide-react";
import { useGoals } from "@/goals/client";
import { goalById } from "@/goals/tree";
import type { OstMetric } from "@/discovery/types";
import { goalHref } from "@/projects/model";
import { IconBtn, Button } from "../controls";
import { Panel } from "../chat/Panels";
import { dropKnown, useKnow } from "../setup/know";
import { useSetup, useSetupQuotes } from "../setup/setup";
import type { Canvas, CanvasNode } from "./canvas";
import { numberLine, type RestsOn, type RowState } from "./places";
import { Chip, Rests, Settle } from "./rows";

/*
 * A goal on the setup's canvas, docked beside it: its number, where it goes (the place it's in, the
 * goal it feeds), what it rests on, and Accept or Leave it out while Qalam AI proposes it (one they
 * wrote can be left out before it's added; one in goals.md opens its page).
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export function GoalPanel({ node, canvas, onClose }: { node: CanvasNode; canvas: Canvas; onClose: () => void }) {
  const session = useSetup((s) => s.source?.setup);
  const quotes = useSetupQuotes();
  const tree = useGoals();
  const know = useKnow((s) => s.goals);
  const line = node.lineId ? session?.proposal?.lines.find((l) => l.id === node.lineId) : undefined;
  const goal = node.goalId ? goalById(tree, node.goalId) : undefined;
  const mine = node.goalRef ? know.find((g) => g.ref === node.goalRef) : undefined;
  const metric: OstMetric | null = line?.metric ?? goal?.metric ?? mine?.metric ?? null;
  const rests: RestsOn = line ? { quotes: line.pieces.flatMap((id) => quotes.find((q) => q.id === id)?.text ?? []), answers: line.answers } : { quotes: node.quotes.flatMap((id) => quotes.find((q) => q.id === id)?.text ?? []), answers: [] };
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const out = canvas.edges.filter((e) => e.from === node.id && (e.kind === "in" || e.kind === "under")).map((e) => byId.get(e.to)).filter((n): n is CanvasNode => !!n);
  const state = (node.state === "proposed" || node.state === "accepted" || node.state === "discarded" ? node.state : "kept") as RowState;
  return (
    <Panel
      label={node.title}
      title={node.north ? "North Star" : node.number ? "A number it read" : "Goal"}
      actions={
        <IconBtn size="sm" label="Close" onClick={onClose}>
          <X size={14} {...ICON} />
        </IconBtn>
      }
    >
      <div className="flex flex-col gap-[12px] p-[12px]">
        <div className="flex items-start gap-[8px]">
          <p className="min-w-0 flex-1 text-body font-medium leading-[20px] text-fg" dir="auto">
            {node.title}
          </p>
          {node.lineId && <Settle id={node.lineId} state={state} />}
        </div>
        <div className="flex flex-wrap gap-[4px]">
          {metric ? (
            <Chip icon={TrendingUp} tone="text-fg bg-active" wrap>
              {numberLine(metric, node.title)}
            </Chip>
          ) : (
            !node.number && (
              <Chip icon={CircleDashed} tone="text-warning bg-warning-subtle">
                No number yet
              </Chip>
            )
          )}
          {out.map((n) => (
            <Chip key={n.id}>{n.kind === "place" ? `In ${n.title}` : `Feeds “${n.title}”`}</Chip>
          ))}
        </div>
        <Rests rests={rests} open />
        {node.goalRef && (
          <Button size="sm" variant="secondary" className="self-start" onClick={() => dropKnown(node.goalRef!)}>
            Leave it out
          </Button>
        )}
        {node.goalId && (
          <a href={goalHref(node.goalId)} className="inline-flex items-center gap-[4px] self-start text-caption font-medium text-fg-muted hover:text-fg">
            Its page <ArrowUpRight size={12} {...ICON} />
          </a>
        )}
      </div>
    </Panel>
  );
}
