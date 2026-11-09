import { backingWords, type BasisCounts } from "./basis";
import type { EvidenceSummary } from "./evidence";
import type { OstKind, SolutionType } from "./types";
import type { Strength } from "@/hub/needs";
import { lab } from "@/lab";

/*
 * What to do next with a card on the canvas (pure, no tokens): the steps that fit it, best first,
 * worked out from what's known about it, and one line on what it rests on. Qalam AI runs only when
 * a step is picked (src/ui/discovery/next.ts). What v0.1 hides (src/lab.ts) isn't offered.
 */

export type StepId = "draft-solutions" | "draft-tests" | "design-this" | "page" | "pass-line" | "next-job" | "find-problems" | "break-down" | "review-parts" | "others" | "find-backing" | "look-tools" | "watch" | "connect" | "add-file" | "draft-problems" | "review-problems" | "focus" | "find-goal" | "write-brief" | "open-brief" | "word-message" | "run-steps" | "plan-modules";

export interface NextStep {
  id: StepId;
  label: string;
  /** A few words on what it does. */
  hint?: string;
  /** Qalam AI runs it. */
  ai?: boolean;
  /** It asks a few questions first (nothing backs the card yet; src/discovery/questions.ts). */
  asks?: boolean;
  /** Why it can't run now. */
  blocked?: string;
}

/** What's known about a card, from what the canvas has loaded. */
export interface CardFacts {
  kind: OstKind;
  /** A solution: what it is, which says what comes next for it. */
  solutionType?: SolutionType;
  evidence: EvidenceSummary;
  /** A problem's page, and how much it rests on. */
  page: { topic: string; strength: Strength; quotes: number; sources: number; mix?: BasisCounts } | null;
  /** What's under it already: for a problem, its checks that confirmed it (`confirmed`). */
  under: { solutions: number; tests: number; confirmed?: number };
  /** A goal is above it on the canvas. */
  underGoal?: boolean;
  /** A goal's number in a line (null: none yet), the problems behind it, its next job, and what was proposed for it not decided yet: goals under it, problems behind it. */
  goal?: { id: string; number: string | null; behind: number; job: string | null; pending: number; drafted: number };
  /** Problem pages there are (what Find its problems reads). */
  pages: number;
  /** The organization's search answers here, and it has material to search. */
  search: boolean;
  material: boolean;
  /** The connected tools that bring material in, by name (null: not known yet). */
  tools: string[] | null;
  /** The connected tools a look across them would search (material and numbers), by name (null: not known, or the look is hidden). */
  lookIn?: string[] | null;
  /** The tools watching for it already, by name. */
  feeds: string[];
  /** The person answered questions about it already (the card rests on their answers, or they're kept for it, drafted with). */
  answered: boolean;
  /** Questions about it were left half-way: its draft picks them up. */
  asking?: boolean;
  /** A test whose pass line Qalam AI suggested and nobody has set. */
  suggested?: boolean;
  /** Its brief, once one's written. */
  brief?: string;
  /** Qalam AI can run here. */
  ai: boolean;
  /** Qalam AI's proposals are under review: a new draft waits for them. */
  reviewing: boolean;
  /** Qalam AI is on another card. */
  busyElsewhere: boolean;
}

/** The most steps shown at once; the rest are under More. */
export const SHOWN = 4;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Nothing behind the card yet: a problem with no quotes on it or its page, a goal with no problems behind it, and no answers from the person. */
export function thin(f: CardFacts): boolean {
  if (f.answered) return false;
  if (f.kind === "outcome") return !f.goal?.behind;
  if (f.kind === "opportunity") return !f.evidence.quotes && !f.page?.quotes;
  return false;
}

/** A draft's hint while nothing backs the card: it asks first, in the chat, or picks up where they left it. */
const asksHint = (f: CardFacts) => (f.asking ? "Picks up your answers where you left them" : "Asks you first, in the chat");

/** Tools by name, in a line: "Notion", "Notion and Slack", "Notion, Slack and 2 more". */
export function toolNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Ways to ground a card: the organization's words, every connected tool looked in for it, a tool watched for it, a file read for it. */
function grounding(f: CardFacts): { find: NextStep | null; look: NextStep | null; watch: NextStep | null; file: NextStep } {
  const quotable = f.kind === "opportunity" || f.kind === "solution";
  const find: NextStep | null = quotable && f.search && f.material ? { id: "find-backing", label: f.evidence.quotes ? "Find more that backs it" : "Find what backs it", hint: "In your organization · free" } : null;
  const tools = f.tools ?? [];
  // Feeds and connectors are hidden in v0.1 (src/lab.ts).
  const watch: NextStep | null =
    f.tools === null || !lab("feeds") ? null
    : tools.length ? { id: "watch", label: tools.length === 1 ? `Watch ${tools[0]} for it` : "Watch a tool for it", hint: f.feeds.length ? `Watched in ${f.feeds.join(", ")} already` : "What's new there, brought in under it" }
    : lab("connectors") ? { id: "connect", label: "Connect a tool", hint: "Intercom, Slack, Notion… in Connections" }
    : null;
  const file: NextStep = { id: "add-file", label: "Add a file for it", hint: f.kind === "outcome" ? "Any file: Qalam AI asks about it, then proposes its problems" : "Any file: Qalam AI asks about it, then places it under it" };
  // Hidden in v0.1 (src/lab.ts): one look in every connected tool, its finds brought in under the card.
  const look: NextStep | null = lab("everywhere") && f.lookIn?.length && f.kind !== "test" ? { id: "look-tools", label: "Look in your tools for it", hint: `${toolNames(f.lookIn)}, side by side`, ai: true } : null;
  return { find, look, watch, file };
}

/** The steps that fit a card, best first. */
export function nextSteps(f: CardFacts): NextStep[] {
  const out: NextStep[] = [];
  const ground = grounding(f);
  const push = (...steps: (NextStep | null)[]) => {
    for (const s of steps) if (s) out.push(s);
  };
  // A brief or PRD for whoever builds it, on what's known so far; once written, a tile under the card.
  const brief: NextStep = f.brief ? { id: "open-brief", label: "Its brief", hint: "Under this card on the canvas" } : { id: "write-brief", label: "Write a brief", hint: "A PRD for your coding agent", ai: true };
  switch (f.kind) {
    case "opportunity": {
      const bare = thin(f);
      // Every draft asks first, in the chat, as long as it needs. With nothing behind it, it starts with what they know, and looks on the web: a draft doesn't need evidence, so it asks instead of coming back with little.
      const asks = bare || !!f.asking;
      const draft: NextStep = { id: "draft-solutions", label: "Draft solutions", hint: asks ? asksHint(f) : f.under.solutions ? "More ways to solve it, each with a test" : "Ways to solve it, each with a test", ai: true, ...(asks ? { asks } : {}) };
      const page: NextStep | null = f.page ? { id: "page", label: "Its page", hint: "Everything known about it" } : null;
      // No goal above it: which one solving it would move, its own or one found, and that goal's number.
      const goal: NextStep | null = f.underGoal ? null : { id: "find-goal", label: "Find the goal it could move", hint: "Your goals first, then the web, then its number", ai: true };
      // A check confirmed it's really there: what to do about it comes first.
      if (f.under.confirmed) push(draft, brief, goal, ground.find, ground.look, ground.watch, ground.file, page);
      // Nothing behind it yet: what the organization has first, when it has something.
      else if ((asks || bare) && (ground.find || ground.look)) push(ground.find, ground.look, draft, brief, goal, ground.watch, ground.file, page);
      else push(draft, brief, goal, ground.find, ground.look, ground.watch, ground.file, page);
      break;
    }
    case "solution":
      // Hidden in v0.1 (src/lab.ts): Draft solutions gave it a test already, and Design this is the design tool.
      if (lab("tests")) push({ id: "draft-tests", label: "Draft its tests", hint: f.under.tests ? "More of what it assumes, and a test" : "What it assumes, and a test of the riskiest", ai: true });
      if (lab("design")) push({ id: "design-this", label: "Design this", hint: "Screens built on what it rests on" });
      // What it is says what comes next: what's built gets a brief, a message its wording, what's done by hand its steps.
      if (f.solutionType === "message") out.unshift(f.brief ? { id: "open-brief", label: "Its message plan", hint: "Under this card on the canvas" } : { id: "word-message", label: "Word the message", hint: "What to say, on which channel, with which tool", ai: true });
      else if (f.solutionType === "service") out.unshift(f.brief ? { id: "open-brief", label: "Its steps", hint: "Under this card on the canvas" } : { id: "run-steps", label: "Steps to run this week", hint: "Who does what, and how you'll know it worked", ai: true });
      else {
        if (f.solutionType === "product" && !f.under.solutions) out.unshift({ id: "plan-modules", label: "Work out its modules", hint: "Qalam AI asks, looks online, then proposes them", ai: true });
        push(brief);
      }
      push(ground.find, ground.look);
      break;
    case "test":
      if (f.suggested) out.push({ id: "pass-line", label: "Use the suggested pass line" });
      break;
    case "outcome": {
      const g = f.goal;
      if (!g) break;
      const find: NextStep | null = f.pages ? { id: "find-problems", label: "Find its problems", hint: g.behind ? "More of your problem pages that bear on it" : "Links your problem pages that bear on it", ai: true } : null;
      // A goal's extras are hidden in v0.1 (src/lab.ts): its problems found among the pages stay, and grounding it.
      const extras = lab("goals");
      // What was proposed for it before waits to be decided before it's asked for again.
      const asks = thin(f) || !!f.asking;
      const asking = asks ? asksHint(f) : null;
      // Break it down must add up to the goal's number, so its parts stay strict; it asks first like every draft.
      const parts: NextStep | null = !extras ? null : g.pending ? { id: "review-parts", label: `Review the ${plural(g.pending, "goal")} proposed under it`, hint: "From breaking it down" } : { id: "break-down", label: "Break it down", hint: asking ?? "Goals under it that make its number", ai: true, ...(asks ? { asks } : {}) };
      const drafted: NextStep | null = !extras ? null : g.drafted ? { id: "review-problems", label: `Review the ${plural(g.drafted, "problem")} drafted for it`, hint: "From drafting its problems" } : { id: "draft-problems", label: "Draft its problems", hint: asking ?? (g.behind ? "More problems that would move it" : "Problems that would move it, from your material"), ai: true, ...(asks ? { asks } : {}) };
      // The problem to focus on, found with them in the chat: it asks, looks on the web, then proposes problems under it.
      const focus: NextStep = { id: "focus", label: "Find the problem to focus on", hint: "Qalam AI asks you and looks on the web", ai: true };
      // What waits to be decided first; then the problem to focus on, then, while nothing is behind it, its problems (found among the pages when there are some, else drafted).
      const waiting = [g.pending ? parts : null, g.drafted ? drafted : null];
      const rest = [g.pending ? null : parts, find, g.drafted ? null : drafted];
      push(...waiting, focus, ground.look, brief, ...(g.behind ? rest : [rest[1], rest[2], rest[0]]), extras ? { id: "others", label: "What others aim for", hint: "Numbers others report · a minute or two", ai: true } : null, ground.watch, ground.file);
      if (g.job && extras) push({ id: "next-job", label: `Next: ${g.job}`, hint: "What we don't know yet" });
      break;
    }
  }
  return out.map((s) => {
    const why = s.ai ? blockedFor(f) : null;
    return why ? { ...s, blocked: why } : s;
  });
}

/** Why Qalam AI can't run a step for this card now (null: it can). */
function blockedFor(f: CardFacts): string | null {
  if (!f.ai) return "Qalam AI isn't ready here";
  if (f.reviewing) return "Accept or discard the proposals first";
  if (f.busyElsewhere) return "Qalam AI is on another card";
  return null;
}

/** One line on what a card rests on ("" when there's nothing to say). */
export function backingLine(f: CardFacts): string {
  if (f.kind === "outcome") {
    const behind = f.goal?.behind ? `${plural(f.goal.behind, "problem")} behind it` : "nothing behind it yet";
    return `${f.goal?.number ?? "No number yet"} · ${behind}`;
  }
  if (f.kind === "test") return "";
  const e = f.evidence;
  const tail = `${e.against ? ` · ${e.against} against` : ""}${f.feeds.length ? ` · watched in ${f.feeds.join(", ")}` : ""}`;
  if (e.quotes) return `Rests on ${backingWords(e.mix ?? { said: e.quotes })} from ${plural(e.sources, "source")}${tail}`;
  if (f.page?.quotes) return `Its page rests on ${backingWords(f.page.mix ?? { said: f.page.quotes })} from ${plural(f.page.sources, "source")}${tail}`;
  const alongside = [e.online ? `${plural(e.online, "post")} online` : "", e.read ? `${e.read} read elsewhere` : ""].filter(Boolean).join(" and ");
  if (e.ours && alongside) return `Your words, with ${alongside}${tail}`;
  if (e.ours) return `Only your words so far${tail}`;
  if (e.online) return `Only people online: ${plural(e.online, "post")}${tail}`;
  if (e.read) return `Only read elsewhere: ${e.read}${tail}`;
  return f.kind === "solution" ? `Rests on the problem above it${tail}` : `Nothing behind it yet${tail}`;
}
