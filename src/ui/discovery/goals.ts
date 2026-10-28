import { produce } from "immer";
import type { Doc } from "@/doc/schema";
import { studio, useStudio } from "@/doc/store";
import { cardOf, updateCardIn } from "@/discovery/ops";
import type { Decision } from "@/decisions/model";
import { changeGoal, createGoal, goalsNow, useGoals } from "@/goals/client";
import { applyCopy, copyOfCard, goalSide, reconcile, sameCopy, type GoalCopy } from "@/goals/mirror";
import { currentProject } from "@/projects/session";
import { useWhy } from "../decisions/recorder";

/*
 * A board's outcome cards and the goals they work on (goals.md), while the board is open
 * (src/goals/mirror.ts decides what to change). On opening, and whenever a goal changes elsewhere,
 * the card shows the goal's words, number and stage, outside undo history. An edit to the card on
 * the board goes to the goal once changes settle, and the goal's change records the decision:
 * the board's own recorder leaves a linked card's number and stage to it.
 */

const SETTLE = 1500;

/** Each linked card's copy as the card and its goal last agreed. */
let synced = new Map<string, GoalCopy>();
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<void> = Promise.resolve();
let stopActive: (() => void) | null = null;
/** Who the next edits are by: Qalam AI's, for proposals just accepted. */
let nextBy: Decision["by"] = "you";

/** The outcome cards on this board that work on a goal. */
export function linkedCards(): Set<string> {
  const p = currentProject();
  if (!p) return new Set();
  return new Set(useGoals.getState().goals.flatMap((g) => (g.on?.board === p.id ? [g.on.card] : [])));
}

/** The goals this board works on. */
export function boardGoalIds(): string[] {
  const p = currentProject();
  return p ? useGoals.getState().goals.filter((g) => g.on?.board === p.id).map((g) => g.id) : [];
}

export function startGoalSync(): () => void {
  stopActive?.();
  synced = new Map();
  void syncGoals();
  const unDoc = useStudio.subscribe((s, prev) => {
    if (s.doc === prev.doc || s.txBase) return;
    clearTimeout(timer);
    timer = setTimeout(() => void syncGoals(), SETTLE);
  });
  const unGoals = useGoals.subscribe((s, prev) => {
    if (s.goals !== prev.goals || s.loaded !== prev.loaded) void syncGoals();
  });
  const onHide = () => document.visibilityState === "hidden" && void syncGoals({ leaving: true });
  document.addEventListener("visibilitychange", onHide);
  const stop = () => {
    clearTimeout(timer);
    unDoc();
    unGoals();
    document.removeEventListener("visibilitychange", onHide);
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}

/** The next card edits sent to their goals are Qalam AI's (its proposals, accepted). */
export function editsByQalam() {
  nextBy = "qalam";
}

/** Bring the board's outcome cards and their goals together now. */
export function syncGoals(o: { leaving?: boolean } = {}): Promise<void> {
  queue = queue.then(() => syncOnce(o)).catch(() => {});
  return queue;
}

async function syncOnce(o: { leaving?: boolean }) {
  const p = currentProject();
  if (!p || p.type !== "discovery" || !useGoals.getState().loaded) return;
  if (studio().txBase) return;
  const r = reconcile({ board: p.id, product: p.product ?? null, doc: studio().doc, goals: goalsNow(), synced, now: Date.now() });
  const by = nextBy;
  if (r.toGoal.size || r.link.size) nextBy = "you";
  const toCard = [...r.toCard].flatMap(([card, copy]) => {
    const c = cardOf(studio().doc, card);
    return c && !sameCopy(copyOfCard(c), copy) ? [{ card, copy, kept: goalSide(synced.get(card), copy, copyOfCard(c)) }] : [];
  });
  if (toCard.length) {
    studio().mutate(
      (d) => {
        for (const x of toCard) updateCardIn(d, x.card, (c) => applyCopy(c, x.copy));
      },
      { history: false },
    );
    // Undo and redo keep what came from the goal: each step back holds it too.
    const keep = (d: Doc) =>
      toCard.some((x) => cardOf(d, x.card))
        ? produce(d, (draft) => {
            for (const x of toCard) if (cardOf(draft, x.card)) updateCardIn(draft, x.card, (c) => applyCopy(c, x.kept));
          })
        : d;
    const { past, future } = useStudio.getState();
    useStudio.setState({ past: past.map(keep), future: future.map(keep) });
  }
  synced = r.synced;
  const keepalive = o.leaving;
  for (const g of r.create) await createGoal({ id: g.id, title: g.title, parent: g.parent, product: g.product, ...(g.metric ? { metric: g.metric } : {}), status: g.status, ...(g.on ? { on: g.on } : {}) }).catch(() => {});
  for (const [goal, card] of r.link) await changeGoal(goal, { on: { board: p.id, card } }, { by, keepalive }).catch(() => {});
  for (const [goal, copy] of r.toGoal) {
    const res = await changeGoal(goal, { title: copy.title, metric: copy.metric ?? null, status: copy.stage }, { by, keepalive }).catch(() => null);
    // A big change asks why, as one made on the board does.
    const big = res?.decisions.find((d) => d.big && d.by === "you" && !d.why);
    if (big && !keepalive) useWhy.setState({ ask: big });
  }
  for (const goal of r.unlink) await changeGoal(goal, { on: null }, { keepalive }).catch(() => {});
}
