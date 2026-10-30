import { useState } from "react";
import clsx from "clsx";
import { Flag, Target } from "lucide-react";
import { metricText } from "@/discovery/dump";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import type { OstMetric, OstStage } from "@/discovery/types";
import { emptyDoc } from "@/doc/schema";
import type { Product } from "@/org/context-md";
import { goalServed, type Serves, type StatedGoal } from "@/org/goals";
import { projectHref } from "@/projects/model";
import { createProject } from "@/projects/session";
import { r } from "../recipes";
import { goalDetails } from "./ContextEditor";

/**
 * The organization's goals: the ones it and its products state (the one that leads first), each
 * with the outcomes on boards that serve it, sub-outcomes under the outcome they move, and a way
 * to start a board for a goal nothing serves. Outcomes that serve no stated goal come last. Each
 * outcome opens its board on that card.
 */

export interface Goal {
  board: string;
  boardName: string;
  product: string | null;
  id: string;
  title: string;
  metric?: OstMetric;
  parent: string | null;
  serves?: Serves;
  stage?: OstStage;
}

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const key = (g: Pick<Goal, "board" | "id">) => `${g.board}:${g.id}`;

/** A board whose outcome serves a stated goal, for the goal's product: opened on it. */
export async function startBoardFor(g: StatedGoal) {
  const doc = emptyDoc();
  addCardIn(doc, makeCardNode(newCard("outcome", { title: g.goal.text, serves: { goal: g.goal.id, product: g.product } })), null);
  const p = await createProject("discovery", g.goal.text.slice(0, 80), g.product ? { product: g.product } : {}, doc);
  window.location.assign(projectHref(p));
}

/** Outcomes as a tree: each with the sub-outcomes under it. */
function OutcomeRows({ goals, roots, showBoard, depth = 0 }: { goals: Goal[]; roots: Goal[]; showBoard: boolean; depth?: number }) {
  return (
    <ul className="flex flex-col">
      {roots.map((g) => {
        const metric = metricText(g.metric);
        const kids = goals.filter((x) => x.board === g.board && x.parent === g.id);
        return (
          <li key={key(g)}>
            <a href={`${projectHref({ id: g.board, type: "discovery" })}?card=${g.id}`} className="q-item flex items-start gap-[10px] rounded-md px-[8px] py-[6px] hover:bg-hover" style={{ paddingLeft: 8 + depth * 20 }}>
              <span className="mt-[2px] text-fg-subtle">
                <Target {...ICON} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body text-fg">
                  {g.title}
                  {g.stage && g.stage !== "active" && <span className="ml-[6px] text-caption text-fg-subtle">{g.stage}</span>}
                </span>
                {(metric || showBoard) && <span className="truncate text-caption text-fg-muted">{[metric, showBoard && g.boardName].filter(Boolean).join(" · ")}</span>}
              </span>
            </a>
            {kids.length > 0 && <OutcomeRows goals={goals} roots={kids} showBoard={showBoard} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

export function GoalsList({ goals, stated, products, showBoard = true }: { goals: Goal[]; stated: StatedGoal[]; products: Product[]; showBoard?: boolean }) {
  const [starting, setStarting] = useState<string | null>(null);
  // A sub-outcome whose parent isn't listed (another product) shows on its own.
  const roots = goals.filter((g) => !g.parent || !goals.some((x) => x.board === g.board && x.id === g.parent));
  const owner = (p: string | null) => (p ? (products.find((x) => x.id === p)?.name ?? "A product") : "The organization");
  const untied = roots.filter((g) => !goalServed(g.serves, stated));
  if (!stated.length && !goals.length) return <p className="text-body text-fg-muted">No goals yet. Say what the organization and each product are trying to move in their About, then start a board for each.</p>;
  return (
    <div className="flex flex-col gap-[12px]">
      {stated.length > 0 && (
        <ul className="flex flex-col gap-[8px]">
          {stated.map((g) => {
            const serving = roots.filter((o) => o.serves?.goal === g.goal.id && (o.serves.product ?? null) === g.product);
            const id = `${g.product ?? "org"}:${g.goal.id}`;
            return (
              <li key={id} className="flex flex-col gap-[2px] rounded-lg bg-panel px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
                <div className="flex items-start gap-[10px]">
                  <span className="mt-[2px] text-fg-subtle">
                    <Flag {...ICON} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body font-medium text-fg">
                      {g.goal.text}
                      {g.lead && <span className="ml-[6px] text-caption font-normal text-fg-subtle">leads</span>}
                    </span>
                    <span className="text-caption text-fg-muted">{[owner(g.product), goalDetails(g.goal)].filter(Boolean).join(" · ")}</span>
                  </div>
                  {!serving.some((o) => o.stage === "active" || o.stage === "achieved") && (
                    <button
                      type="button"
                      disabled={starting === id}
                      onClick={() => {
                        setStarting(id);
                        void startBoardFor(g).catch(() => setStarting(null));
                      }}
                      className={clsx(r.buttonSm, r.buttonSecondary, "shrink-0")}
                    >
                      {starting === id ? "Starting…" : "Start a board"}
                    </button>
                  )}
                </div>
                {serving.length ? <OutcomeRows goals={goals} roots={serving} showBoard={showBoard} depth={1} /> : <p className="pl-[24px] text-caption text-fg-subtle">No board works on it yet.</p>}
              </li>
            );
          })}
        </ul>
      )}
      {untied.length > 0 && (
        <div className="flex flex-col gap-[4px]">
          {stated.length > 0 && <h3 className="text-caption font-medium text-fg-muted">Outcomes that serve no stated goal</h3>}
          <OutcomeRows goals={goals} roots={untied} showBoard={showBoard} />
        </div>
      )}
    </div>
  );
}
