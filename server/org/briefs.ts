import { briefCall } from "@/ai/scan";
import { structured } from "@/ai/server";
import { basisOf } from "@/discovery/basis";
import { askedOf, briefMarkdown, briefMaterial, sanitizeBrief, type BriefAsked, type BriefData, type BriefKind, type BriefMeta, type BriefQuote, type BriefShape } from "@/discovery/brief";
import { askTurnCall } from "@/ai/asking";
import { sanitizeTurn } from "@/asking/sanitize";
import type { AskTurn } from "@/asking/types";
import { askingBlock, checkOf, type AskingInT } from "@/asking/wire";
import { labOn } from "../lab";
import { lookupKinds } from "../connectors/everywhere";
import { quotePiece, type SourceRecord } from "@/discovery/sources";
import type { ScanKnown } from "@/scan/session";
import { nanoid } from "nanoid";
import type { OrgStore } from "./store";
import { recallFor, subjectOf, withKnown } from "./memory";

/**
 * A brief for a card on the canvas (src/discovery/brief.ts), in the core. The window sends the card and
 * what's around it, as Draft its tests does; the words go in from what's kept here, a quote only as
 * its source has it. One call for the features, each saying when nothing backs it, and a call that
 * fails leaves a brief without them: what's known and decided still stands.
 */

export interface BriefCardWords {
  title: string;
  description: string;
  /** Most depended on first. */
  assumptions: string[];
  tests: { what: string; how: string; suggested: string | null }[];
  /** Its own evidence, as the card has it. */
  evidence: { text: string; kind: string; sourceId?: string; sourceTitle?: string; url?: string }[];
  /** Its problem page, where it has one. */
  topic: string | null;
}

export interface BriefRequest {
  card: BriefCardWords & { id: string; kind: BriefKind };
  goal: { title: string; metric: string | null } | null;
  problem: BriefCardWords | null;
  /** The cards under it: a goal's problems, a problem's solutions. */
  under: BriefCardWords[];
  /** Solutions beside it, to say what waits. */
  others: string[];
  asked: BriefAsked;
  /** What's written: a brief to build (none), a plan for a message, or steps to run. */
  shape?: BriefShape;
  /** A New product's modules. */
  modules?: { title: string; how?: string; needed?: boolean }[];
}

export interface BriefDeps {
  structured: <T>(call: Parameters<typeof structured>[0], signal?: AbortSignal) => Promise<{ data: T; model?: string }>;
}

const liveDeps: BriefDeps = { structured };

const MAX_PUBLISHED = 6;
const RIVALS_LINES = 6;

/** What the market file says others offer and charge: read elsewhere, each with its page. */
export async function knownOthers(store: OrgStore): Promise<ScanKnown[]> {
  const market = await store.getMarket();
  return market.competitors.flatMap((c) => c.lines.filter((l) => l.url).slice(0, 2).map((l): ScanKnown => ({ kind: "product", name: c.name, text: l.text, title: l.title ?? c.name, url: l.url! }))).slice(0, RIVALS_LINES);
}

export async function writeCardBrief(store: OrgStore, req: BriefRequest, signal?: AbortSignal, deps: BriefDeps = liveDeps, opts: { tab?: string } = {}): Promise<BriefMeta> {
  const { m, kind, problems, words, published, build, goal, options } = await briefParts(store, req);
  let features: BriefData["features"] = [];
  try {
    const dropped: { why: string; item: unknown }[] = [];
    const { data, model } = await deps.structured<unknown>(briefCall(m.text, req.shape ?? "build"), signal);
    features = sanitizeBrief(data, m, (why, item) => dropped.push({ why, item }));
    await store.putTrace({ id: nanoid(10), projectId: "scan", kind: "scan-brief", at: Date.now(), ...(model ? { model } : {}), answer: data, kept: features.length, dropped } as { id: string; projectId: string }).catch(() => {});
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  const at = Date.now();
  const body = briefMarkdown({ ...(req.shape ? { shape: req.shape } : {}), ...(req.modules?.length ? { modules: req.modules } : {}), at, title: req.card.title, ...(goal ? { goal } : {}), problems, quotes: words, ...(build ? { build } : {}), options, later: kind === "solution" ? req.others.map((title) => ({ title, why: "" })) : [], features, asked: req.asked, known: [...(await knownOthers(store)), ...published] });
  return store.putBrief({ card: req.card.id, kind, title: req.card.title, at, features: features.length, ...(req.shape && req.shape !== "build" ? { shape: req.shape } : {}) }, body, opts);
}

const SHAPE_WORDS: Record<BriefShape, string> = { build: "a brief (a PRD) for whoever builds it, their coding agent", message: "a plan for a message: what to send, its wording, the tool it goes through", steps: "the steps to run it this week, by hand" };

/**
 * A turn of the interview before a brief is written (src/asking/): it reads what the brief would be
 * written from, and asks only what that leaves open and the brief needs. Never a stack: the coding
 * agent chooses that.
 */
export async function askBrief(store: OrgStore, req: BriefRequest, asking: AskingInT, emit: (label: string) => void, signal?: AbortSignal, deps: BriefDeps = liveDeps): Promise<AskTurn> {
  emit("Working out what to ask");
  const { m } = await briefParts(store, req);
  // What's already known (src/memory/): the plan's or the scan's answers and any other conversation's, their material, decisions on the card.
  const known = await recallFor(store, asking, { flow: "brief", words: [req.card.title, req.card.description, req.problem?.title ?? "", req.goal?.title ?? ""].join("\n"), sent: m.text });
  const material = [`What's to be written: ${SHAPE_WORDS[req.shape ?? "build"]}.`, "", m.text, ...(known.block ? ["", known.block] : []), "", askingBlock(asking)].join("\n");
  const lab = await labOn();
  const decisions = lab === true || lab.includes("decisions");
  const kinds = await lookupKinds(KINDS);
  const { data, model } = await deps.structured<unknown>(askTurnCall({ flow: "brief", who: "builder", material, kinds, terms: true, choices: decisions }), signal);
  const dropped: { why: string; item: unknown }[] = [];
  const turn = sanitizeTurn(data, checkOf(asking, { who: "builder", hay: `${m.hay}\n${material.replace(/^(\s*- )[\w-]+ ·/gm, "$1")}`, terms: await store.getTerms(), kinds, decisions, memory: known.ids }), (why, item) => dropped.push({ why, item }));
  await store.putTrace({ id: nanoid(10), projectId: "asking", kind: "ask-turn", flow: "brief", at: Date.now(), ...(model ? { model } : {}), rounds: asking.rounds.length, recalled: { items: known.items, chars: known.block.length }, answer: data, kept: { questions: turn.questions.map((q) => ({ id: q.id, title: q.title, after: q.after })), lookups: turn.lookups, done: turn.done }, dropped } as { id: string; projectId: string }).catch(() => {});
  return { ...turn, questions: await withKnown(store, turn.questions, subjectOf(asking, { flow: "brief", words: req.card.title })) };
}

const KINDS = ["project", "web"] as const;

/** What a brief is written from: the words kept for the card and what's around it (people's first, what's published apart), its problems, what's decided, and the material the call reads. */
async function briefParts(store: OrgStore, req: BriefRequest) {
  const sources = await store.listSources();
  const byId = new Map(sources.map((s) => [s.id, s]));
  const byQuote = new Map(sources.flatMap((s) => s.quotes.map((q) => [quotePiece(q.id), { q, s }] as const)));
  const cards = [req.card, ...(req.problem ? [req.problem] : []), ...req.under];
  const topics = (await Promise.all([...new Set(cards.flatMap((c) => c.topic ?? []))].map((id) => store.getTopic(id)))).filter((t): t is NonNullable<typeof t> => !!t);

  // Who said it first: people's words, then what's measured or studied; what's published sits apart, and never carries a feature.
  const seen = new Set<string>();
  const words: BriefQuote[] = [];
  const published: ScanKnown[] = [];
  const keep = (s: SourceRecord, text: string, basis: ReturnType<typeof basisOf>) => {
    if (seen.has(text)) return;
    seen.add(text);
    if (basis === "read" && s.kind === "url") {
      if (published.length < MAX_PUBLISHED && s.origin) published.push({ kind: "published", text, title: s.title, url: s.origin });
      return;
    }
    words.push({ text, source: s.title, ...(s.origin ? { url: s.origin } : {}) });
  };
  for (const c of cards) {
    for (const e of c.evidence) {
      const s = e.sourceId ? byId.get(e.sourceId) : undefined;
      const q = s?.quotes.find((x) => x.text === e.text);
      if (s && q) keep(s, q.text, basisOf(s, q));
      else if (e.kind === "read") {
        // A line read on the web: someone else's words, shown apart, and a feature can't rest on it.
        if (!seen.has(e.text) && e.url && published.length < MAX_PUBLISHED) published.push({ kind: "published", text: e.text, title: e.sourceTitle ?? "", url: e.url });
        seen.add(e.text);
      } else if (!e.sourceId && !seen.has(e.text)) {
        // Their own words on the card, a note or an answer: nothing to look up.
        seen.add(e.text);
        words.push({ text: e.text, source: "Your words" });
      }
    }
  }
  for (const t of topics) {
    for (const ref of t.lines.flatMap((l) => (l.section === "against" ? [] : l.cites))) {
      const at = byQuote.get(ref);
      if (at) keep(at.s, at.q.text, basisOf(at.s, at.q));
    }
  }

  const pageOf = (c: BriefCardWords) => topics.find((t) => t.id === c.topic);
  const problemOf = (c: BriefCardWords) => {
    const page = pageOf(c);
    return { title: c.title, lines: (page?.lines ?? []).filter((l) => l.section === "know" || l.section === "believe").map((l) => l.text).slice(0, 8), open: (page?.lines ?? []).filter((l) => l.section === "open").map((l) => l.text).slice(0, 6) };
  };
  const kind = req.card.kind;
  const problems = kind === "outcome" ? req.under.map(problemOf) : kind === "opportunity" ? [problemOf(req.card)] : req.problem ? [problemOf(req.problem)] : [];
  // What to build first is decided when it's a solution's brief, or a problem with one solution under it.
  const chosen = kind === "solution" ? req.card : kind === "opportunity" && req.under.length === 1 ? req.under[0] : null;
  const options = kind === "opportunity" && req.under.length > 1 ? req.under.map((u) => u.title) : [];
  const build: BriefData["build"] = chosen ? { title: chosen.title, description: chosen.description, ...(chosen.assumptions[0] ? { wrong: chosen.assumptions[0] } : {}), test: chosen.tests[0] ?? null } : undefined;
  const goal = kind === "outcome" ? { title: req.card.title, ...(req.goal?.metric ? { metric: req.goal.metric } : {}) } : req.goal ? { title: req.goal.title, ...(req.goal.metric ? { metric: req.goal.metric } : {}) } : undefined;

  const moduleLines = (req.modules ?? []).map((x) => `${x.title}${x.how ? `: ${x.how}` : ""}${x.needed ? " (needed to run it)" : ""}`);
  const m = briefMaterial({ ...(moduleLines.length ? { modules: moduleLines } : {}), about: `What this is a brief for: ${req.card.title}`, ...(goal ? { goal: goal.title } : {}), asked: req.asked, problems, words, ...(chosen ? { build: { title: chosen.title, description: chosen.description, assumptions: chosen.assumptions, test: chosen.tests[0] ?? null } } : {}), options, published: published.map((p) => p.text) });
  return { m, kind, problems, words, published, build, goal, options };
}

const clipped =(v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const cardWords = (raw: unknown): BriefCardWords => {
  const c = rec(raw);
  return {
    title: clipped(c.title, 300),
    description: clipped(c.description, 2000),
    assumptions: list(c.assumptions).map((a) => clipped(a, 400)).filter(Boolean).slice(0, 8),
    tests: list(c.tests).map((t) => ({ what: clipped(rec(t).what, 300), how: clipped(rec(t).how, 800), suggested: clipped(rec(t).suggested, 300) || null })).filter((t) => t.what).slice(0, 4),
    evidence: list(c.evidence).map((e) => ({ text: clipped(rec(e).text, 2000), kind: clipped(rec(e).kind, 20), ...(clipped(rec(e).sourceId, 60) ? { sourceId: clipped(rec(e).sourceId, 60) } : {}), ...(clipped(rec(e).sourceTitle, 200) ? { sourceTitle: clipped(rec(e).sourceTitle, 200) } : {}), ...(/^https?:\/\//i.test(clipped(rec(e).url, 500)) ? { url: clipped(rec(e).url, 500) } : {}) })).filter((e) => e.text).slice(0, 40),
    topic: clipped(c.topic, 60) || null,
  };
};

/** A request as it came in, kept to what it should be; null when it names no card. */
export function briefRequestOf(raw: unknown): BriefRequest | null {
  const r = rec(raw);
  const c = rec(r.card);
  const id = clipped(c.id, 200);
  const kind = c.kind;
  if (!id || !clipped(c.title, 300) || (kind !== "outcome" && kind !== "opportunity" && kind !== "solution")) return null;
  const g = rec(r.goal);
  return {
    card: { ...cardWords(c), id, kind },
    goal: clipped(g.title, 300) ? { title: clipped(g.title, 300), metric: clipped(g.metric, 300) || null } : null,
    problem: rec(r.problem).title ? cardWords(r.problem) : null,
    under: list(r.under).map(cardWords).filter((u) => u.title).slice(0, 12),
    others: list(r.others).map((x) => clipped(x, 300)).filter(Boolean).slice(0, 6),
    asked: askedOf(r.asked),
    ...(r.shape === "message" || r.shape === "steps" ? { shape: r.shape } : {}),
    ...(Array.isArray(r.modules) ? { modules: list(r.modules).slice(0, 12).flatMap((x) => (clipped(rec(x).title, 300) ? [{ title: clipped(rec(x).title, 300), ...(clipped(rec(x).how, 300) ? { how: clipped(rec(x).how, 300) } : {}), ...(rec(x).needed === true ? { needed: true } : {}) }] : [])) } : {}),
  };
}
