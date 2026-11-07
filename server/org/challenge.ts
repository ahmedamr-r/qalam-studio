import { nanoid } from "nanoid";
import { z } from "zod";
import { challengeCall } from "@/ai/challenge";
import { challengeMaterial, sanitizeChallenges } from "@/challenge/check";
import { decidedTitles, findChallenges, type CheckFunnel, type DecidedCard, type GoalNumber, type PageBacking } from "@/challenge/find";
import { funnelOfNumbers, funnelsIn } from "@/challenge/funnel";
import type { Challenge, ChallengeRun, CheckRequest, Evidence } from "@/challenge/types";
import { stepRef } from "@/code/map";
import { pieceBasis } from "@/discovery/basis";
import { sharedWords } from "@/discovery/near";
import { foldBearings } from "@/goals/bearings";
import { goalById } from "@/goals/tree";
import type { Notice } from "@/hub/checks";
import { isEvidence, sameTopic } from "@/hub/topics";
import { indexFor } from "../index/registry";
import { packedPieces, packFor } from "../index/search";
import { whoAmI } from "../settings";
import { realDeps, type MarketDeps } from "./market";
import { needsNow } from "./needs";
import type { OrgStore } from "./store";

/**
 * Challenging a round of proposals with the project's own evidence, in the core (src/challenge/ is the
 * pure part). The window sends what they asked, the canvas and the proposals just before a review
 * opens; this gathers, with no tokens, the measured sheets that read as funnels and the goals' own
 * funnels, the problem pages in play ("We know" and "Against"), the code map's steps a proposal names,
 * what was dropped or left out before, and what search finds near each proposal. Code's findings come
 * first; one call words the challenges only when there's evidence to word them from. The run is kept
 * with its review on this computer; what the person drops is the team's.
 */

const cardShape = {
  id: z.string().min(1).max(200),
  kind: z.enum(["outcome", "opportunity", "solution"]),
  title: z.string().max(400),
  parent: z.string().max(200).nullable(),
  topic: z.string().max(80).optional(),
  goal: z.string().max(80).optional(),
  assumed: z.literal(true).optional(),
};
export const CheckBody = z.object({
  origin: z.string().min(1).max(200),
  asked: z.string().max(4000),
  product: z.string().max(120).nullable(),
  outline: z.array(z.object(cardShape)).max(300),
  items: z.array(z.object({ ...cardShape, description: z.string().max(1200).optional(), how: z.string().max(600).optional(), assumptions: z.array(z.string().max(400)).max(6).optional() })).min(1).max(60),
});

export const CHECK_LIMITS = { pages: 6, known: 4, against: 4, decisions: 400, built: 6, builtPer: 2, found: 12, foundPer: 3, searched: 12 } as const;

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (one(s).length > max ? `${one(s).slice(0, max - 1)}…` : one(s));
const WHOSE: Record<string, string> = { said: "people said", measured: "measured", studied: "a study", read: "read elsewhere", own: "the team's" };
const inScope = (product: string | null | undefined, wanted: string | null) => !wanted || !product || product === wanted;

type Gathered = { funnels: CheckFunnel[]; pages: PageBacking[]; goals: Map<string, GoalNumber>; decided: DecidedCard[]; evidence: Evidence[] };

/** The evidence a round of proposals could be broken with, gathered with no tokens; any trouble with one kind leaves the others. */
export async function gatherEvidence(store: OrgStore, req: CheckRequest): Promise<Gathered> {
  const cards = new Map(req.outline.map((c) => [c.id, c]));
  const items = new Map(req.items.map((k) => [k.id, k]));
  const parentOf = (id: string | null | undefined) => (id ? (cards.get(id) ?? items.get(id)) : undefined);
  const evidence: Evidence[] = [];

  // The goals in play: the outcome cards above the proposals, and a goal proposed under.
  const goalIds = new Set<string>();
  for (const k of req.items) {
    if (k.goal) goalIds.add(k.goal);
    for (let x = parentOf(k.parent), i = 0; x && i < 20; x = parentOf(x.parent), i++) if (x.kind === "outcome" && x.goal) goalIds.add(x.goal);
  }
  const tree = await store.getGoals().catch(() => null);
  const goals = new Map<string, GoalNumber>();
  for (const id of goalIds) {
    const g = tree ? goalById(tree, id) : null;
    if (g) goals.set(id, { title: g.title, ...(g.metric?.unit ? { unit: g.metric.unit } : {}), current: g.metric?.current ?? g.metric?.baseline ?? null, target: g.metric?.target ?? null, direction: g.metric?.direction ?? "increase" });
  }

  // Funnels: sheets of figures kept as sources, each step the quote the reading picked out where it did; then the goals' own.
  const funnels: CheckFunnel[] = [];
  const sources = (await store.listSources().catch(() => [])).filter((s) => inScope(s.product, req.product) && s.text.includes(" · "));
  for (const s of sources)
    for (const f of funnelsIn(s.text, s.title, s.id))
      funnels.push({
        ...f,
        steps: f.steps.map((st) => {
          const q = st.span ? s.quotes.find((x) => x.span && x.span[0] <= st.span![0] + 2 && x.span[1] >= st.span![1] - 2) : undefined;
          return q ? { ...st, quote: { sourceId: s.id, quoteId: q.id } } : st;
        }),
      });
  for (const id of goalIds) {
    const w = await store.getGoalWork(id).catch(() => null);
    const f = w?.funnel ? funnelOfNumbers(w.funnel, id) : null;
    if (f) funnels.push(f);
  }

  // The problem pages in play: the pages of the problems proposed or under them, the canvas's under the same goals, and those linked to the goals.
  const topics = (await store.listTopics().catch(() => [])).filter((t) => t.kind === "need" && (!req.product || !t.products?.length || t.products.includes(req.product)));
  /** A problem's pages: its own, one of the same words, else the pages whose titles share two telling words with it (a new problem's words seldom match a page's). */
  const pagesOf = (x: { title: string; topic?: string; description?: string } | undefined): string[] => {
    if (!x) return [];
    if (x.topic) return [x.topic];
    const same = topics.find((t) => sameTopic(t.title, x.title));
    if (same) return [same.id];
    const words = [x.title, x.description ?? ""].join(" ");
    return topics
      .map((t) => ({ id: t.id, n: sharedWords(words, t.title) }))
      .filter((t) => t.n >= 2)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map((t) => t.id);
  };
  const play = new Map<string, Set<string>>();
  const bears = (topic: string | undefined, ids: string[]) => {
    if (!topic) return;
    const had = play.get(topic) ?? new Set<string>();
    for (const id of ids) had.add(id);
    play.set(topic, had);
  };
  for (const k of req.items) {
    const problem = k.kind === "opportunity" ? k : parentOf(k.parent);
    if (problem?.kind === "opportunity") for (const t of pagesOf(problem)) bears(t, [k.id]);
  }
  const underGoals = (id: string) => {
    for (let x = cards.get(id), i = 0; x && i < 20; x = x.parent ? cards.get(x.parent) : undefined, i++) if (x.kind === "outcome" && x.goal && goalIds.has(x.goal)) return true;
    return false;
  };
  for (const c of req.outline) if (c.kind === "opportunity" && (underGoals(c.id) || !goalIds.size)) bears(c.topic ?? topics.find((t) => sameTopic(t.title, c.title))?.id, []);
  const { links } = foldBearings(await store.listBearingLog().catch(() => []));
  for (const l of links) if (goalIds.has(l.goal)) bears(l.need, []);
  // The pages the proposals are about first, then the rest.
  const inPlay = [...play].sort((a, b) => b[1].size - a[1].size).slice(0, CHECK_LIMITS.pages);
  const known = new Map<string, Evidence[]>();
  for (const [topic, ids] of inPlay) {
    const t = await store.getTopic(topic).catch(() => null);
    if (!t) continue;
    const line = (kind: "known" | "against") => (l: (typeof t.lines)[number]): Evidence => ({ kind, whose: kind === "known" ? "known, on their problem page" : "against, on their problem page", from: t.title, text: clip(l.text, 400), for: [...ids], topic, line: l.id, cites: l.cites });
    const know = t.lines.filter((l) => l.section === "know").slice(0, CHECK_LIMITS.known).map(line("known"));
    const against = t.lines.filter((l) => l.section === "against").slice(0, CHECK_LIMITS.against).map(line("against"));
    known.set(topic, know);
    // A page only in play (nothing proposed is about it) sends what it knows when code needs it, not its lines against.
    if (ids.size) evidence.push(...know, ...against);
  }
  const { needs } = await needsNow(store).catch(() => ({ needs: [] as Awaited<ReturnType<typeof needsNow>>["needs"] }));
  const pages: PageBacking[] = needs.filter((n) => play.has(n.topic)).map((n) => ({ topic: n.topic, title: n.title, sources: n.sources, quotes: n.quotes, known: known.get(n.topic) ?? [] }));

  // What was dropped, or left out when it was proposed.
  const decided: DecidedCard[] = [];
  for (const d of store.listDecisions({ limit: CHECK_LIMITS.decisions })) {
    if (d.undone || (d.kind !== "drop" && d.kind !== "discard")) continue;
    for (const title of decidedTitles(d)) decided.push({ id: d.id, at: d.at, kind: d.kind, title, what: d.what, ...(d.why ? { why: d.why } : {}) });
  }

  // What's built: the code map's steps a solution's words name (two telling words in common).
  const maps = (await store.listMaps().catch(() => [])).filter((m) => inScope(m.product, req.product));
  let built = 0;
  for (const k of req.items) {
    if (k.kind !== "solution" || built >= CHECK_LIMITS.built) continue;
    const words = [k.title, k.description, k.how].filter(Boolean).join(" ");
    let mine = 0;
    for (const m of maps)
      for (const f of m.flows)
        for (const s of f.steps) {
          if (mine >= CHECK_LIMITS.builtPer || built >= CHECK_LIMITS.built) continue;
          if (sharedWords(words, `${s.title} ${s.file.split("/").pop()} ${s.events.join(" ")}`) < 2) continue;
          evidence.push({ kind: "built", whose: "in their code", from: s.file, text: clip(`${s.title}${s.snippet ? ` · ${s.snippet}` : ""}`, 300), for: [k.id], step: stepRef(m.key, s.key) });
          mine++;
          built++;
        }
  }

  // Near each proposal, by search: what customers said or what was measured, sharing two telling words with it.
  try {
    const ix = indexFor(store);
    await ix.settled();
    const seen = new Set(evidence.flatMap((e) => (e.piece ? [e.piece] : [])));
    let found = 0;
    for (const k of req.items.slice(0, CHECK_LIMITS.searched)) {
      if (found >= CHECK_LIMITS.found) break;
      const words = [k.title, k.description].filter(Boolean).join(" ");
      const p = await packFor(ix, { query: words.slice(0, 600), product: req.product, budget: 500, wholeTop: 0, types: ["quote"] });
      let mine = 0;
      for (const x of packedPieces(p)) {
        if (mine >= CHECK_LIMITS.foundPer || found >= CHECK_LIMITS.found) break;
        if (!isEvidence(x) || seen.has(x.ref) || sharedWords(words, x.text) < 2) continue;
        seen.add(x.ref);
        const basis = pieceBasis(x);
        evidence.push({ kind: "found", whose: WHOSE[basis] ?? "people said", from: x.title ?? "a source", text: clip(x.text, 400), for: [k.id], piece: x.ref, ...(x.source ? { sourceId: x.source } : {}), ...(x.ref.startsWith("hub:quote:") ? { quoteId: x.ref.slice("hub:quote:".length) } : {}) });
        mine++;
        found++;
      }
    }
  } catch {
    // No index here: the rest of the evidence stands.
  }
  return { funnels, pages, goals, decided, evidence };
}

export interface CheckDeps extends Pick<MarketDeps, "structured"> {
  now?: () => number;
}

/** Check a round of proposals: code's findings, then one call where there's evidence to word them from. The run is kept with its review. */
export async function challengeProposals(store: OrgStore, req: CheckRequest, emit: (label: string) => void, signal: AbortSignal, deps: CheckDeps = realDeps): Promise<ChallengeRun> {
  emit("Checking them against your evidence");
  const now = deps.now ?? Date.now;
  const g = await gatherEvidence(store, req);
  const { findings, evidence } = findChallenges({ req, ...g });
  const dropped = await store.droppedChallenges().catch(() => new Set<string>());
  const id = () => nanoid(8);
  let challenges: Challenge[] = [];
  let note: string | undefined;
  let model: string | undefined;
  if (!evidence.length) note = "Nothing in your project bears on these yet, so there was nothing to check them against.";
  else {
    const m = challengeMaterial({ req, evidence, findings });
    const left: { why: string; item: unknown }[] = [];
    let answer: unknown = null;
    try {
      const r = await deps.structured<unknown>(challengeCall(m), signal);
      answer = r.data;
      model = r.model;
      challenges = sanitizeChallenges(r.data, m, { id, dropped }, (why, item) => left.push({ why, item }));
    } catch (e) {
      if (signal.aborted) throw e;
      // The call couldn't be made: what code found stands in its own words.
      note = `Qalam AI couldn't check them (${e instanceof Error ? e.message : String(e)}), so only what code found in your numbers shows.`;
      challenges = sanitizeChallenges({ challenges: [] }, m, { id, dropped });
    }
    await store
      .putTrace({ id: nanoid(10), projectId: "challenge", kind: "challenge", at: now(), ...(model ? { model } : {}), origin: req.origin, sent: { items: m.items.size, evidence: [...m.evidence].map(([ref, e]) => ({ ref, kind: e.kind, from: e.from, ...(e.piece ? { piece: e.piece } : {}) })), findings: [...m.findings].map(([ref, f]) => ({ ref, kind: f.kind, on: f.on })) }, answer, kept: challenges.map((c) => ({ kind: c.kind, by: c.by, on: c.on, line: c.line })), dropped: left } as { id: string; projectId: string })
      .catch(() => {});
  }
  const run: ChallengeRun = { id: nanoid(10), origin: req.origin, at: now(), items: req.items.map((k) => k.id), challenges, ...(note ? { note } : {}), ...(model ? { model } : {}) };
  await store.putChallengeRun(run).catch(() => {});
  return run;
}

export const DecideBody = z.object({ origin: z.string().min(1).max(200), id: z.string().min(1).max(40), state: z.enum(["kept", "changed", "dropped"]).nullable(), words: z.string().max(600).optional() });

/** The person's say on a challenge: kept, changed into their words, dropped (for the team: it isn't raised again from the same evidence), or none again. */
export async function decideChallenge(store: OrgStore, b: z.infer<typeof DecideBody>): Promise<ChallengeRun | null> {
  let was: Challenge | undefined;
  const next = await store.changeChallengeRun(b.origin, (r) => ({
    ...r,
    challenges: r.challenges.map((c) => {
      if (c.id !== b.id) return c;
      was = c;
      const { state: _s, words: _w, ...rest } = c;
      if (!b.state) return rest;
      const words = b.state === "changed" ? one(b.words ?? "") : "";
      return { ...rest, state: b.state === "changed" && !words ? "kept" : b.state, ...(words ? { words } : {}) };
    }),
  }));
  if (!next || !was) return next;
  const me = await whoAmI().catch(() => null);
  const by = me?.name ?? me?.id;
  if (b.state === "dropped" && was.state !== "dropped") await store.logChallenge({ v: 1, drop: was.key, on: was.on.join(", "), line: was.line, at: Date.now(), ...(by ? { by } : {}) });
  else if (was.state === "dropped" && b.state !== "dropped") await store.logChallenge({ v: 1, restore: was.key, at: Date.now(), ...(by ? { by } : {}) });
  return next;
}

export const CarryBody = z.object({ origin: z.string().min(1).max(200), product: z.string().max(120).nullable(), cards: z.array(z.object({ item: z.string().min(1).max(200), card: z.string().min(1).max(200) })).max(60) });

/**
 * The proposals accepted, each now a card: the challenges the person kept on them stay on those cards
 * as notices (Needs a look, the card's mark and panel) until dismissed. Its board is filled in once the
 * canvas saves the card on one.
 */
export async function carryChallenges(store: OrgStore, b: z.infer<typeof CarryBody>, opts: { tab?: string } = {}): Promise<number> {
  const run = await store.getChallengeRun(b.origin);
  if (!run) return 0;
  const at = Date.now();
  const list: Notice[] = [];
  for (const { item, card } of b.cards)
    for (const c of run.challenges) {
      if ((c.state !== "kept" && c.state !== "changed") || !c.on.includes(item)) continue;
      const from = [...new Set(c.cites.map((x) => x.from))].slice(0, 3);
      list.push({ key: `challenge:${c.key}:${card}`, kind: "challenge", title: c.words ?? c.line, why: from.length ? `From ${from.map((f) => `“${f}”`).join(", ")}` : "From your evidence", at, card, refs: c.cites.flatMap((x) => (x.piece ? [x.piece] : [])), products: b.product ? [b.product] : [] });
    }
  if (list.length) await store.addChallenged(list, opts);
  return list.length;
}
