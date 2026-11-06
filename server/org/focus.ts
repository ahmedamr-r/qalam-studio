import { nanoid } from "nanoid";
import { focusQuestionsCall, lookCall } from "@/ai/focus";
import { FOCUS_LIMITS, focusMaterial, focusQuestionsMaterial, focusTask, sanitizeLook, type FocusLook, type FocusLooked } from "@/goals/focus";
import type { OutsidePage } from "@/goals/outside";
import { chainOf, goalById } from "@/goals/tree";
import type { MarketLine } from "@/market/types";
import { sanitizeFindQuestions } from "@/space/find";
import { readLinks, realDeps, type MarketDeps } from "./market";
import { NotFoundError, type OrgStore } from "./store";

/**
 * Finding the problem to focus on for a goal, in the core (src/goals/focus.ts): a look on the web
 * for what usually gets in the way of goals like it, or for what the person's answers called for
 * (`query`). The research step searches, code reads the pages it links itself (./pages.ts), one call
 * picks out what they say, and code keeps a line only where its quote is on its page word for word.
 * The looks are kept in the goal's work file (hub/goals/<goal>.json), for what's asked about it later.
 * The opening look (`open`) also works out the first questions to ask, their choices drawn from what
 * was read, what's known about the company and its domain.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export async function lookForGoal(store: OrgStore, goalId: string, o: { query?: string; said?: string; open?: boolean }, emit: (label: string) => void, signal: AbortSignal, deps: MarketDeps = realDeps): Promise<FocusLooked> {
  const tree = await store.getGoals();
  const goal = goalById(tree, goalId);
  if (!goal) throw new NotFoundError("No such goal");
  const about = await store.getAbout();
  const aboutLine = [about.context, about.audience].filter((x) => x.trim()).join(" ");
  const product = goal.product ? (await store.listProducts()).find((p) => p.id === goal.product) : undefined;
  const market = await store.getMarket();
  const chain = chainOf(tree, goalId);
  const org = store.info.name;
  const query = one(o.query ?? "").slice(0, FOCUS_LIMITS.query);
  // A look for what their answers called for hears what the latest looks found, and reads pages they didn't first.
  const before = query ? ((await store.getGoalWork(goalId)).focus?.looks ?? []).slice(-3) : [];
  const known = before.flatMap((l) => l.lines);
  const seen = new Set(before.flatMap((l) => l.pages.map((p) => p.url)));
  emit(query ? `Looking on the web for “${query}”` : "Looking on the web for what usually gets in the way of goals like it");
  const info = await deps.research({ purpose: "problems", task: focusTask({ org, about: aboutLine, product: product?.name, chain, goal, facts: market.company, query, said: o.said?.slice(0, FOCUS_LIMITS.said) }), connectors: ["web"] }, emit, signal);
  let lines: MarketLine[] = [];
  let pages: OutsidePage[] = [];
  if (info && !signal.aborted) {
    emit("Reading the pages it found");
    pages = await readLinks(deps, seen.size ? { ...info, sources: [...info.sources].sort((a, b) => Number(seen.has(a.url)) - Number(seen.has(b.url))) } : info, signal);
    if (pages.length && !signal.aborted) {
      emit("Qalam AI is checking each point on its page");
      const m = focusMaterial({ org, goal, query, known, notes: info.notes, pages });
      const { data, model } = await deps.structured<unknown>(lookCall(m), signal);
      const now = Date.now();
      const dropped: { why: string; item: unknown }[] = [];
      lines = sanitizeLook(data, m, { now, id: () => `f${nanoid(8)}`, known }, (why, item) => dropped.push({ why, item }));
      await store
        .putTrace({ id: nanoid(10), projectId: "goals", kind: "focus-look", at: now, ...(model ? { model } : {}), goal: goalId, query, pages: [...m.pages.values()].map((p) => ({ ref: p.ref, url: p.url })), answer: data, kept: lines.length, dropped } as { id: string; projectId: string })
        .catch(() => {});
    }
  }
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  const look: FocusLook = { at: Date.now(), query, lines, pages: pages.map((p) => ({ title: p.title, url: p.url })), ...(info ? {} : { noWeb: true as const }) };
  if (info) await store.changeGoalWork(goalId, (w) => ({ ...w, focus: { looks: [...(w.focus?.looks ?? []), look].slice(-FOCUS_LIMITS.looks) } }));
  if (!o.open) return { look, questions: [] };
  emit("Qalam AI is working out what to ask you");
  const m = focusQuestionsMaterial({ org, about: aboutLine, goal, chain, market, lines });
  const questions = await deps.structured<unknown>(focusQuestionsCall(m), signal).then(
    async (r) => {
      const kept = sanitizeFindQuestions(r.data, m);
      await store.putTrace({ id: nanoid(10), projectId: "goals", kind: "focus-questions", at: Date.now(), ...(r.model ? { model: r.model } : {}), goal: goalId, answer: r.data, kept: kept.map((q) => q.title) } as { id: string; projectId: string }).catch(() => {});
      return kept;
    },
    (e: unknown) => {
      if (signal.aborted) throw e;
      return [];
    },
  );
  return { look, questions };
}
