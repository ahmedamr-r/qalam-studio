import { sameTopic } from "@/hub/topics";
import { biggestDrop, lossBy, stepWords, stepsNamed, type Funnel, type FunnelStep } from "./funnel";
import type { CheckCard, CheckItem, CheckRequest, Evidence, Finding } from "./types";

/*
 * What code finds on its own in their numbers and records (pure, no tokens): firm, so each is shown
 * whatever the call says. A proposal works on a funnel step that loses far fewer people than the
 * funnel's biggest drop; nothing proposed works on that drop; fixing a step whole couldn't make the
 * goal's number; the proposals go to a problem nothing measured or said backs while a better backed
 * one gets none; a card with the same words was dropped or left out before. Every number in a line
 * is the evidence's own or code's arithmetic.
 */

/** A problem page in play, as rankNeeds counts what reaches "We know" behind it, with its top known lines. */
export interface PageBacking {
  topic: string;
  title: string;
  sources: number;
  quotes: number;
  known: Evidence[];
}

/** A goal's number (goals.md). */
export interface GoalNumber {
  title: string;
  unit?: string;
  current: number | null;
  target: number | null;
  direction: "increase" | "decrease";
}

/** A card dropped, or a proposal left out, with the words it had. */
export interface DecidedCard {
  id: string;
  at: number;
  kind: "drop" | "discard";
  title: string;
  what: string;
  why?: string;
}

/** A funnel step's row, and the quote it is when the source's reading picked it out. */
export type CheckFunnel = Funnel & { steps: (FunnelStep & { quote?: { sourceId: string; quoteId: string } })[] };

export interface FindInput {
  req: CheckRequest;
  funnels: readonly CheckFunnel[];
  pages: readonly PageBacking[];
  goals: ReadonlyMap<string, GoalNumber>;
  decided: readonly DecidedCard[];
  /** What was gathered so far: the findings add the lines they rest on. */
  evidence: readonly Evidence[];
}

export const FIND_LIMITS = { twice: 2, ofAll: 0.1, share: 0.2, tolerance: 0.05 } as const;

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (share: number) => `${Math.round(share * 100)}%`;
const points = (x: number) => (Math.abs(x) >= 10 || Number.isInteger(x) ? `${Math.round(x)}` : x.toFixed(1));
const dateOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const one = (s: string) => s.replace(/\s+/g, " ").trim();

type Node = (CheckCard & { item?: false }) | (CheckItem & { item: true });

export function findChallenges(input: FindInput): { findings: Finding[]; evidence: Evidence[] } {
  const { req } = input;
  const evidence = [...input.evidence];
  const add = (e: Evidence): number => {
    const at = evidence.findIndex((x) => x.from === e.from && one(x.text) === one(e.text));
    if (at >= 0) {
      evidence[at] = { ...evidence[at], for: [...new Set([...evidence[at].for, ...e.for])] };
      return at;
    }
    evidence.push(e);
    return evidence.length - 1;
  };
  const nodes = new Map<string, Node>([...req.outline.map((c) => [c.id, { ...c, item: false as const }] as const), ...req.items.map((k) => [k.id, { ...k, item: true as const }] as const)]);
  const parentOf = (id: string) => {
    const p = nodes.get(id)?.parent;
    return p ? nodes.get(p) : undefined;
  };
  /** A proposal's words, and for a solution the problem it's under: it works on what that problem is about. */
  const wordsOf = (k: CheckItem) => {
    const p = parentOf(k.id);
    return [k.title, k.description, k.how, ...(k.assumptions ?? []), k.kind === "solution" && p?.kind === "opportunity" ? p.title : ""].filter(Boolean).join(" \n ");
  };
  /** The goal above a card: the nearest outcome that is one. */
  const goalOf = (id: string): string | undefined => {
    for (let x = nodes.get(id), i = 0; x && i < 20; x = x.parent ? nodes.get(x.parent) : undefined, i++) if (x.kind === "outcome" && x.goal && !x.item) return x.goal;
    return undefined;
  };
  const findings: Finding[] = [];
  const items = req.items;
  const deepest = items.some((k) => k.kind === "solution") ? "solution" : items.some((k) => k.kind === "opportunity") ? "opportunity" : null;

  // ---- Funnels: the step a proposal works on, against the biggest drop.
  for (const f of input.funnels) {
    const worst = biggestDrop(f);
    const by = lossBy(f);
    if (worst < 0 || !by) continue;
    const B = f.steps[worst];
    const loss = (s: FunnelStep) => s[by] ?? 0;
    const own = stepWords(f);
    const named = new Map(items.filter((k) => k.kind !== "outcome").map((k) => [k.id, stepsNamed(f, wordsOf(k), own)]));
    if (![...named.values()].some((s) => s.length)) continue;
    const big = by === "lost" ? (f.first ? (B.lost ?? 0) / f.first >= FIND_LIMITS.ofAll : true) : (B.share ?? 0) >= FIND_LIMITS.share;
    const row = (s: FunnelStep & { quote?: { sourceId: string; quoteId: string } }, on: string[]) =>
      add({ kind: "measured", whose: "measured", from: f.from, text: s.text, for: on, ...(f.sourceId ? { sourceId: f.sourceId } : {}), ...(s.span ? { span: s.span } : {}), ...(s.quote ? { quoteId: s.quote.quoteId, piece: `hub:quote:${s.quote.quoteId}` } : {}) });
    const where = f.goal ? `In the goal's funnel “${f.from}”` : `In “${f.from}”`;
    const lostAt = (s: FunnelStep) => (by === "lost" ? `${n(s.lost!)}${f.first && s === B ? ` of ${n(f.first)}` : ""}` : pct(s.share!));
    const factsOf = (...ss: FunnelStep[]) => [...new Set(ss.flatMap((s) => (by === "lost" ? [n(s.lost ?? 0)] : [pct(s.share ?? 0)])).concat(by === "lost" && f.first ? [n(f.first)] : []))];

    // Each step the proposals work on, with the proposals that work on it and not on the biggest drop.
    const groups = new Map<number, string[]>();
    for (const k of items) {
      const s = named.get(k.id) ?? [];
      if (!s.length || s.includes(worst)) continue;
      const top = s.reduce((a, b) => (loss(f.steps[b]) > loss(f.steps[a]) ? b : a), s[0]);
      groups.set(top, [...(groups.get(top) ?? []), k.id]);
    }
    for (const [at, on] of groups) {
      const S = f.steps[at];
      if (!big || loss(B) < FIND_LIMITS.twice * loss(S)) continue;
      const these = on.length > 1;
      findings.push({
        kind: "funnel-step",
        on,
        rests: [row(B, on), row(S, on)],
        line: `${where}, ${lostAt(B)} leave at ${B.label}, against ${lostAt(S)} at ${S.label}, the step ${these ? "these work" : "this works"} on.`,
        facts: factsOf(B, S),
        weight: 100 + loss(B) / Math.max(1, loss(S)),
      });
      // Fixing the step whole, when the funnel is the goal's own number: how far it could move it.
      const goal = on.map(goalOf).find(Boolean);
      const g = goal ? input.goals.get(goal) : undefined;
      const cap = g && f.first && g.unit === "%" && g.direction === "increase" && g.current !== null && g.target !== null && by === "lost" ? capOf(f, at, g) : null;
      if (cap) findings.push({ kind: "funnel-cap", on, rests: [row(S, on)], line: `Even if all ${n(S.lost!)} who leave at ${S.label} went on, completion would rise by about ${points(cap.gain)} points; the goal needs ${points(cap.gap)} (from ${points(g!.current!)}% to ${points(g!.target!)}%).`, facts: [n(S.lost!), points(cap.gain), points(cap.gap), points(g!.current!), points(g!.target!)], weight: 90 });
    }

    // Nothing proposed (nor on the canvas already) works on the biggest drop.
    if (big && deepest) {
      const works = (words: string) => stepsNamed(f, words, own).includes(worst);
      const proposed = items.some((k) => k.kind === deepest && works(wordsOf(k)));
      const there = req.outline.some((c) => c.kind === deepest && works([c.title, c.kind === "solution" ? (parentOf(c.id)?.title ?? "") : ""].join(" ")));
      if (!proposed && !there)
        findings.push({ kind: "funnel-gap", on: [], rests: [row(B, [])], line: `Nothing proposed works on ${B.label}, where ${lostAt(B)} leave ${where.replace(/^In/, "in")}.`, facts: factsOf(B), weight: 120 + loss(B) / Math.max(1, f.first ?? loss(B)) });
    }
  }

  // ---- Backing: proposals going to a problem nothing measured or said backs, while a better backed one gets none.
  const problems = new Map<string, Node>();
  for (const k of items) {
    if (k.kind === "opportunity" && k.assumed) problems.set(k.id, nodes.get(k.id)!);
    const p = parentOf(k.id);
    if (k.kind === "solution" && p?.kind === "opportunity" && p.assumed) problems.set(p.id, p);
  }
  for (const [pid, P] of problems) {
    const proposedUnder = (q: PageBacking) => {
      const cards = [...nodes.values()].filter((x) => x.kind === "opportunity" && (x.topic === q.topic || sameTopic(x.title, q.title)));
      return cards.some((c) => [...nodes.values()].some((x) => x.kind === "solution" && x.parent === c.id));
    };
    const Q = [...input.pages]
      .filter((q) => q.sources >= 2 && q.topic !== P.topic && !sameTopic(q.title, P.title) && !proposedUnder(q))
      .sort((a, b) => b.sources - a.sources || b.quotes - a.quotes)[0];
    if (!Q) continue;
    const on = [...(P.item ? [pid] : []), ...items.filter((k) => k.kind === "solution" && k.parent === pid).map((k) => k.id)];
    if (!on.length) continue;
    const rests = Q.known.slice(0, 2).map((e) => add({ ...e, for: on }));
    if (!rests.length) continue;
    findings.push({ kind: "backing", on, rests, line: `Nothing customers said or that was measured backs “${P.title}” yet, while “${Q.title}” has ${Q.sources} sources behind it and nothing proposed for it.`, facts: [String(Q.sources)], weight: 80 + Q.sources });
  }

  // ---- Decided before: a card with the same words dropped, or a proposal like it left out.
  for (const d of input.decided) {
    const on = items.filter((k) => sameTopic(k.title, d.title)).map((k) => k.id);
    if (!on.length) continue;
    const at = add({ kind: "decided", whose: "decided", from: dateOf(d.at), text: `${d.what}${d.why ? ` · why: ${d.why}` : ""}`, for: on, decision: d.id });
    const why = d.why ? one(d.why).replace(/[.!?]+$/, "") : "";
    findings.push({
      kind: "decided",
      on,
      rests: [at],
      line: `On ${dateOf(d.at)}, “${d.title}” was ${d.kind === "drop" ? "dropped" : "left out when Qalam AI proposed it"}${why ? `, with the reason “${why}”` : ""}.`,
      facts: [dateOf(d.at)],
      weight: 70,
    });
  }

  findings.sort((a, b) => b.weight - a.weight);
  return { findings, evidence };
}

/** How many points of completion fixing one step whole could add (its people going on at the later steps' rates), and the goal's gap; null unless the funnel is the goal's own number. */
export function capOf(f: Funnel, at: number, g: GoalNumber): { gain: number; gap: number } | null {
  if (!f.first || g.current === null || g.target === null) return null;
  const lostAll = f.steps.reduce((sum, s) => sum + (s.lost ?? 0), 0);
  const completion = ((f.first - lostAll) / f.first) * 100;
  // The funnel is the goal's own number only when its completion is the goal's, within 5%.
  if (Math.abs(completion - g.current) > FIND_LIMITS.tolerance * Math.abs(g.current || 1)) return null;
  const gap = g.target - g.current;
  const S = f.steps[at];
  if (gap <= 0 || !S.lost) return null;
  const goesOn = f.steps.slice(at + 1).reduce((rate, s) => rate * (1 - (s.share ?? 0)), 1);
  const gain = ((S.lost * goesOn) / f.first) * 100;
  return gain < gap ? { gain, gap } : null;
}

/** The titles a decision is about: a dropped card's, or each proposal a batch left out ("Add “X”"). */
export function decidedTitles(d: { kind: string; cardTitle: string; detail?: Record<string, unknown> }): string[] {
  if (d.kind === "drop") return d.cardTitle ? [d.cardTitle] : [];
  if (d.kind !== "discard") return [];
  const list = Array.isArray(d.detail?.proposals) ? (d.detail.proposals as { kind?: unknown; line?: unknown }[]) : [];
  return list.flatMap((p) => (p.kind === "card" || p.kind === "goal") && typeof p.line === "string" ? (/“([^”]+)”/.exec(p.line)?.[1] ?? []) : []);
}
