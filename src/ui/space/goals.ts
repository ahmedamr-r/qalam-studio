import { studio, useStudio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { changeGoal, createGoal, goalsNow } from "@/goals/client";
import { outcomeGoalId } from "@/goals/migrate";
import { copyOfCard, copyOfGoal, sameCopy, type GoalCopy } from "@/goals/mirror";
import { allCards } from "@/discovery/tree";
import { onSpaceComposed } from "@/space/session";
import { boardOfCard, useSpaceView } from "@/space/view";
import { useWhy } from "../decisions/recorder";

/*
 * Goals' cards on a space's canvas and goals.md (src/goals). The canvas is composed with each
 * goal's words, number and status; an edit to a goal's card goes to the goal once changes settle
 * (a goal with no board too), and the goal's change records the decision. A goal's card deleted
 * takes the goal off its board (the goal stays, with no board yet). An outcome card saved on a
 * board that isn't a goal yet becomes one, under the goal above it (at the top: under the North
 * Star, or the North Star when there's none). What goals.md changes elsewhere comes back in when
 * the canvas is composed again.
 */

const SETTLE = 1500;

/** Each goal's card as it and its goal last agreed. */
let synced = new Map<string, GoalCopy>();
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<void> = Promise.resolve();
let started = false;
/** Goals already taken off a board from here (until the canvas is composed again). */
let unlinked = new Set<string>();

export function startSpaceGoalSync() {
  if (started) return;
  started = true;
  onSpaceComposed((s) => {
    synced = new Map();
    unlinked = new Set();
    for (const [id, t] of s.things) {
      const card = t.type === "goal" ? cardOf(s.doc, id) : null;
      if (card) synced.set(id, copyOfCard(card));
    }
  });
  useStudio.subscribe((s, prev) => {
    if (s.doc === prev.doc || s.txBase || !useSpaceView.getState().active) return;
    clearTimeout(timer);
    timer = setTimeout(() => void syncSpaceGoals(), SETTLE);
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void syncSpaceGoals());
}

/** Bring the canvas's goal cards and goals.md together now. */
export function syncSpaceGoals(): Promise<void> {
  clearTimeout(timer);
  queue = queue.then(syncOnce).catch(() => {});
  return queue;
}

async function syncOnce() {
  const v = useSpaceView.getState();
  if (!v.active || studio().txBase) return;
  const doc = studio().doc;
  const goals = goalsNow().goals;
  for (const [id, t] of v.things) {
    if (t.type !== "goal") continue;
    const g = goals.find((x) => x.id === t.goal);
    if (!g) continue;
    const card = cardOf(doc, id);
    // Its card deleted here: the goal leaves its board, and stays a goal.
    if (!card) {
      if (t.board && g.on && !unlinked.has(g.id)) {
        unlinked.add(g.id);
        await changeGoal(g.id, { on: null }).catch(() => {});
      }
      continue;
    }
    const copy = copyOfCard(card);
    const last = synced.get(id) ?? copyOfGoal(g);
    if (!copy.title || sameCopy(copy, last)) continue;
    synced.set(id, copy);
    if (sameCopy(copy, copyOfGoal(g))) continue;
    const res = await changeGoal(g.id, { title: copy.title, metric: copy.metric ?? null, status: copy.stage }).catch(() => null);
    const big = res?.decisions.find((d) => d.big && d.by === "you" && !d.why);
    if (big) useWhy.setState({ ask: big });
  }
  // Outcome cards that aren't goals yet, once they're on a board: each becomes a goal under the goal above it.
  const ids = new Set(goals.map((g) => g.id));
  for (const { id, card } of allCards(doc)) {
    if (card.kind !== "outcome" || v.things.get(id)?.type === "goal" || !card.title.trim()) continue;
    const board = boardOfCard(id);
    if (!board) continue;
    const gid = outcomeGoalId(board, id);
    if (ids.has(gid)) continue;
    let up = doc.nodes[id].parentId;
    while (up && v.things.get(up)?.type !== "goal") up = doc.nodes[up]?.parentId ?? null;
    const above = up ? v.things.get(up) : undefined;
    const copy = copyOfCard(card);
    ids.add(gid);
    // One at the top goes under the North Star, as a goal made by hand does; the first one is the North Star.
    const parent = above?.type === "goal" ? above.goal : goalsNow().north;
    await createGoal({ id: gid, title: copy.title, parent, ...(parent ? {} : { north: "if-none" as const }), product: v.boards.get(board)?.product ?? null, ...(copy.metric ? { metric: copy.metric } : {}), status: copy.stage, on: { board, card: id } }).catch(() => {});
  }
}
