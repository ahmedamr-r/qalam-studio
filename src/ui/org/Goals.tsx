import { useState } from "react";
import clsx from "clsx";
import { Flag, Target } from "lucide-react";
import { aiStatus } from "@/ai/client";
import { sourcesDb } from "@/discovery/db";
import { metricText } from "@/discovery/dump";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import type { OstEvidence, OstMetric, OstStage } from "@/discovery/types";
import { newId } from "@/doc/factory";
import { emptyDoc } from "@/doc/schema";
import type { OutcomeCandidate } from "@/hub/outcomes";
import { orgJson } from "@/org/client";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Spinner } from "../controls";
import type { Product } from "@/org/context-md";
import { goalServed, type Serves, type StatedGoal } from "@/org/goals";
import { projectHref } from "@/projects/model";
import { createProject } from "@/projects/session";
import { r } from "../recipes";
import { goalDetails } from "./ContextEditor";

/**
 * The organization's goals: the ones it and its products state (the one that leads first), each
 * with the outcomes on boards that serve it, sub-outcomes under the outcome they move, and a way
 * to start a board for a goal nothing serves. Qalam AI can propose which outcomes would move a
 * goal, from the needs the organization knows (server/org/outcomes.ts); a board started from one
 * rests on those needs' quotes. Outcomes that serve no stated goal come last. Each outcome opens
 * its board on that card.
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
  owner?: string;
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

interface NeedQuote {
  piece: string;
  text: string;
  sourceId: string;
  sourceTitle: string;
  speaker?: string;
  span: [number, number];
}
interface Proposal {
  candidates: OutcomeCandidate[];
  needs: Record<string, { title: string; quotes: NeedQuote[] }>;
  note?: string;
}

/** A board from a proposed outcome: the outcome serving the goal, the needs it rests on under it, each on its customers' words. */
export async function startBoardFromCandidate(g: StatedGoal, c: OutcomeCandidate, needs: Proposal["needs"]) {
  const doc = emptyDoc();
  const outcome = makeCardNode(newCard("outcome", { title: c.title, createdBy: "ai", description: c.why, serves: { goal: g.goal.id, product: g.product }, metric: { name: c.metric.name, direction: c.metric.direction, baseline: null, current: null, target: null } }));
  addCardIn(doc, outcome, null);
  const now = Date.now();
  const sources = new Set<string>();
  for (const id of c.needs) {
    const n = needs[id];
    if (!n) continue;
    const evidence: OstEvidence[] = n.quotes.map((q) => {
      sources.add(q.sourceId);
      return { id: newId(), kind: "quote", text: q.text, piece: q.piece, sourceId: q.sourceId, sourceTitle: q.sourceTitle, span: q.span, ...(q.speaker ? { speaker: q.speaker } : {}), addedBy: "ai", at: now };
    });
    addCardIn(doc, makeCardNode(newCard("opportunity", { title: n.title, createdBy: "ai", evidence })), outcome.id);
  }
  const p = await createProject("discovery", c.title.slice(0, 80), g.product ? { product: g.product } : {}, doc);
  // The quotes' sources come onto the board with them.
  for (const s of sources) await sourcesDb.link(s, p.id, true).catch(() => {});
  window.location.assign(projectHref(p));
}

const CONTROL: Record<OutcomeCandidate["control"], string> = { yes: "The team can move it", partly: "The team moves it in part", no: "Mostly outside the team's control" };

/** Qalam AI's proposed outcomes for a goal, each with why and how it moves the goal. */
function OutcomeIdeas({ g, onClose }: { g: StatedGoal; onClose: () => void }) {
  const [state, setState] = useState<{ busy: boolean; result: Proposal | null; error: string | null }>({ busy: false, result: null, error: null });
  const [starting, setStarting] = useState<number | null>(null);
  const ask = async () => {
    setState({ busy: true, result: null, error: null });
    try {
      if (!(await aiStatus()).ai) throw new Error("Qalam AI isn't set up here.");
      setState({ busy: false, result: await orgJson<Proposal>("/outcomes", { method: "POST", json: { product: g.product, goal: g.goal.id } }), error: null });
    } catch (e) {
      setState({ busy: false, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const r0 = state.result;
  return (
    <div className="ml-[24px] flex flex-col gap-[8px] rounded-md bg-muted px-[10px] py-[8px]">
      <div className="flex items-center justify-between gap-[8px]">
        <p className="text-caption text-fg-muted">Which change in what customers do would move this goal? Qalam AI proposes some from the needs the organization knows; code keeps each only on what it cites.</p>
        <span className="flex shrink-0 gap-[6px]">
          <button type="button" disabled={state.busy} onClick={() => void ask()} className={clsx(r.buttonSm, r.buttonSecondary)}>
            {state.busy ? <Spinner size={12} /> : <QalamAIGlyph size={12} />} {r0 ? "Ask again" : "Propose outcomes"}
          </button>
          <button type="button" onClick={onClose} className={clsx(r.buttonSm, r.buttonGhost)}>
            Close
          </button>
        </span>
      </div>
      {state.error && <p className="text-caption text-danger">{state.error}</p>}
      {r0 && !r0.candidates.length && <p className="text-caption text-fg-muted">{r0.note ?? "No outcome holds up on what the organization knows yet. Add what customers say, then ask again."}</p>}
      {r0?.candidates.map((c, i) => (
        <div key={c.title} className="flex flex-col gap-[4px] rounded-md bg-panel px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <div className="flex items-start justify-between gap-[8px]">
            <span className="flex flex-col">
              <span className="text-body font-medium text-fg">{c.title}</span>
              <span className="text-caption text-fg-muted">
                {c.metric.name} · better when it goes {c.metric.direction === "increase" ? "up" : "down"} · {CONTROL[c.control]}
              </span>
            </span>
            <button
              type="button"
              disabled={starting !== null}
              onClick={() => {
                setStarting(i);
                void startBoardFromCandidate(g, c, r0.needs).catch(() => setStarting(null));
              }}
              className={clsx(r.buttonSm, r.buttonSecondary, "shrink-0")}
            >
              {starting === i ? "Starting…" : "Start a board from it"}
            </button>
          </div>
          <p className="text-caption text-fg">{c.why}</p>
          <p className="text-caption text-fg-muted">{c.moves}</p>
          {c.needs.length > 0 && <p className="text-micro text-fg-subtle">Rests on: {c.needs.map((n) => `“${r0.needs[n]?.title ?? "a need"}”`).join(", ")}</p>}
        </div>
      ))}
      {r0 && r0.candidates.length > 0 && r0.note && <p className="text-caption text-fg-muted">{r0.note}</p>}
    </div>
  );
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
                {(metric || showBoard || g.owner) && <span className="truncate text-caption text-fg-muted">{[metric, g.owner && `owner: ${g.owner}`, showBoard && g.boardName].filter(Boolean).join(" · ")}</span>}
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
  const [ideas, setIdeas] = useState<string | null>(null);
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
                  <span className="flex shrink-0 gap-[6px]">
                    {ideas !== id && (
                      <button type="button" onClick={() => setIdeas(id)} className={clsx(r.buttonSm, r.buttonGhost)}>
                        <QalamAIGlyph size={12} /> Which outcomes?
                      </button>
                    )}
                    {!serving.some((o) => o.stage === "active" || o.stage === "achieved") && (
                      <button
                        type="button"
                        disabled={starting === id}
                        onClick={() => {
                          setStarting(id);
                          void startBoardFor(g).catch(() => setStarting(null));
                        }}
                        className={clsx(r.buttonSm, r.buttonSecondary)}
                      >
                        {starting === id ? "Starting…" : "Start a board"}
                      </button>
                    )}
                  </span>
                </div>
                {ideas === id && <OutcomeIdeas g={g} onClose={() => setIdeas(null)} />}
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
