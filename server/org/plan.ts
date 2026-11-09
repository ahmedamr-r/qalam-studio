import { nanoid } from "nanoid";
import { askTurnCall } from "@/ai/asking";
import { planCall, planLookCall, routeCall } from "@/ai/canvas-plan";
import { sanitizeTurn } from "@/asking/sanitize";
import type { AskTurn } from "@/asking/types";
import { AskingIn, askingBlock, checkOf, type AskingInT } from "@/asking/wire";
import { pieceBasis } from "@/discovery/basis";
import { sanitizeLook, type FocusLook } from "@/goals/focus";
import type { OutsidePage } from "@/goals/outside";
import { isEvidence, isOnline, sameTopic } from "@/hub/topics";
import { pageLines, pagesBlock, type PagesSent } from "@/market/rivals";
import type { MarketLine } from "@/market/types";
import { planAnswers, planAskMaterial, planMaterial, planRound, planTask, planTweak, sanitizePlan, sanitizeRoute, type OutlineCard, type PlanAnswer, type PlanDraft, type PlanKept, type PlanLook, type PlanPiece, type PlanRound } from "@/space/plan";
import { termsFold } from "@/terms/fold";
import { indexFor } from "../index/registry";
import { labOn } from "../lab";
import { lookupKinds } from "../connectors/everywhere";
import { companyContext, researchAbout } from "./company";
import { consultInOf, consultNext, type ConsultIn } from "./consult";
import { PLAYBOOKS } from "@/consult/playbooks.gen";
import { recallFor, subjectOf, withKnown } from "./memory";
import { readLinks, realDeps, type MarketDeps } from "./market";
import type { OrgStore } from "./store";

/**
 * Working something out as a plan, in the core (src/space/plan.ts). The window keeps the conversation
 * on its chat turn and sends it with each call, so nothing here is kept but the calls' traces: a look on
 * the web, each turn of the interview (src/asking/), and what to propose, the words behind the problems
 * found here.
 */

export interface PlanBody {
  said: string;
  outline: OutlineCard[];
  /** A plan's rounds from before the interview: answers kept as words. */
  rounds: PlanRound[];
  looks: PlanLook[];
  /** The interview so far (src/asking/wire.ts). */
  asking?: AskingInT;
  /** Pieces a lookup in their project found (hub:quote:…): what a card may rest on beside the problems' words. */
  found?: string[];
  /** What their own evidence said against what was proposed before, which they kept (src/challenge/): proposing again goes by it. */
  kept?: PlanKept[];
  /** Worked out with a consultant (server/org/consult.ts): who's asking, how much they know, the playbook in use. */
  mode?: "consult";
  consult?: ConsultIn;
}

/** What proposing reads as answers: the interview's, else a plan's rounds from before. */
const answersFor = (b: PlanBody): PlanAnswer[] => (b.asking ? b.asking.rounds.flatMap((r) => r.asked.map((a) => ({ question: a.title, answer: a.answer, how: a.how }))) : planAnswers(b.rounds));

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const aboutLine = async (store: OrgStore) => {
  const about = await store.getAbout();
  return [about.context, about.audience].filter((x) => x.trim()).join(" ");
};

/** How a question is taken: asking what's known, or asking to work something out. It's a small call, and any trouble makes it a plain question. */
export async function routeQuestion(said: string, signal: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<{ route: "ask" | "plan" }> {
  const route = await deps.structured<unknown>(routeCall(said), signal).then(
    (r) => sanitizeRoute(r.data),
    (e: unknown) => {
      if (signal.aborted) throw e;
      return "ask" as const;
    },
  );
  return { route };
}

/** A look on the web: what people do about this, whichever way, or (`query`) what their answers called for. Nothing's kept: the lines go back to the chat. */
export async function lookForPlan(store: OrgStore, b: PlanBody & { query?: string }, emit: (label: string) => void, signal: AbortSignal, deps: MarketDeps = realDeps): Promise<FocusLook> {
  const query = one(b.query ?? "");
  emit(query ? `Looking on the web for “${query}”` : "Looking on the web for what people do about this");
  const own = answersFor(b).filter((a) => a.how === "own" && a.answer.trim());
  const task = planTask({ org: store.info.name, about: await researchAbout(store, await aboutLine(store)), said: b.said, query, answers: own.map(({ question, answer }) => ({ question, answer })), outline: b.outline });
  const info = await deps.research({ purpose: "plan", task, connectors: ["web"] }, emit, signal);
  let lines: MarketLine[] = [];
  let pages: OutsidePage[] = [];
  const known = b.looks.flatMap((l) => l.lines);
  if (info && !signal.aborted) {
    emit("Reading the pages it found");
    const seen = new Set(b.looks.flatMap((l) => l.pages.map((p) => p.url)));
    pages = await readLinks(deps, seen.size ? { ...info, sources: [...info.sources].sort((a, c) => Number(seen.has(a.url)) - Number(seen.has(c.url))) } : info, signal);
    if (pages.length && !signal.aborted) {
      emit("Checking each point on its page");
      const block = pagesBlock(pages);
      const m: PagesSent = {
        pages: block,
        text: [`They asked: “${one(b.said)}”`, query ? `What was looked up: ${query}` : "What was looked up: what people do about this.", ...(known.length ? ["", "Found on earlier looks (leave these out):", ...known.map((l) => `- ${one(l.text)}`)] : []), "", info.notes.trim() ? `What the research step wrote:\n${info.notes.trim()}` : "The research step found nothing.", "", "The pages, as read (id · title · address, then the page's start):", ...pageLines(block)].join("\n"),
      };
      const { data, model } = await deps.structured<unknown>(planLookCall(m), signal);
      const now = Date.now();
      const dropped: { why: string; item: unknown }[] = [];
      lines = sanitizeLook(data, m, { now, id: () => `f${nanoid(8)}`, known }, (why, item) => dropped.push({ why, item }));
      await store.putTrace({ id: nanoid(10), projectId: "plan", kind: "plan-look", at: now, ...(model ? { model } : {}), query, pages: [...m.pages.values()].map((p) => ({ ref: p.ref, url: p.url })), answer: data, kept: lines.length, dropped } as { id: string; projectId: string }).catch(() => {});
    }
  }
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  return { at: Date.now(), query, lines, pages: pages.map((p) => ({ title: p.title, url: p.url })), ...(info ? {} : { noWeb: true as const }) };
}

/** What comes next: a round of questions, a look, or ready to propose. A call that fails asks code's own questions, or goes on. */
/** The plan's lookups: their project's own material, and the web (and their tools, where a look in them can be offered). */
const PLAN_KINDS = ["project", "web"] as const;

/**
 * One turn of the interview (src/asking/): what's still open, every question it can ask now, what it
 * waits on, and what to look up rather than ask. No limit on rounds: the window's engine keeps the
 * frontier and the end. A first turn that fails asks code's own questions; a later one fails for Try again.
 */
export async function planNext(store: OrgStore, b: PlanBody, emit: (label: string) => void, signal: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<AskTurn> {
  // Worked out with a consultant: who's asking, its playbook, its pacing (server/org/consult.ts).
  if (b.mode === "consult") return consultNext(store, b, emit, signal, deps);
  emit("Working out what to ask");
  const a: AskingInT = b.asking ?? { rounds: [], lookups: [], held: [], understood: [], proposed: [], said: b.said };
  const base = planAskMaterial({ org: store.info.name, about: await aboutLine(store), said: b.said, outline: b.outline, company: await companyContext(store, { near: b.said }) });
  // What's already known (src/memory/): other conversations' answers, their material, their best-backed pages, decisions.
  const known = await recallFor(store, a, { flow: "plan", words: [b.said, ...b.outline.map((c) => c.title)].join("\n"), broad: true, sent: base });
  const material = [base, known.block, askingBlock(a)].filter(Boolean).join("\n\n");
  const lab = await labOn();
  const decisions = lab === true || lab.includes("decisions");
  const kinds = await lookupKinds(PLAN_KINDS);
  const call = askTurnCall({ flow: "plan", who: "team", material, kinds, terms: true, choices: decisions });
  let answer: { data: unknown; model?: string };
  try {
    answer = await deps.structured<unknown>(call, signal);
  } catch (e) {
    if (signal.aborted || a.rounds.length) throw e;
    // A first turn that can't be taken: code's own questions, so they're still asked.
    return { questions: planRound().map((q) => ({ ...planTweak(q), by: "code" as const })), lookups: [], done: false, understood: [], terms: [], choices: [] };
  }
  const dropped: { why: string; item: unknown }[] = [];
  const turn = sanitizeTurn(answer.data, checkOf(a, { who: "team", hay: material.replace(/(^|\s)[a-z]\d+(?:-\d+)? ·/gm, "$1"), terms: await store.getTerms(), kinds, decisions, tweak: planTweak, memory: known.ids }), (why, item) => dropped.push({ why, item }));
  await store
    .putTrace({ id: nanoid(10), projectId: "plan", kind: "ask-turn", flow: "plan", at: Date.now(), ...(answer.model ? { model: answer.model } : {}), rounds: a.rounds.length, recalled: { items: known.items, chars: known.block.length }, answer: answer.data, kept: { questions: turn.questions.map((q) => ({ id: q.id, title: q.title, after: q.after })), lookups: turn.lookups, done: turn.done, terms: turn.terms.map((t) => t.term), choices: turn.choices.length }, dropped } as { id: string; projectId: string })
    .catch(() => {});
  // Under each question, what was said before to one like it (src/memory/known.ts).
  return { ...turn, questions: await withKnown(store, turn.questions, subjectOf(a, { flow: "plan", words: b.said })) };
}

/** The words behind the problems on the canvas: each problem's page, by the card's words where it has no page of its own; and what a lookup found in their project (`found`), behind no card yet. */
async function piecesFor(store: OrgStore, outline: readonly OutlineCard[], found: readonly string[] = []): Promise<PlanPiece[]> {
  const problems = outline.filter((c) => c.kind === "opportunity");
  if (!problems.length && !found.length) return [];
  const pages = (await store.listTopics()).filter((t) => t.kind === "need");
  const out: PlanPiece[] = [];
  try {
    const ix = indexFor(store);
    await ix.settled();
    for (const [ref, row] of ix.piecesByRef([...found].slice(0, 12))) {
      if (row.type !== "quote" && row.type !== "evidence") continue;
      const s = row.source ? await store.getSource(row.source) : null;
      out.push({ ref, text: row.text, label: s?.title ?? row.title ?? "", source: row.source, evidence: isEvidence(row), basis: pieceBasis(row), ...(isOnline(row) ? { online: true } : {}), card: "" });
    }
    for (const c of problems) {
      const page = c.topic ? await store.getTopic(c.topic) : pages.find((t) => sameTopic(t.title, c.title));
      const full = page && "lines" in page ? page : null;
      const topic = full ?? (page ? await store.getTopic(page.id) : null);
      const refs = [...new Set((topic?.lines ?? []).filter((l) => l.section === "know" || l.section === "believe").flatMap((l) => l.cites))].slice(0, 6);
      for (const [ref, row] of ix.piecesByRef(refs)) {
        if (row.type !== "quote" && row.type !== "evidence") continue;
        const s = row.source ? await store.getSource(row.source) : null;
        out.push({ ref, text: row.text, label: s?.title ?? row.title ?? "", source: row.source, evidence: isEvidence(row), basis: pieceBasis(row), ...(isOnline(row) ? { online: true } : {}), card: c.id });
      }
    }
  } catch {
    // No index here: what's on the canvas and what they said.
  }
  return out;
}

/** One call proposing cards for the canvas; code keeps what it can show honestly. */
export async function proposePlan(store: OrgStore, b: PlanBody, emit: (label: string) => void, signal: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<PlanDraft> {
  emit("Reading what's behind your problems");
  const pieces = await piecesFor(store, b.outline, b.found);
  const m = planMaterial({ org: store.info.name, about: await aboutLine(store), said: b.said, outline: b.outline, answers: answersFor(b), looks: b.looks, pieces, company: await companyContext(store, { near: b.said }), ...(b.kept?.length ? { kept: b.kept } : {}) });
  // Worked out with a consultant: what its playbook proposes (a diagnosis, or goals), and fixes only when they asked.
  const playbook = b.mode === "consult" ? PLAYBOOKS.find((p) => p.id === (b.consult?.playbook ?? b.consult?.situation?.layer)) : undefined;
  const shape = b.mode === "consult" ? (playbook && playbook.propose !== "review" ? playbook.propose : "diagnosis") : "plan";
  const fixes = !!b.consult?.fixes;
  emit(shape === "diagnosis" ? "Qalam AI is working out what's likely behind it" : "Qalam AI is working out what to propose");
  const { data, model } = await deps.structured<unknown>(planCall(m, { shape, fixes }), signal);
  const dropped: { why: string; item: unknown }[] = [];
  const draft = sanitizePlan(data, m, { id: () => nanoid(10), fold: termsFold(await store.getTerms()), shape, fixes }, (why, item) => dropped.push({ why, item }));
  await store.putTrace({ id: nanoid(10), projectId: "plan", kind: "plan-place", at: Date.now(), ...(model ? { model } : {}), sent: { cards: m.cards.size, pieces: [...m.pieces].map(([ref, p]) => ({ ref, piece: p.ref })), answers: m.answers.size, read: m.read.size }, answer: data, kept: draft.cards.length, dropped } as { id: string; projectId: string }).catch(() => {});
  return draft;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A plan's request as it came in, kept to its shape and size: what it says is the window's, and all of it is data to the calls. */
export function planBodyOf(raw: unknown): PlanBody | null {
  const b = rec(raw);
  const said = clip(b.said, 4000).trim();
  if (!said) return null;
  const outline = list(b.outline).slice(0, 200).flatMap((x): OutlineCard[] => {
    const c = rec(x);
    const id = clip(c.id, 200);
    const kind = c.kind === "outcome" || c.kind === "opportunity" || c.kind === "solution" ? c.kind : null;
    if (!id || !kind) return [];
    return [{ id, kind, title: clip(c.title, 400), parent: clip(c.parent, 200) || null, ...(clip(c.topic, 80) ? { topic: clip(c.topic, 80) } : {}), ...(c.faint === true ? { faint: true } : {}), ...(typeof c.type === "string" ? { type: c.type as OutlineCard["type"] } : {}), ...(clip(c.metric, 200) ? { metric: clip(c.metric, 200) } : {}), ...(c.north === true ? { north: true as const } : {}) }];
  });
  // The conversation is the window's own, kept on its chat turn; a look's lines were checked as they were read.
  // However many rounds it has: the one guard is the interview's size (src/asking/wire.ts).
  const rounds = list(b.rounds) as PlanRound[];
  const looks = list(b.looks).slice(-40) as PlanLook[];
  const asking = b.asking === undefined ? undefined : AskingIn.safeParse(b.asking);
  if (asking && !asking.success) return null;
  const found = list(b.found).filter((x): x is string => typeof x === "string" && x.startsWith("hub:")).slice(0, 40);
  const kept = list(b.kept).slice(0, 8).flatMap((x): PlanKept[] => {
    const k = rec(x);
    const line = clip(k.line, 600).trim();
    return line ? [{ line, from: list(k.from).slice(0, 4).map((f) => clip(f, 400)).filter(Boolean) }] : [];
  });
  const consult = b.mode === "consult" ? { mode: "consult" as const, consult: consultInOf(b.consult, said) } : {};
  return { said, outline, rounds, looks, ...(asking?.success ? { asking: asking.data } : {}), ...(found.length ? { found } : {}), ...(kept.length ? { kept } : {}), ...consult };
}
