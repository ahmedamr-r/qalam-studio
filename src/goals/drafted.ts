import type { Basis } from "@/discovery/basis";
import { cameFrom, whose } from "@/discovery/solutions";
import type { Came } from "@/discovery/types";
import type { QuoteRef } from "@/discovery/proposals";
import { checkWords, cleanLine, holdWords, sameTopic } from "@/hub/topics";
import { withCompany } from "@/market/text";
import { titleOf } from "@/org/setup-groups";
import { withoutIds } from "./said";

/*
 * Drafting a goal's problems (pure): Qalam AI reads the goal and the goals it feeds, the problems
 * behind it already, the problem pages the organization has, and the words a problem may rest on
 * (customers', people online's, the team's answers when asked), and proposes the customer problems
 * that, solved, would move the goal. Evidence is better when there is some, but it isn't asked for:
 * a problem resting on nothing stays, and says where it came from (`came`). Code leaves out what's
 * behind the goal or on a page already. A title that cites words keeps its wording where they hold
 * its quoted words and numbers, else it's the words of its first quote, as the setup's problems are
 * titled. Anything else loses the quotes and numbers that weren't sent.
 */

export const PROBLEM_LIMITS = { problems: 4, enough: 2, pieces: 24, pages: 30, behind: 20, above: 3, title: 120, description: 360, why: 240, note: 400 } as const;

export interface ProblemsInput {
  goal: { title: string; metric: string | null };
  /** What's known about the company and its competitors: words a draft, never what it rests on. */
  company?: string;
  /** The goals it feeds, nearest first. */
  above: { title: string; metric: string | null }[];
  /** The problems behind it already: its cards under it, and the pages linked to it. */
  behind: string[];
  /** The organization's problem pages in its scope: what Find its problems links, never proposed again. */
  pages: string[];
  /** The words a problem may rest on: customers', people online's, and the team's. */
  pieces: { ref: string; text: string; label: string; source: string | null; evidence: boolean; online?: boolean; basis?: Basis }[];
  /** What was read on the web while asking: others' words, never evidence. */
  read?: { text: string; url?: string; title?: string; quote?: string }[];
}

type Piece = ProblemsInput["pieces"][number];

export interface ProblemsSent {
  text: string;
  pieces: Map<string, Piece>;
  /** What was read on the web, by id (w…). */
  read: Set<string>;
  /** What's there already, by title: behind the goal, or on a page. */
  known: string[];
  /** Every word it was sent, its ids taken out: what a draft's quoted words and numbers must come from. */
  hay: string;
}

export interface ProblemDraft {
  id: string;
  title: string;
  /** Whose words the title is: Qalam AI's (held by what it cites), or its first quote's. */
  by: "qalam" | "words";
  /** When it happens and what it costs them ("" when its words didn't hold). */
  description: string;
  /** How solving it would move the goal ("" when its words didn't hold). */
  why: string;
  /** The pieces it rests on (refs). */
  cites: string[];
  /** Where it came from, when nothing that can reach "We know" backs it. */
  came?: Came;
  at: number;
}

/** A goal's drafted problems and what was decided about each (kept in its work file), with where the words they cite live. */
export interface DraftedProblems {
  at: number;
  model?: string;
  note: string;
  drafts: ProblemDraft[];
  quotes: Record<string, QuoteRef>;
  decided: Record<string, "accepted" | "discarded">;
}

/** A draft call's answer as code kept it, with where the words its problems rest on live (by piece). */
export interface ProblemsDrafted {
  drafts: ProblemDraft[];
  note: string;
  quotes: Record<string, QuoteRef>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const numbered = (g: { title: string; metric: string | null }) => `“${one(g.title)}” · ${g.metric ? `its number: ${one(g.metric)}` : "no number yet"}`;

/** The material: the goal under the goals it feeds, what's there already, and the words (q…), customers' first. */
export function problemsMaterial(o: ProblemsInput): ProblemsSent {
  const out: string[] = [`The goal: ${numbered(o.goal)}`];
  for (const g of o.above.slice(0, PROBLEM_LIMITS.above)) out.push(`It feeds: ${numbered(g)}`);
  const behind = o.behind.slice(0, PROBLEM_LIMITS.behind);
  if (behind.length) out.push("", "Problems behind it already (don't propose these again):", ...behind.map((t) => `- ${one(t)}`));
  const pages = o.pages.filter((t) => !behind.some((b) => sameTopic(b, t))).slice(0, PROBLEM_LIMITS.pages);
  if (pages.length) out.push("", "Problem pages the organization has (Find its problems links these; don't propose them again):", ...pages.map((t) => `- ${one(t)}`));
  const pieces = new Map<string, Piece>();
  const order = [...o.pieces.filter((p) => p.evidence), ...o.pieces.filter((p) => !p.evidence && !p.online), ...o.pieces.filter((p) => !p.evidence && p.online)];
  out.push("", "The words a problem may rest on (id · whose · where · words):");
  for (const p of order.slice(0, PROBLEM_LIMITS.pieces)) {
    const id = `q${pieces.size + 1}`;
    pieces.set(id, p);
    out.push(`- ${id} · ${whose(p)} · ${one(p.label)} · “${one(p.text)}”`);
  }
  if (!pieces.size) out.push("(no words yet)");
  const read = new Set<string>();
  if (o.read?.length) {
    out.push("", "What was read on the web about goals like it (id · the line · its words). Others' words, never evidence about these customers:");
    o.read.slice(0, PROBLEM_LIMITS.pieces).forEach((l, i) => {
      read.add(`w${i + 1}`);
      out.push(`- w${i + 1} · ${one(l.text)}${l.quote ? ` · “${one(l.quote)}”` : ""}`);
    });
  }
  const text = out.join("\n");
  // What words and numbers may come from: the material without its ids ("q5" isn't a 5 anyone said).
  return { text: withCompany(text, o.company), pieces, read, known: [...behind, ...pages], hay: text.replace(/(^|\s)[qw]\d+ ·/gm, "$1") };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : []);

/**
 * What code keeps of the answer: at most so many problems, none there already or proposed twice,
 * each saying where it came from when nothing that can reach "We know" backs it. `dropped` hears what
 * was left out and why (for the call's trace).
 */
export function sanitizeProblems(raw: unknown, m: ProblemsSent, o: { now: number; id: () => string }, dropped?: (why: string, item: unknown) => void): { drafts: ProblemDraft[]; note: string } {
  const drafts: ProblemDraft[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  const said = (v: unknown, max: number) => holdWords(withoutIds(v, () => undefined, "qw"), m.hay, { max, shape: "prose" }).text;
  for (const x of Array.isArray(rec(raw).problems) ? (rec(raw).problems as unknown[]) : []) {
    if (drafts.length >= PROBLEM_LIMITS.problems) {
      drop("over the limit", x);
      continue;
    }
    const p = rec(x);
    const cited = [...new Set(strs(p.cites).filter((r) => m.pieces.has(r)))].map((r) => m.pieces.get(r)!);
    // Its title as Qalam AI put it where what it cites holds its quoted words and numbers; else its first quote's words, customers' first.
    const put = withoutIds(p.title, () => undefined, "qw");
    const quoted = put && cited.length ? checkWords(put, cited, "", PROBLEM_LIMITS.title) : null;
    // With nothing to cite, what wasn't sent comes out of its title, and a title with nothing left says nothing.
    const title = quoted ? cleanLine(quoted) : cited.length ? titleOf((cited.find((c) => c.evidence) ?? cited[0]).text) : holdWords(put, m.hay, { max: PROBLEM_LIMITS.title, shape: "title" }).text;
    if (!title) {
      drop("its title says nothing once what wasn't sent is out", x);
      continue;
    }
    if (m.known.some((k) => sameTopic(k, title)) || drafts.some((d) => sameTopic(d.title, title))) {
      drop("behind the goal or on a page already, or proposed twice", x);
      continue;
    }
    const description = said(p.description, PROBLEM_LIMITS.description);
    const why = said(p.why, PROBLEM_LIMITS.why);
    if (cited.length && !quoted) drop("its title's words or numbers aren't in what it cites: titled by its first quote", x);
    if (!description || !why) drop("its description's words or numbers aren't in what was sent: kept without it", x);
    drafts.push({ id: o.id(), title, by: !cited.length || quoted ? "qalam" : "words", description, why, cites: cited.map((c) => c.ref), ...cameFrom(cited, strs(p.cites).some((r) => m.read.has(r))), at: o.now });
  }
  const note = said(rec(raw).note, PROBLEM_LIMITS.note);
  const short = drafts.length ? (drafts.length < PROBLEM_LIMITS.enough ? "Qalam AI has only one problem to propose." : "") : "Qalam AI has no new problem to propose.";
  return { drafts, note: [note, short].filter(Boolean).join(" ") };
}
