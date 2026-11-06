import type { PlanQuestion } from "@/ai/plan";
import type { OstMetric } from "@/discovery/types";
import { checkWords, sameTopic, valuesIn, type Topic } from "@/hub/topics";
import { pagesBlock, pageLines, companyLines, type PagesSent } from "@/market/rivals";
import type { Market, MarketLine } from "@/market/types";
import type { Bears } from "./bearings";
import { metricLine } from "./goals-md";
import { sanitizeClaims, type Benchmark, type OutsidePage } from "./outside";
import { withoutIds } from "./said";
import type { Goal } from "./types";

/*
 * The goal a problem could move, in the canvas's chat (pure): first whether it would move a goal on
 * the canvas; with none, the web for what companies like theirs measure when they work on a problem
 * like it, and goals proposed from that; then the number, theirs when they have one, else one
 * suggested. A goal and a number are the person's choice, so nothing here is kept as fact: a number
 * others report is found on its page word for word, a suggestion says whether it rests on those or
 * only on what Qalam AI knows of the industry, and it's a goal's target only once they take it.
 */

/** A goal on the canvas it would move. */
export interface GoalFit {
  goal: string;
  title: string;
  bears: Bears;
  how: string;
}

/** A goal proposed for it: what to measure, and what others report (none: only what Qalam AI knows). */
export interface GoalIdea {
  id: string;
  title: string;
  metric: { name: string; unit?: string; direction: OstMetric["direction"] };
  why: string;
  others: Benchmark[];
}

export interface MovesFound {
  fits: GoalFit[];
  ideas: GoalIdea[];
  /** The web was asked (noWeb: it can't be here); `goals`: how many on the canvas it was read against. */
  looked: { noWeb?: true; goals?: number; pages: { title: string; url: string }[] } | null;
}

/** A number suggested for a goal: a target, or (with nothing to apply it to yet) how far to move it. */
export interface SuggestedNumber {
  target: number | null;
  /** Percent to move it by. */
  move: number | null;
  timeframe?: string;
  why: string;
  /** What it rests on: what others report, checked on their pages. None: only what Qalam AI knows, checked nowhere. */
  others: Benchmark[];
}

export const MOVES_LIMITS = { words: 12, ideas: 3, others: 3, title: 120, name: 80, why: 600, timeframe: 40 } as const;

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clip = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");

/**
 * The problem as bearing calls read it: its page's lines when it has one, else a stand-in page made
 * of its card's words, so a card with no page goes through the same rules. The title stands in when
 * nothing else is known about it: a link needs a line to rest on.
 */
export function problemAsTopic(o: { id: string; title: string; words: readonly string[]; products?: string[]; now: number }): Topic {
  const said = [...new Set(o.words.map(one).filter(Boolean))].slice(0, MOVES_LIMITS.words);
  const lines = (said.length ? said : [one(o.title)]).map((text, i) => ({ id: `w${i + 1}`, section: "know" as const, text, by: "person" as const, cites: [], from: [], at: o.now }));
  return { id: o.id, kind: "need", title: one(o.title), products: o.products ?? [], createdAt: o.now, updatedAt: o.now, lines, history: [] };
}

// ---------------------------------------------------------------------------
// Goals looked for on the web

/** What the research step is asked: what companies like theirs measure, and report, when they work on a problem like it. */
export function movesTask(o: { org: string; about: string; product?: string; facts?: readonly MarketLine[]; problem: string; words?: readonly string[] }): string {
  return [
    `${o.org}${o.about.trim() ? `: ${one(o.about).slice(0, 600)}` : ""}`,
    ...(o.facts?.length ? [companyLines(o.facts.slice(0, 6))] : []),
    `A customer problem ${o.product ? `of its product ${o.product}` : "it has"}: “${one(o.problem)}”.`,
    ...(o.words?.length ? [`What backs it: ${o.words.slice(0, 4).map(one).join(" · ").slice(0, 800)}`] : []),
    "When companies like it work on a problem like this one, which goal do they set and which number do they watch? What do they report that number to be, typically and at its best, and how far did it move once they fixed the problem?",
  ].join("\n");
}

/** What the ideas call reads: the problem, the goals it doesn't fit, what companies like it aim for, the notes and the pages (w1…). */
export function ideasMaterial(o: { org: string; about: string; market: Market; problem: string; words: readonly string[]; goals: readonly string[]; notes: string; pages: OutsidePage[] }): PagesSent {
  const pages = pagesBlock(o.pages);
  const text = [
    `The company: “${o.org}”.${o.about.trim() ? ` ${one(o.about)}` : ""}`,
    companyLines(o.market.company),
    "",
    `The problem: “${one(o.problem)}”`,
    ...(o.words.length ? ["What backs it:", ...o.words.slice(0, MOVES_LIMITS.words).map((w) => `- ${one(w)}`)] : []),
    "",
    o.goals.length ? `Goals they have, which it wouldn't move (propose none of these):\n${o.goals.map((g) => `- ${one(g)}`).join("\n")}` : "They have no goals yet.",
    ...(o.market.aims.length ? ["", "What companies like it usually aim for (read on the web):", ...o.market.aims.map((l) => `- ${one(l.text)}`)] : []),
    "",
    o.notes.trim() ? `What the research step wrote:\n${o.notes.trim()}` : "The research step found nothing, or the web can't be reached here.",
    "",
    pages.size ? "The pages, as read (id · title · address, then the page's start):" : "No pages were read.",
    ...pageLines(pages),
  ].join("\n");
  return { text, pages };
}

/** What code keeps of the proposed goals: at most 3, none a goal they have, its numbers in what it was sent, what others report only where its page has it. */
export function sanitizeIdeas(raw: unknown, m: PagesSent, o: { problem: string; words: readonly string[]; goals: readonly string[]; aims?: readonly MarketLine[]; now: number; id: () => string; fold?: (s: string) => string }, dropped?: (why: string, item: unknown) => void): GoalIdea[] {
  const out: GoalIdea[] = [];
  const hay = [o.problem, ...o.words, ...(o.aims ?? []).map((l) => l.text), ...[...m.pages.values()].map((p) => p.text)].join("\n");
  for (const x of list(rec(raw).goals)) {
    if (out.length >= MOVES_LIMITS.ideas) {
      dropped?.("over the limit", x);
      continue;
    }
    const g = rec(x);
    const title = checkWords(withoutIds(g.title, () => undefined, "w"), [], hay, MOVES_LIMITS.title);
    const name = clip(g.metric_name, MOVES_LIMITS.name);
    if (!title || !name) {
      dropped?.(!name ? "nothing to measure it by" : "a number in it that nothing it read has", x);
      continue;
    }
    if ([...o.goals, ...out.map((i) => i.title)].some((t) => sameTopic(t, title, o.fold))) {
      dropped?.("a goal they have, or there twice", x);
      continue;
    }
    const why = checkWords(withoutIds(g.why, () => undefined, "w"), [], hay, MOVES_LIMITS.why) ?? "";
    const unit = clip(g.unit, 24).replace(/\s*\([^)]*\)/g, "").trim();
    const others = sanitizeClaims({ claims: list(g.others) }, m, { now: o.now }, dropped).slice(0, MOVES_LIMITS.others);
    out.push({ id: o.id(), title, metric: { name, ...(unit ? { unit } : {}), direction: g.direction === "decrease" ? "decrease" : "increase" }, why, others });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The number: theirs, else one suggested

const open = (id: string, title: string, why: string): PlanQuestion => ({ id, title, why, multi: false, options: [], recommended: [], allowOther: false });

/** What the box asks about a goal's number (only what it doesn't have): none when it has it all. */
export function numberRound(metric: Partial<Pick<OstMetric, "name" | "unit" | "current" | "baseline" | "target">> | undefined): PlanQuestion[] {
  if (metric?.target !== null && metric?.target !== undefined) return [];
  const name = metric?.name?.trim();
  return [
    ...(name ? [] : [open("name", "What number would show it moving?", "One you could read every week or month. Skip it and the goal stays without a number.")]),
    ...(metric?.current !== null && metric?.current !== undefined || metric?.baseline !== null && metric?.baseline !== undefined ? [] : [{ ...open("now", name ? `Where does ${name} stand today?` : "Where does it stand today?", "As far as you know. Skip it if you don't know yet."), tool: { kind: "numbers" as const, ...(name ? { lookFor: name } : {}) } }]),
    open("target", "Do you have a number in mind to reach?", "Skip it and I'll suggest one from what's normal in your industry."),
  ];
}

/** The numbers someone wrote, each once ("5k" is 5,000). */
function saidNumbers(said: string): number[] {
  return [...said.matchAll(/\d+(?:[.,]\d+)*(?:\s*(?:k|m|bn|%)(?![a-z]))?/gi)].flatMap((m) => valuesIn(m[0]).slice(-1));
}

/** The number in their answer to "where does it stand": the first they wrote. */
export const nowFrom = (said: string): number | null => saidNumbers(said)[0] ?? null;

/** Rounded as a person would say it: a tenth under 100, else whole. */
const shown = (n: number) => (Math.abs(n) < 100 ? Math.round(n * 10) / 10 : Math.round(n));

/**
 * The number in their answer to "a number in mind": the last they wrote (“from 40 to 55”). A percent
 * for a number that isn't one is how far to move it (“up 20%”), worked out from where it stands by
 * code, or kept as a move while that isn't known.
 */
export function targetFrom(said: string, o: { now: number | null; unit?: string; direction?: OstMetric["direction"] }): { target: number | null; move: number | null } | null {
  const n = saidNumbers(said).at(-1);
  if (n === undefined) return null;
  if (!/%/.test(said) || o.unit === "%") return { target: n, move: null };
  if (o.now === null) return { target: null, move: n };
  return { target: shown(o.now * (1 + ((o.direction === "decrease" ? -1 : 1) * n) / 100)), move: n };
}

export interface NumberSent {
  text: string;
  claims: Map<string, Benchmark>;
  now: number | null;
  direction: OstMetric["direction"];
  /** Words a suggestion may use beyond what others report. */
  also: string;
}

/** What the suggesting call reads: the goal, its number now, the problem, the company, and what others report (b1…). */
export function numberMaterial(o: { org: string; about: string; market: Market; goal: string; metric: { name: string; unit?: string; direction: OstMetric["direction"] }; now: number | null; problem: string; others: readonly Benchmark[] }): NumberSent {
  const claims = new Map(o.others.map((b, i) => [`b${i + 1}`, b]));
  const text = [
    `The company: “${o.org}”.${o.about.trim() ? ` ${one(o.about)}` : ""}`,
    companyLines(o.market.company),
    "",
    `Their goal: “${one(o.goal)}”, measured by ${o.metric.name}${o.metric.unit ? ` (${o.metric.unit})` : ""}, which should ${o.metric.direction === "decrease" ? "go down" : "go up"}.`,
    o.now === null ? "They don't know where it stands today." : `Where it stands today: ${o.now}${o.metric.unit ? ` ${o.metric.unit}` : ""}.`,
    `The problem they'd solve to move it: “${one(o.problem)}”`,
    "",
    claims.size ? "What others report, each checked on its page (id · who · what: number):" : "Nothing others report could be read on a page.",
    ...[...claims].map(([id, b]) => `- ${id} · ${one(b.who)} · ${one(b.what)}: ${b.value}${b.unit ? ` ${b.unit}` : ""} (“${one(b.quote)}”)`),
  ].join("\n");
  return { text, claims, now: o.now, direction: o.metric.direction, also: [o.goal, o.metric.name, o.problem].join("\n") };
}

/**
 * What code keeps of a suggestion. A target is on the right side of where it stands today; a move
 * with a number to apply it to becomes a target by code's arithmetic. What it cites is what others
 * report as they were sent. Its reason says no number that isn't one of those, the suggestion's or
 * where it stands: with nothing cited, a number can't have come from anywhere it could show.
 */
export function sanitizeNumber(raw: unknown, m: NumberSent, dropped?: (why: string, item: unknown) => void): SuggestedNumber | null {
  const r = rec(raw);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const up = m.direction !== "decrease";
  const move = (() => {
    const n = num(r.move);
    return n !== null && n > 0 ? n : null;
  })();
  let target = num(r.target);
  if (target !== null && m.now !== null && (up ? target <= m.now : target >= m.now)) {
    dropped?.("a target on the wrong side of where it stands", r);
    target = null;
  }
  if (target === null && move !== null && m.now !== null) target = shown(m.now * (1 + ((up ? 1 : -1) * move) / 100));
  if (target === null && move === null) {
    dropped?.("no number it could stand behind", r);
    return null;
  }
  const others = [...new Set(list(r.others).filter((c): c is string => typeof c === "string").map((c) => c.trim()))].flatMap((c) => m.claims.get(c) ?? []);
  const said = [m.also, ...others.map((b) => `${b.quote} ${b.value}`), m.now ?? "", target ?? "", move ?? ""].join("\n");
  const why = checkWords(withoutIds(r.why, () => undefined, "b"), [], said, MOVES_LIMITS.why);
  if (!why) dropped?.("its reason says a number that isn't in what it was sent, or runs too long", r);
  const timeframe = clip(r.timeframe, MOVES_LIMITS.timeframe);
  return { target, move, ...(timeframe ? { timeframe } : {}), why: why ?? "", others };
}

/** A number with its unit, as a person writes it: "30%", "120 orders". */
export const withUnit = (n: number, unit?: string) => `${n.toLocaleString("en-US")}${!unit ? "" : /^[\p{L}\p{N}]/u.test(unit) ? ` ${unit}` : unit}`;

/** A goal's number in a line, as the thread says it. */
export const goalNumberLine = (m: Pick<OstMetric, "name" | "unit" | "direction" | "baseline" | "current" | "target"> | undefined) => (m ? [m.name, metricLine(m)].filter(Boolean).join(": ") : "");

/** The goals a call may name, as words for it: what's on the canvas that's still being worked on. */
export const activeGoals = (goals: readonly Goal[], on: readonly string[]) => on.filter((id) => goals.find((g) => g.id === id)?.status === "active");
