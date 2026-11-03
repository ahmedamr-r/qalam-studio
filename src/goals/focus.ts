import type { PlanQuestion } from "@/ai/plan";
import { hostOf } from "@/ai/research-shared";
import { checkedLine, companyLines, pageLines, pagesBlock, type PagesSent } from "@/market/rivals";
import type { Market, MarketLine } from "@/market/types";
import type { FindQuestionsSent, TextPart } from "@/space/find";
import { metricLine } from "./goals-md";
import type { OutsidePage } from "./outside";
import type { Goal } from "./types";

/*
 * Finding the problem to focus on for a goal, in the canvas's chat (src/ui/space/chat/): Qalam AI
 * looks on the web for what usually gets in the way of goals like it, asks the person about theirs
 * from what it read, looks again where their answers call for it, then proposes 1 to 3 problems
 * under the goal, each resting on their words. A look is the research step's notes and the pages
 * code read itself; code keeps a line only where its quote is on its page word for word with its
 * numbers in it. What's read there is others' words: context for the questions and the choice,
 * never customers' evidence, never what a card rests on. Pure.
 */

export interface FocusLook {
  at: number;
  /** What was looked up ("": the opening look, what usually gets in the way of goals like it). */
  query: string;
  /** What the pages say, each line checked on its page. */
  lines: MarketLine[];
  pages: { title: string; url: string }[];
  /** No web search here: nothing was looked up. */
  noWeb?: true;
}

/** What a look came to: the look, and with `open`, the first questions (none when nothing held: code's own are asked). */
export interface FocusLooked {
  look: FocusLook;
  questions: PlanQuestion[];
}

export const FOCUS_LIMITS = { lines: 6, query: 200, said: 2000, looks: 8 } as const;

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A goal in words: its title, and its number when it has one. */
export const goalLine = (g: Pick<Goal, "title" | "metric">) => `“${one(g.title)}”${g.metric ? ` (${[g.metric.name, metricLine(g.metric)].filter(Boolean).join(": ")})` : ""}`;

/** What the research step is asked: what usually gets in the way of goals like it, or (`query`) what their answers called for. */
export function focusTask(o: { org: string; about: string; product?: string; chain: Goal[]; goal: Goal; facts?: readonly MarketLine[]; query?: string; said?: string }): string {
  const above = o.chain.filter((g) => g.id !== o.goal.id);
  return [
    `${o.org}${o.about.trim() ? `: ${one(o.about).slice(0, 600)}` : ""}`,
    ...(o.facts?.length ? [companyLines(o.facts.slice(0, 6))] : []),
    `A goal of ${o.product ? `its product ${o.product}` : "the company's"}: ${goalLine(o.goal)}.`,
    ...(above.length ? [`It feeds: ${above.map((g) => `“${one(g.title)}”`).join(", then ")}.`] : []),
    ...(o.said?.trim() ? [`What the team told us about it: ${one(o.said).slice(0, 800)}`] : []),
    o.query?.trim()
      ? `Look up: ${one(o.query).slice(0, FOCUS_LIMITS.query)}. What do others report about it, for goals like this one?`
      : "What usually keeps companies like it from reaching a goal like this one: what do the people it depends on struggle with, put off or give up on, and why? Which problems did companies in this domain find behind goals like it?",
  ].join("\n");
}

/** What the look's call reads: the goal, what was looked up, what earlier looks found (`known`, not to give again), the notes, and each page's start (w1…). */
export function focusMaterial(o: { org: string; goal: Goal; query?: string; known?: readonly MarketLine[]; notes: string; pages: OutsidePage[] }): PagesSent {
  const pages = pagesBlock(o.pages);
  const text = [
    `The company: “${o.org}”. Its goal: ${goalLine(o.goal)}.`,
    o.query?.trim() ? `What was looked up: ${one(o.query)}` : "What was looked up: what usually gets in the way of goals like it.",
    ...(o.known?.length ? ["", "Found on earlier looks (leave these out: only what's new, or what bears on what was looked up):", ...o.known.map((l) => `- ${one(l.text)}`)] : []),
    "",
    o.notes.trim() ? `What the research step wrote:\n${o.notes.trim()}` : "The research step found nothing.",
    "",
    "The pages, as read (id · title · address, then the page's start):",
    ...pageLines(pages),
  ].join("\n");
  return { text, pages };
}

/** What code keeps of a look: at most 6 lines, each on a page read, its quote there word for word and its numbers in the quote, none twice and none an earlier look found (`known`) on the same words. */
export function sanitizeLook(raw: unknown, m: PagesSent, o: { now: number; id: () => string; known?: readonly MarketLine[] }, dropped?: (why: string, item: unknown) => void): MarketLine[] {
  const out: MarketLine[] = [];
  const before = new Set((o.known ?? []).flatMap((l) => [one(l.text).toLowerCase(), ...(l.quote ? [one(l.quote).toLowerCase()] : [])]));
  for (const x of list(rec(raw).lines)) {
    if (out.length >= FOCUS_LIMITS.lines) {
      dropped?.("over the limit", x);
      continue;
    }
    const l = checkedLine(rec(x), m.pages, { now: o.now, id: o.id() });
    if (!l) dropped?.("its quote isn't on its page, or a number isn't in it", x);
    else if (before.has(one(l.text).toLowerCase()) || (l.quote && before.has(one(l.quote).toLowerCase()))) dropped?.("an earlier look found it", x);
    else if (out.some((k) => one(k.text).toLowerCase() === one(l.text).toLowerCase())) dropped?.("there twice", x);
    else out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The opening round

const open = (id: string, title: string, why: string): PlanQuestion => ({ id, title, why, multi: false, options: [], recommended: [], allowOther: false });

/** Code's own opening questions (nothing was read, or Qalam AI asked nothing that held): open, each skippable. */
export function focusRound(): PlanQuestion[] {
  return [
    open("who", "Who has to do something different for it to move?", "The problem to focus on is theirs."),
    { ...open("way", "What gets in their way today, as far as you know?", "What you've seen, heard or suspect: say which."), tool: { kind: "docs" as const, lookFor: "customer research feedback" } },
    open("tried", "What have you tried for it so far, and what happened?", "So what's proposed isn't something you've ruled out."),
  ];
}

/** What the opening questions call reads: the goal, the company, what the look found, and what customers in its domain struggle with. */
export function focusQuestionsMaterial(o: { org: string; about: string; goal: Goal; chain: Goal[]; market: Market; lines: readonly MarketLine[] }): FindQuestionsSent {
  const m = o.market;
  const above = o.chain.filter((g) => g.id !== o.goal.id);
  const known = [o.about, o.goal.title, ...above.map((g) => g.title), ...m.company.map((l) => l.text), ...m.struggles.map((l) => l.text), ...m.aims.map((l) => l.text), ...m.competitors.flatMap((c) => [c.name, ...c.lines.map((l) => l.text)]), ...o.lines.map((l) => l.text)].map(one).filter(Boolean);
  const text = [
    `They want to find the problem to focus on to move their goal ${goalLine(o.goal)}.`,
    ...(above.length ? [`It feeds: ${above.map((g) => `“${one(g.title)}”`).join(", then ")}.`] : []),
    "",
    `The company, “${o.org}”:`,
    ...(o.about.trim() ? [one(o.about)] : []),
    ...m.company.map((l) => `- ${one(l.text)}`),
    ...(m.competitors.length ? ["", `Its competitors: ${m.competitors.map((c) => c.name).join(", ")}`] : []),
    "",
    "What usually gets in the way of goals like it (read on the web just now, others' words):",
    ...(o.lines.length ? o.lines.map((l) => `- ${one(l.text)}`) : ["- (nothing found)"]),
    "",
    "What customers of companies like it usually struggle with (read on the web):",
    ...(m.struggles.length ? m.struggles.map((l) => `- ${one(l.text)}`) : ["- (nothing found)"]),
  ].join("\n");
  return { text, known };
}

// ---------------------------------------------------------------------------
// As the source reads

/** A look's heading in the source: what was looked up, said as others' words. */
export const lookHead = (look: Pick<FocusLook, "query">) =>
  look.query ? `Qalam AI looked on the web for “${one(look.query)}” (others' words, not yours or your customers'):` : "What Qalam AI read on the web before asking (others' words, not yours or your customers'):";

/** A look's lines in the source, each with where it was read. */
export const lookLines = (look: Pick<FocusLook, "lines">) => look.lines.map((l) => `- ${one(l.text)}${l.url ? ` (${hostOf(l.url)})` : ""}`);

/**
 * Their answers as a source that reads on its own: what they asked for, what Qalam AI read on the
 * web before asking, then each question and their answer (skipped ones left out). Only the answers
 * are theirs (`theirs`); the headings and questions are the text's shape.
 */
export function focusTranscript(questions: readonly PlanQuestion[], answers: Readonly<Record<string, string>>, o: { goal: string; org?: string; look?: FocusLook | null }): { text: string; parts: TextPart[] } {
  const head = `Finding the problem to focus on for “${one(o.goal)}”${o.org ? ` at ${one(o.org)}` : ""}: Qalam AI asked, and you answered.`;
  const pairs = questions.map((q) => ({ q: one(q.title), a: (answers[q.id] ?? "").trim() })).filter((p) => p.a);
  const web = o.look?.lines.length ? { head: lookHead(o.look), lines: lookLines(o.look) } : null;
  const parts: TextPart[] = [{ words: head, theirs: false }, ...(web ? [{ words: web.head, theirs: false }] : []), ...pairs.flatMap((p) => [{ words: p.q, theirs: false }, { words: p.a, theirs: true }])];
  return { text: [head, ...(web ? [[web.head, ...web.lines].join("\n")] : []), ...pairs.map((p) => `${p.q}\n${p.a}`)].join("\n\n"), parts };
}
