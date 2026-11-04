import { briefCall } from "@/ai/scan";
import { structured } from "@/ai/server";
import { basisOf } from "@/discovery/basis";
import { briefMarkdown, briefMaterial, sanitizeBrief, type BriefAsked, type BriefData, type BriefKind, type BriefMeta, type BriefQuote } from "@/discovery/brief";
import { quotePiece, type SourceRecord } from "@/discovery/sources";
import type { ScanKnown } from "@/scan/session";
import { nanoid } from "nanoid";
import type { OrgStore } from "./store";

/**
 * A brief for a card on the canvas (src/discovery/brief.ts), in the core. The window sends the card and
 * what's around it, as Draft its tests does; the words go in from what's kept here, a quote only as
 * its source has it. One call for the features, skipped with no words to rest them on, and a call
 * that fails leaves a brief without them: what's known and decided still stands.
 */

export interface BriefCardWords {
  title: string;
  description: string;
  /** Most depended on first. */
  assumptions: string[];
  tests: { what: string; how: string; suggested: string | null }[];
  /** Its own evidence, as the card has it. */
  evidence: { text: string; kind: string; sourceId?: string; sourceTitle?: string }[];
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
      else if (!e.sourceId && !seen.has(e.text)) {
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

  const m = briefMaterial({ about: `What this is a brief for: ${req.card.title}`, ...(goal ? { goal: goal.title } : {}), asked: req.asked, problems, words, ...(chosen ? { build: { title: chosen.title, description: chosen.description, assumptions: chosen.assumptions, test: chosen.tests[0] ?? null } } : {}), options, published: published.map((p) => p.text) });
  let features: BriefData["features"] = [];
  if (words.length) {
    try {
      const dropped: { why: string; item: unknown }[] = [];
      const { data, model } = await deps.structured<unknown>(briefCall(m.text), signal);
      features = sanitizeBrief(data, m, (why, item) => dropped.push({ why, item }));
      await store.putTrace({ id: nanoid(10), projectId: "scan", kind: "scan-brief", at: Date.now(), ...(model ? { model } : {}), answer: data, kept: features.length, dropped } as { id: string; projectId: string }).catch(() => {});
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  const at = Date.now();
  const body = briefMarkdown({ at, title: req.card.title, ...(goal ? { goal } : {}), problems, quotes: words, ...(build ? { build } : {}), options, later: kind === "solution" ? req.others.map((title) => ({ title, why: "" })) : [], features, asked: req.asked, known: [...(await knownOthers(store)), ...published] });
  return store.putBrief({ card: req.card.id, kind, title: req.card.title, at, features: features.length }, body, opts);
}

const clipped = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const cardWords = (raw: unknown): BriefCardWords => {
  const c = rec(raw);
  return {
    title: clipped(c.title, 300),
    description: clipped(c.description, 2000),
    assumptions: list(c.assumptions).map((a) => clipped(a, 400)).filter(Boolean).slice(0, 8),
    tests: list(c.tests).map((t) => ({ what: clipped(rec(t).what, 300), how: clipped(rec(t).how, 800), suggested: clipped(rec(t).suggested, 300) || null })).filter((t) => t.what).slice(0, 4),
    evidence: list(c.evidence).map((e) => ({ text: clipped(rec(e).text, 2000), kind: clipped(rec(e).kind, 20), ...(clipped(rec(e).sourceId, 60) ? { sourceId: clipped(rec(e).sourceId, 60) } : {}), ...(clipped(rec(e).sourceTitle, 200) ? { sourceTitle: clipped(rec(e).sourceTitle, 200) } : {}) })).filter((e) => e.text).slice(0, 40),
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
  const a = rec(r.asked);
  return {
    card: { ...cardWords(c), id, kind },
    goal: clipped(g.title, 300) ? { title: clipped(g.title, 300), metric: clipped(g.metric, 300) || null } : null,
    problem: rec(r.problem).title ? cardWords(r.problem) : null,
    under: list(r.under).map(cardWords).filter((u) => u.title).slice(0, 12),
    others: list(r.others).map((x) => clipped(x, 300)).filter(Boolean).slice(0, 6),
    asked: { ...(clipped(a.platform, 200) ? { platform: clipped(a.platform, 200) } : {}), ...(clipped(a.exists, 400) ? { exists: clipped(a.exists, 400) } : {}), ...(clipped(a.needs, 60) ? { needs: clipped(a.needs, 60) } : {}) },
  };
}
