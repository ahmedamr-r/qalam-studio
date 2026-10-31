import { nanoid } from "nanoid";
import { problemsCall } from "@/ai/problems";
import { structured } from "@/ai/server";
import { foldBearings, problemsInScope } from "@/goals/bearings";
import { problemsMaterial, sanitizeProblems, type DraftedProblems, type ProblemsDrafted, type ProblemsInput } from "@/goals/drafted";
import { metricLine } from "@/goals/goals-md";
import { chainOf, goalById } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import { isEvidence, isOnline, sameTopic } from "@/hub/topics";
import { coreDeps } from "../capture";
import { wordsPieces, type DraftWords } from "./solutions";
import { NotFoundError, type OrgStore } from "./store";

/**
 * Drafting a goal's problems, in the core (src/goals/drafted.ts): the material is gathered here
 * (the goal and the goals it feeds, the problems behind it and the pages in its scope, the words
 * found near it and the person's answers), one call proposes, code keeps what it can stand behind.
 * The drafts are kept in the goal's work file until each is decided; the canvas reviews them as
 * problems under the goal's card.
 */

const numberOf = (g: Goal) => (g.metric ? `${g.metric.name ? `${g.metric.name}: ` : ""}${metricLine(g.metric)}` : null);

/** One call drafting the problems behind a goal; `cards` are the problems under its card on the canvas. */
export async function draftProblems(store: OrgStore, goalId: string, req: { cards: string[] } & DraftWords, emit: (label: string) => void, opts: { tab?: string; signal?: AbortSignal } = {}): Promise<ProblemsDrafted> {
  const tree = await store.getGoals();
  const goal = goalById(tree, goalId);
  if (!goal) throw new NotFoundError("No such goal");
  emit("Reading what bears on the goal");
  // What's there already: its cards on the canvas, and the pages linked to it; the rest of the pages in its scope are Find its problems'.
  const topics = problemsInScope(await store.listTopics(), goal);
  const linked = new Set(foldBearings(await store.listBearingLog()).links.filter((l) => l.goal === goalId).map((l) => l.need));
  const behind = [...req.cards, ...topics.filter((t) => linked.has(t.id)).map((t) => t.title)].filter((t, i, all) => all.findIndex((x) => sameTopic(x, t)) === i);
  // The words: what they told us when asked and what was found on their words, then quotes near the goal.
  const said = await wordsPieces(store, { answers: req.answers, found: req.found });
  const answers = said.filter((p) => p.label === "Their answers");
  const pieces: ProblemsInput["pieces"] = [...said];
  const deps = await coreDeps(store);
  const pack = await deps.pack({ query: [goal.title, goal.metric?.name, ...answers.map((a) => a.text)].filter(Boolean).join(" · ").slice(0, 2000), product: goal.product ?? undefined, budget: 1800, types: ["quote"] }).catch(() => null);
  for (const p of pack?.pieces ?? [])
    if (p.type === "quote" && !pieces.some((x) => x.ref === p.ref)) pieces.push({ ref: p.ref, text: p.text, label: p.title ?? "", source: p.source, evidence: isEvidence(p), ...(isOnline(p) ? { online: true } : {}) });
  const m = problemsMaterial({
    goal: { title: goal.title, metric: numberOf(goal) },
    above: chainOf(tree, goalId).slice(1).map((g) => ({ title: g.title, metric: numberOf(g) })),
    behind,
    pages: topics.filter((t) => !linked.has(t.id)).map((t) => t.title),
    pieces,
  });
  emit("Qalam AI is drafting the problems behind it");
  const { data, model } = await structured<unknown>(problemsCall(m), opts.signal);
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const { drafts, note } = sanitizeProblems(data, m, { now, id: () => nanoid(10) }, (why, item) => dropped.push({ why, item }));
  // The call's trace: what it was sent (by id), what it answered, what code kept and left out, and why.
  await store
    .putTrace({ id: nanoid(10), projectId: "problems", kind: "draft-problems", at: now, ...(model ? { model } : {}), goal: goalId, sent: { pieces: [...m.pieces].map(([ref, p]) => ({ ref, piece: p.ref })), known: m.known.length }, answer: data, kept: drafts.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  // Where the words they cite live, so the canvas can attach them to the problems it accepts.
  const cited = new Set(drafts.flatMap((d) => d.cites));
  const quotes: ProblemsDrafted["quotes"] = {};
  for (const p of m.pieces.values()) if (cited.has(p.ref) && p.source && p.ref.startsWith("hub:quote:")) quotes[p.ref] = { sourceId: p.source, quoteId: p.ref.slice("hub:quote:".length) };
  const work: DraftedProblems = { at: now, ...(model ? { model } : {}), note, drafts, quotes, decided: {} };
  await store.changeGoalWork(goalId, (w) => ({ ...w, problems: work }), opts);
  return { drafts, note, quotes };
}

/** A person accepted a drafted problem (it's under the goal's card now) or discarded it. */
export async function decideProblem(store: OrgStore, goalId: string, draft: string, decision: "accepted" | "discarded", opts: { tab?: string } = {}) {
  const work = await store.getGoalWork(goalId);
  if (!work.problems?.drafts.some((d) => d.id === draft)) throw new NotFoundError("No such draft");
  await store.changeGoalWork(goalId, (w) => (w.problems ? { ...w, problems: { ...w.problems, decided: { ...w.problems.decided, [draft]: decision } } } : w), opts);
}
