import { nanoid } from "nanoid";
import { planCall, planLookCall, planNextCall, routeCall } from "@/ai/canvas-plan";
import { pieceBasis } from "@/discovery/basis";
import { sanitizeLook, type FocusLook } from "@/goals/focus";
import type { OutsidePage } from "@/goals/outside";
import { isEvidence, isOnline, sameTopic } from "@/hub/topics";
import { pageLines, pagesBlock, type PagesSent } from "@/market/rivals";
import type { MarketLine } from "@/market/types";
import { answersOf, planMaterial, planNextMaterial, planTask, sanitizeNext, sanitizePlan, sanitizeRoute, type OutlineCard, type PlanDraft, type PlanLook, type PlanNext, type PlanPiece, type PlanRound } from "@/space/plan";
import { termsFold } from "@/terms/fold";
import { indexFor } from "../index/registry";
import { companyContext } from "./company";
import { readLinks, realDeps, type MarketDeps } from "./market";
import type { OrgStore } from "./store";

/**
 * Working something out as a plan, in the core (src/space/plan.ts). The window keeps the conversation
 * on its chat turn and sends it with each call, so nothing here is kept but the calls' traces: a look on
 * the web, what comes next, and what to propose, the words behind the problems found here.
 */

export interface PlanBody {
  said: string;
  outline: OutlineCard[];
  rounds: PlanRound[];
  looks: PlanLook[];
}

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
  const task = planTask({ org: store.info.name, about: await aboutLine(store), said: b.said, query, answers: answersOf(b.rounds), outline: b.outline });
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
export async function planNext(store: OrgStore, b: PlanBody, emit: (label: string) => void, signal: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<PlanNext> {
  emit("Working out what to ask");
  const text = planNextMaterial({ org: store.info.name, about: await aboutLine(store), said: b.said, outline: b.outline, rounds: b.rounds, looks: b.looks, company: await companyContext(store) });
  const { data, model } = await deps.structured<unknown>(planNextCall(text), signal).then(
    (r) => r,
    (e: unknown) => {
      if (signal.aborted) throw e;
      return { data: { action: "ask" }, model: undefined, failed: true };
    },
  );
  const next = sanitizeNext(data, b);
  await store.putTrace({ id: nanoid(10), projectId: "plan", kind: "plan-next", at: Date.now(), ...(model ? { model } : {}), rounds: b.rounds.length, looks: b.looks.length, answer: data, kept: next.action === "ask" ? { ask: next.questions.map((q) => q.title) } : next } as { id: string; projectId: string }).catch(() => {});
  return next;
}

/** The words behind the problems on the canvas: each problem's page, by the card's words where it has no page of its own. */
async function piecesFor(store: OrgStore, outline: readonly OutlineCard[]): Promise<PlanPiece[]> {
  const problems = outline.filter((c) => c.kind === "opportunity");
  if (!problems.length) return [];
  const pages = (await store.listTopics()).filter((t) => t.kind === "need");
  const out: PlanPiece[] = [];
  try {
    const ix = indexFor(store);
    await ix.settled();
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
  const pieces = await piecesFor(store, b.outline);
  const m = planMaterial({ org: store.info.name, about: await aboutLine(store), said: b.said, outline: b.outline, rounds: b.rounds, looks: b.looks, pieces, company: await companyContext(store) });
  emit("Qalam AI is working out what to propose");
  const { data, model } = await deps.structured<unknown>(planCall(m), signal);
  const dropped: { why: string; item: unknown }[] = [];
  const draft = sanitizePlan(data, m, { id: () => nanoid(10), fold: termsFold(await store.getTerms()) }, (why, item) => dropped.push({ why, item }));
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
    return [{ id, kind, title: clip(c.title, 400), parent: clip(c.parent, 200) || null, ...(clip(c.topic, 80) ? { topic: clip(c.topic, 80) } : {}), ...(c.faint === true ? { faint: true } : {}), ...(typeof c.type === "string" ? { type: c.type as OutlineCard["type"] } : {}), ...(clip(c.metric, 200) ? { metric: clip(c.metric, 200) } : {}) }];
  });
  // The conversation is the window's own, kept on its chat turn; a look's lines were checked as they were read.
  const rounds = list(b.rounds).slice(0, 8) as PlanRound[];
  const looks = list(b.looks).slice(0, 8) as PlanLook[];
  return { said, outline, rounds, looks };
}
