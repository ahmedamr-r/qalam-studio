import { create } from "zustand";
import { callAI } from "@/ai/client";
import { feedback } from "@/commands/feedback";
import { newId } from "@/doc/factory";
import { studio } from "@/doc/store";
import type { DumpRole } from "@/discovery/dump";
import { sharedWords } from "@/discovery/near";
import type { StepId } from "@/discovery/next";
import { cardOf } from "@/discovery/ops";
import { OPEN_ID, answered, answersRecord, followRound, openRound, sanitizeCardQuestions, type AskFor, type CardAnswers } from "@/discovery/questions";
import { quotePiece } from "@/discovery/sources";
import type { GoalLever } from "@/goals/types";
import { contextFor } from "@/org/context";
import { lookOnline } from "@/org/online";
import { boardOfCard, productOfCard, useSpaceView } from "@/space/view";
import type { PlanBucket } from "@/ui/ai/plan";
import type { FlowState } from "@/ui/ai/questionFlow";
import { fileAfterReading } from "../topics/filing";
import { backingFor } from "./backing";
import { begin, end, relabel, stopped } from "./busy";
import { attachQuoteRefs } from "./drop";
import { breakDownFor } from "./goal-steps";
import { recordCall } from "./knowledge";
import { draftSolutionsFor } from "./solutions";
import { addSourceRecord, sourceOf, updateSource, useSources, visitSources } from "./sources";

/*
 * Questions first (src/discovery/questions.ts), beside the card: the person says what they know;
 * the organization's search runs on their words (and, for a problem little backs, a look online in
 * the background); Qalam AI asks a few follow-ups; then the draft runs with their answers. The
 * answers are kept as a source of their own words from the first one on, so the questions pick up
 * where they were; once the draft runs, the card rests on them and they're filed into the pages.
 */

export interface Ask {
  card: string;
  step: AskFor;
  /** open: their own words; reading: searching and Qalam AI writing the follow-ups; follow: answering them; waiting: the look online still going. */
  phase: "open" | "reading" | "follow" | "waiting";
  /** The answers' source, once the first answer is in. */
  source: string | null;
  rounds: PlanBucket[];
  /** What was found on their words (pieces' refs), and how many of them customers said. */
  found: string[];
  customers: number;
  /** People online, looked up on their words. */
  online: { running: boolean; quotes: string[]; note?: string } | null;
  role: DumpRole | null;
  /** Break it down's levers, picked before the questions. */
  levers: GoalLever[];
}

export const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

const patch = (p: Partial<Ask>) => useAsk.setState((s) => (s.ask ? { ask: { ...s.ask, ...p } } : {}));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STEP: Record<AskFor, StepId> = { "draft-solutions": "draft-solutions", "break-down": "break-down", "draft-problems": "draft-problems" };
let looking: AbortController | null = null;

/** The answers kept for a card and not drafted with yet. */
export const keptAnswers = (card: string) => useSources.getState().list.find((s) => s.answers?.card === card && !s.answers.done);

/** Ask before a card's draft, or pick up the questions where they were. */
export function startAsk(card: string, step: AskFor, levers: GoalLever[] = []) {
  const kind = cardOf(studio().doc, card)?.kind;
  if (!kind) return;
  const kept = keptAnswers(card);
  const rounds = kept?.answers?.step === step ? kept.answers.buckets : [openRound(kind)];
  const last = rounds[rounds.length - 1];
  const phase: Ask["phase"] = rounds.length === 1 ? (last.form.submitted ? "reading" : "open") : "follow";
  useAsk.setState({ ask: { card, step, phase, source: kept?.answers?.step === step ? kept.id : null, rounds, found: kept?.answers?.found ?? [], customers: 0, online: null, role: kept?.quotes.find((q) => q.role)?.role ?? null, levers } });
  if (phase === "reading") void readAndAsk();
  else if (phase === "follow" && last.form.submitted) void finish();
}

/** The round being asked, as the person changes it. */
export function changeRound(form: FlowState) {
  const a = useAsk.getState().ask;
  if (a) patch({ rounds: a.rounds.map((b, i) => (i === a.rounds.length - 1 ? { ...b, form } : b)) });
}

/** The round answered (or skipped): kept, then on to the follow-ups, or to the draft. */
export async function answerRound(form: FlowState) {
  changeRound(form);
  const a = useAsk.getState().ask;
  if (!a) return;
  await keep(a);
  if (a.rounds.length === 1) await readAndAsk();
  else await finish();
}

/** The rest of the questions left: the draft runs with what's answered. */
export async function skipQuestions() {
  const a = useAsk.getState().ask;
  if (!a) return;
  patch({ rounds: a.rounds.map((b, i) => (i === a.rounds.length - 1 ? { ...b, form: { ...b.form, submitted: true } } : b)) });
  await finish();
}

/** Stop asking: what was answered stays kept, for next time. */
export function cancelAsk() {
  looking?.abort();
  looking = null;
  useAsk.setState({ ask: null });
}

/** The answers as a source of the person's words (made with the first answer, then kept current). */
async function keep(a: Ask, done = false): Promise<string | null> {
  if (!answered(a.rounds).length && !a.source) return null;
  const doc = studio().doc;
  const t = useSpaceView.getState().things.get(a.card);
  const card: CardAnswers = { v: 1, card: a.card, goal: t?.type === "goal" || t?.type === "card" ? t.goal : null, topic: null, step: a.step, buckets: a.rounds, found: a.found, ...(done ? { done: true } : {}), at: Date.now() };
  const id = a.source ?? newId();
  const rec = answersRecord({ id, board: boardOfCard(a.card) ?? "", title: `Your answers: ${cardOf(doc, a.card)?.title ?? ""}`.slice(0, 200), product: productOfCard(a.card), card, role: a.role, now: Date.now(), quoteId: (q) => `${id}-${q}` });
  if (a.source) await updateSource(id, (s) => ({ ...rec, addedAt: s.addedAt, ...(s.boards ? { boards: s.boards } : {}), ...(s.filed ? { filed: s.filed } : {}) }));
  else await addSourceRecord(rec);
  if (useAsk.getState().ask?.card === a.card) patch({ source: id });
  return id;
}

/** The titles above a card, nearest first (its problem, its goals). */
function above(card: string): string[] {
  const doc = studio().doc;
  const out: string[] = [];
  for (let p = doc.nodes[card]?.parentId; p && out.length < 6; p = doc.nodes[p]?.parentId ?? null) {
    const c = cardOf(doc, p);
    if (c) out.push(`${c.kind === "outcome" ? "Goal" : c.kind === "opportunity" ? "Problem" : c.kind === "solution" ? "Solution" : "Test"}: ${c.title}`);
  }
  return out;
}

/** Their words searched in the organization (and online, for a problem little backs), then Qalam AI's follow-ups. */
async function readAndAsk() {
  const a = useAsk.getState().ask;
  const card = a && cardOf(studio().doc, a.card);
  if (!a || !card) return;
  patch({ phase: "reading" });
  const said = answered(a.rounds).find((x) => x.questionId === OPEN_ID)?.words ?? "";
  const ctrl = begin(a.card, STEP[a.step], "Searching your organization for what you said");
  if (!ctrl) {
    patch({ phase: "open" });
    return void feedback("Qalam AI is still on another card", { id: "discovery.ask" });
  }
  let questions: ReturnType<typeof sanitizeCardQuestions>["questions"] = [];
  try {
    // The search ranks what's nearest, near or not: only what shares two telling words with the card and theirs counts as found.
    const about = [card.title, card.description ?? "", said].join(" ");
    const found = (await backingFor(a.card, said).catch(() => [])).filter((q) => sharedWords(about, q.text) >= 2);
    const customers = found.filter((q) => q.whose === "customers").length;
    patch({ found: found.map((q) => quotePiece(q.quoteId)).slice(0, 20), customers });
    // Little from customers on a problem: what people say online, while the questions are asked.
    if (card.kind === "opportunity" && customers < 2) lookFor(a.card, said);
    relabel(ctrl, "Qalam AI is reading what you said");
    const body = {
      stage: "card-questions" as const,
      product: contextFor(productOfCard(a.card)).slice(0, 2000),
      card: { kind: card.kind, title: card.title.slice(0, 400), description: (card.description ?? "").slice(0, 600), above: above(a.card).map((t) => t.slice(0, 400)) },
      step: a.step,
      said: said.slice(0, 4000),
      found: found.slice(0, 12).map((q, i) => ({ id: `q${i + 1}`, text: q.text.slice(0, 1200), source: q.from.slice(0, 300), speaker: q.speaker?.slice(0, 80) ?? null, kind: q.whose })),
    };
    const { data, model } = await callAI<unknown>("/api/discovery", body, undefined, ctrl.signal);
    const r = sanitizeCardQuestions(data);
    recordCall({ title: "Asked before drafting", org: null, raw: data, model, status: "done", card: a.card });
    patch({ role: r.role });
    questions = r.questions;
  } catch (e) {
    if (stopped(e)) {
      end(ctrl);
      return cancelAsk();
    }
    feedback(`Qalam AI couldn't ask more: ${message(e)}. Drafting with what you said.`, { kind: "error", id: "discovery.ask" });
  } finally {
    end(ctrl);
  }
  const now = useAsk.getState().ask;
  if (!now || now.card !== a.card) return;
  if (!questions.length) return finish();
  patch({ rounds: [...now.rounds, followRound(questions)], phase: "follow" });
  await keep(useAsk.getState().ask!);
}

/** People online on their words, in the background: their quotes join what the draft rests on. */
function lookFor(card: string, said: string) {
  looking?.abort();
  const ctrl = (looking = new AbortController());
  const c = cardOf(studio().doc, card);
  if (!c) return;
  patch({ online: { running: true, quotes: [] } });
  const done = (online: Ask["online"]) => {
    if (looking !== ctrl) return;
    looking = null;
    patch({ online });
    // The questions are answered and waiting on it: the draft runs now.
    if (useAsk.getState().ask?.phase === "waiting") void runDraft();
  };
  void lookOnline({ title: c.title, words: said, product: productOfCard(card), place: { board: boardOfCard(card), card } }, undefined, ctrl.signal)
    .then(async (r) => {
      await visitSources(r.sources ?? []);
      const quotes = (r.sources ?? []).flatMap((id) => sourceOf(id)?.quotes.map((q) => quotePiece(q.id)) ?? []).slice(0, 10);
      done({ running: false, quotes, note: r.error ?? (quotes.length ? `${quotes.length} ${quotes.length === 1 ? "quote" : "quotes"} from people online` : "Nothing online held up") });
    })
    .catch((e) => done({ running: false, quotes: [], ...(stopped(e) ? {} : { note: "Couldn't look online" }) }));
}

/** The questions are done: the draft runs, or waits for the look online. */
async function finish() {
  const a = useAsk.getState().ask;
  if (!a) return;
  if (a.online?.running) return patch({ phase: "waiting" });
  await runDraft();
}

/** Draft now, without waiting for what people say online. */
export function draftNow() {
  looking?.abort();
  looking = null;
  void runDraft();
}

async function runDraft() {
  const a = useAsk.getState().ask;
  if (!a) return;
  useAsk.setState({ ask: null });
  const source = await keep(a, true);
  if (source) {
    // The card rests on their answers (a goal with no board yet is linked through the source instead).
    const s = sourceOf(source);
    if (s && !useSpaceView.getState().virtual.has(a.card)) attachQuoteRefs(a.card, s.quotes.map((q) => ({ sourceId: s.id, quoteId: q.id })), { quiet: true });
    void fileAfterReading([source], productOfCard(a.card));
  }
  const said = { ...(source ? { answers: source } : {}), found: [...a.found, ...(a.online?.quotes ?? [])].slice(0, 20) };
  if (a.step === "draft-solutions") return draftSolutionsFor(a.card, said);
  const t = useSpaceView.getState().things.get(a.card);
  if (a.step === "break-down" && t?.type === "goal") return breakDownFor(a.card, t.goal, a.levers, said);
}
