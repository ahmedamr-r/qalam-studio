import { nanoid } from "nanoid";
import { feedback } from "@/commands/feedback";
import { createGoal, goalsNow } from "@/goals/client";
import type { Topic } from "@/hub/topics";
import { topicsDb } from "@/org/topics";
import { goalHref, topicHref } from "@/projects/model";
import type { Space } from "../frame/spaces";
import { promptDialog } from "../surfaces/dialog";
import { navigate } from "../nav";

/*
 * Making a goal, a problem or a segment from a space's canvas: named in a dialog, then its page
 * opens in the canvas's panel (./page.tsx). A goal goes under the North Star (the first is the
 * North Star); each is for the space's product, or the whole organization on its own canvas.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function newGoal(space: Space) {
  const north = goalsNow().north;
  const title = await promptDialog({
    title: "New goal",
    body: north ? "A change the team is trying to make: it goes under the North Star until you say which goal it feeds." : "The first is the North Star: what the whole company is trying to move.",
    label: "The change it's after",
    placeholder: north ? "More customers reorder every week" : "2M dirhams a month in orders by end of Q2",
    confirmLabel: "Add goal",
    validate: (v) => (v.trim() ? null : "Say what it's after"),
  });
  if (!title?.trim()) return;
  const g = await createGoal({ title: title.trim(), product: space, parent: north, north: "if-none" }).catch((e) => feedback(`Couldn't add it: ${message(e)}`, { kind: "error", id: "goals.new" }));
  if (g) navigate(goalHref(g.id));
}

const ASK = {
  need: { title: "New problem", body: "In the customer's words: what they need, struggle with or wish for.", label: "The problem", placeholder: "I can't plan my day around the delivery window" },
  segment: { title: "New segment", body: "A kind of customer the team tells apart.", label: "Title", placeholder: "Parents of young children" },
} as const;

/** A problem's or a segment's page, empty, for the space's product. */
export async function newTopic(kind: "need" | "segment", space: Space) {
  const a = ASK[kind];
  const title = await promptDialog({ ...a, confirmLabel: "Add page", validate: (v) => (v.trim() ? null : "Name it") });
  if (!title?.trim()) return;
  const now = Date.now();
  const t: Topic = { id: nanoid(10), kind, title: title.trim().replace(/\s+/g, " ").slice(0, 100), products: space ? [space] : [], createdAt: now, updatedAt: now, lines: [], history: [] };
  await topicsDb.put(t, null).then(
    () => navigate(topicHref(t.id)),
    (e) => feedback(`Couldn't add it: ${message(e)}`, { kind: "error", id: "topics.new" }),
  );
}
