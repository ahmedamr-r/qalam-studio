import type { EvidenceSummary } from "./evidence";
import type { OstKind } from "./types";
import type { Strength } from "@/hub/needs";

/*
 * What to do next with a card on the canvas (pure, no tokens): the steps that fit it, best first,
 * worked out from what's known about it, and one line on what it rests on. Qalam AI runs only when
 * a step is picked (src/ui/discovery/next.ts).
 */

export type StepId = "draft-solutions" | "draft-tests" | "design-this" | "page" | "pass-line" | "next-job";

export interface NextStep {
  id: StepId;
  label: string;
  /** A few words on what it does. */
  hint?: string;
  /** Qalam AI runs it. */
  ai?: boolean;
  /** Why it can't run now. */
  blocked?: string;
}

/** What's known about a card, from what the canvas has loaded. */
export interface CardFacts {
  kind: OstKind;
  evidence: EvidenceSummary;
  /** A problem's page, and how much it rests on. */
  page: { topic: string; strength: Strength; quotes: number; sources: number } | null;
  /** What's under it already. */
  under: { solutions: number; tests: number };
  /** A goal's number in a line (null: none yet), the problems behind it and its next job. */
  goal?: { id: string; number: string | null; behind: number; job: string | null };
  /** A test whose pass line Qalam AI suggested and nobody has set. */
  suggested?: boolean;
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

/** The steps that fit a card, best first. */
export function nextSteps(f: CardFacts): NextStep[] {
  const out: NextStep[] = [];
  switch (f.kind) {
    case "opportunity":
      out.push({ id: "draft-solutions", label: "Draft solutions", hint: f.under.solutions ? "More ways to solve it, each with a test" : "Ways to solve it, each with a test", ai: true });
      if (f.page) out.push({ id: "page", label: "Its page", hint: "Everything known about it" });
      break;
    case "solution":
      out.push({ id: "draft-tests", label: "Draft its tests", hint: f.under.tests ? "More of what it assumes, and a test" : "What it assumes, and a test of the riskiest", ai: true });
      out.push({ id: "design-this", label: "Design this", hint: "Screens built on what it rests on" });
      break;
    case "test":
      if (f.suggested) out.push({ id: "pass-line", label: "Use the suggested pass line" });
      break;
    case "outcome":
      if (f.goal?.job) out.push({ id: "next-job", label: `Next: ${f.goal.job}`, hint: "What we don't know yet" });
      break;
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
  const against = e.against ? ` · ${e.against} against` : "";
  if (e.quotes) return `Rests on ${plural(e.quotes, "quote")} from ${plural(e.sources, "source")}${against}`;
  if (f.page?.quotes) return `Its page rests on ${plural(f.page.quotes, "quote")} from ${plural(f.page.sources, "source")}${against}`;
  if (e.ours) return `Only your words so far${against}`;
  if (e.online) return `Only people online: ${plural(e.online, "post")}${against}`;
  return f.kind === "solution" ? "Rests on the problem above it" : `Nothing behind it yet${against}`;
}
