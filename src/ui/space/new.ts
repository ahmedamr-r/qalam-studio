import { nanoid } from "nanoid";
import { feedback } from "@/commands/feedback";
import { studio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { createGoal, goalsNow } from "@/goals/client";
import type { Topic } from "@/hub/topics";
import { topicsDb } from "@/org/topics";
import { goalHref, topicHref } from "@/projects/model";
import type { Space } from "../frame/spaces";
import { promptDialog } from "../surfaces/dialog";
import { navigate } from "../nav";
import { useSources } from "../discovery/sources";
import { created } from "../discovery/commands";
import { show } from "./links";
import { showDock } from "./dock";

/*
 * Making a goal, a problem or a segment from a space's canvas. A goal's or a problem's card is
 * written on the canvas itself (writeCard): typed in place, or in the words sent to the chat; a
 * goal's card becomes a goal in goals.md as the canvas saves (./goals.ts). A problem's or a
 * segment's page is named in a dialog, then opens in the canvas's panel (./page.tsx). Each is for
 * the space's product, or the whole organization on its own canvas.
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

export type Written = "outcome" | "opportunity";

/** Where a new card goes: under the card picked when it can hold one (a goal under a goal, a problem under a goal or a problem), else at the top. */
export function placeFor(kind: Written): string | null {
  const s = studio();
  const id = s.selection.length === 1 ? s.selection[0] : null;
  const k = id && !id.startsWith("topic:") && isOstCard(s.doc.nodes[id]) ? s.doc.nodes[id].meta.ost!.kind : null;
  return k === "outcome" || (kind === "opportunity" && k === "opportunity") ? id : null;
}

/**
 * A goal or a problem written on the canvas: with `title` (their words, sent to the chat) it's
 * put there and shown; without, its title is typed in place (Esc takes it back). One undo step.
 */
export function writeCard(kind: Written, o: { title?: string; under?: string | null } = {}): string {
  const s = studio();
  const under = o.under !== undefined ? o.under : placeFor(kind);
  const node = makeCardNode(newCard(kind, o.title ? { title: o.title } : {}));
  if (!o.title) s.beginTx();
  s.mutate((d) => {
    const at = under && d.nodes[under] ? under : null;
    // Folded, the card it goes under opens to show it.
    if (at) delete d.nodes[at].meta.ost!.collapsed;
    addCardIn(d, node, at);
  });
  if (o.title) show(node.id);
  else created(node.id, () => s.cancelTx(), "");
  return node.id;
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

/** Adding what customers said: the canvas's sources open on adding to the organization (whose words they are first). */
export function addMaterial() {
  studio().select([]);
  useSources.setState({ adding: true, open: null });
  showDock(true);
}
