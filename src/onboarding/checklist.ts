import type { OstKind } from "@/discovery/types";
import type { ChatTurn } from "@/space/chat";

/*
 * The first things to try on a canvas (pure): which card each would run on, and whether it's under
 * way or done. A row ticks by what happened in the canvas's chat, never by what's on the canvas: a
 * goal with a problem under it says nothing about whether they've tried finding one.
 */

export const CHECKLIST = ["goal", "problems", "prd"] as const;
export type ChecklistItem = (typeof CHECKLIST)[number];

export interface ChecklistCard {
  id: string;
  kind: OstKind;
  title: string;
  /** A problem's page no board has yet, drawn faint. */
  faint: boolean;
  /** A problem's page. */
  topic?: string;
  /** A goal's id in goals.md. */
  goal?: string;
  /** A goal is above it on the canvas. */
  underGoal: boolean;
  /** Problems directly under it. */
  problems: number;
  brief: boolean;
}

export type ChecklistTargets = Record<ChecklistItem, ChecklistCard | null>;

/** The card each row would run on: the one they picked where it fits, else the likeliest on the canvas. */
export function checklistTargets(cards: readonly ChecklistCard[], picked: string | null): ChecklistTargets {
  const mine = cards.find((c) => c.id === picked);
  const fits = (c: ChecklistCard | undefined, ok: (c: ChecklistCard) => boolean) => (c && ok(c) ? c : undefined);
  const real = cards.filter((c) => !c.faint);

  const needsGoal = (c: ChecklistCard) => c.kind === "opportunity" && !c.underGoal;
  const isGoal = (c: ChecklistCard) => c.kind === "outcome" && !!c.goal;
  const unwritten = (kind: OstKind) => (c: ChecklistCard) => c.kind === kind && !c.brief;

  return {
    goal: fits(mine, needsGoal) ?? real.find(needsGoal) ?? cards.find(needsGoal) ?? null,
    problems: fits(mine, isGoal) ?? cards.find((c) => isGoal(c) && !c.problems) ?? cards.find(isGoal) ?? null,
    // A solution's says the most about what to build, then a problem's, then a goal's. A faint page gets a card first.
    prd: fits(mine, (c) => !c.faint && !c.brief && c.kind !== "test") ?? real.find(unwritten("solution")) ?? real.find(unwritten("opportunity")) ?? real.find(unwritten("outcome")) ?? cards.find(unwritten("opportunity")) ?? null,
  };
}

/** How far a brain dump's proposals got: `added`, the cards accepted from them. */
export type DumpProgress = { phase?: string; added: number };

export type ChecklistState = "idle" | "going" | "done";

/** Where each row stands in these turns. A goal is found once one's taken, problems once one's accepted, a PRD once it's written. */
export function checklistStates(turns: readonly ChatTurn[], dumpOf: (source: string) => DumpProgress): Record<ChecklistItem, ChecklistState> {
  const out: Record<ChecklistItem, ChecklistState> = { goal: "idle", problems: "idle", prd: "idle" };
  const mark = (item: ChecklistItem, state: ChecklistState) => {
    if (state === "done" || out[item] === "idle") out[item] = state;
  };
  for (const { job } of turns) {
    if (job.kind === "goalfor") {
      if (job.on) mark("goal", "done");
      else if (job.step !== "failed") mark("goal", "going");
    } else if (job.kind === "find" && job.goal) {
      if (!job.error) mark("problems", "going");
    } else if (job.kind === "dump" && job.find?.goal && !job.error) {
      const d = dumpOf(job.source);
      if (d.added > 0) mark("problems", "done");
      else if (d.phase !== "placed" && d.phase !== "failed") mark("problems", "going");
    } else if (job.kind === "brief" || (job.kind === "scan" && job.plan?.brief)) {
      const step = job.kind === "brief" ? job.brief.step : job.plan?.brief?.step;
      if (step === "ready") mark("prd", "done");
      else if (job.kind === "brief" && (step === "asking" || step === "writing")) mark("prd", "going");
    }
  }
  return out;
}

const LABELS: Record<ChecklistItem, string> = {
  goal: "Find a goal for a problem",
  problems: "Find problems for a goal",
  prd: "Write a PRD",
};

export interface ChecklistRow {
  item: ChecklistItem;
  label: string;
  /** The card it would run on, or why it can't run. */
  hint: string;
  state: ChecklistState;
  /** Pressing it starts it, or shows it in the chat when it's going. */
  can: boolean;
}

/** What each row says. `blocked`: why Qalam AI can't start anything now. */
export function checklistRows(o: { targets: ChecklistTargets; states: Record<ChecklistItem, ChecklistState>; done: readonly ChecklistItem[]; blocked: string | null; anyProblem: boolean }): ChecklistRow[] {
  return CHECKLIST.map((item) => {
    const label = LABELS[item];
    if (o.done.includes(item) || o.states[item] === "done") return { item, label, hint: "", state: "done", can: false };
    if (o.states[item] === "going") return { item, label, hint: "Under way in the chat", state: "going", can: true };
    const target = o.targets[item];
    const none = item === "goal" ? (o.anyProblem ? "Every problem here has a goal" : "Add a problem first") : item === "problems" ? "Find a goal first" : "Add a problem first";
    const hint = !target ? none : (o.blocked ?? (item === "prd" ? `A brief for “${target.title}”` : `For “${target.title}”`));
    return { item, label, hint, state: "idle", can: !!target && !o.blocked };
  });
}
