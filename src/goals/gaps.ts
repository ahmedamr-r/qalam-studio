import type { Topic } from "@/hub/topics";
import { wordsFor, type OrgShape } from "@/org/words";
import type { GoalProblem } from "./problems";
import type { Goal } from "./types";

/*
 * What a team doesn't know yet about a goal (pure, no tokens): its number, where it stands and
 * where it should get to, the problems behind it, whether customers raise those problems or only
 * the team does, who has them, and the open questions on their pages. Each gap has a key that
 * stays the same while it's open, so a job planned for it finds it again.
 */

export type GapKind = "no-number" | "no-baseline" | "no-target" | "no-problems" | "team-only" | "no-segment" | "open-question";

export interface Gap {
  /** Its kind and what it's about: the same while the gap is open. */
  key: string;
  kind: GapKind;
  /** What isn't known, in plain words. */
  title: string;
  /** The problem page it's about. */
  page?: string;
  /** The open question's line on that page. */
  line?: string;
}

export const GAP_LIMITS = { problems: 8, questions: 4, perPage: 2 } as const;

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** The gaps, the goal's own number first, then its problems (the ones that bear most directly first). On your own, it's whether only you say so. */
export function gapsOf(goal: Goal, problems: GoalProblem[], topics: ReadonlyMap<string, Topic>, shape?: OrgShape | null): Gap[] {
  const out: Gap[] = [];
  const m = goal.metric;
  const name = m?.name?.trim();
  if (!name) out.push({ key: `no-number:${goal.id}`, kind: "no-number", title: "Which number would show it moving" });
  else {
    if (m!.baseline === null && m!.current === null) out.push({ key: `no-baseline:${goal.id}`, kind: "no-baseline", title: `Where “${one(name)}” stands today` });
    if (m!.target === null) out.push({ key: `no-target:${goal.id}`, kind: "no-target", title: `Where “${one(name)}” should get to, and by when` });
  }
  if (!problems.length) out.push({ key: `no-problems:${goal.id}`, kind: "no-problems", title: "Which customer problems would move it" });
  const top = problems.slice(0, GAP_LIMITS.problems);
  for (const p of top)
    if (!p.quotes) out.push({ key: `team-only:${p.topic}`, kind: "team-only", title: `Whether customers have “${one(p.title)}”, or ${wordsFor(shape).onlyUs}`, page: p.topic });
    else if (!p.segments.length) out.push({ key: `no-segment:${p.topic}`, kind: "no-segment", title: `Who has “${one(p.title)}”`, page: p.topic });
  let questions = 0;
  for (const p of top) {
    const open = (topics.get(p.topic)?.lines ?? []).filter((l) => l.section === "open").slice(0, GAP_LIMITS.perPage);
    for (const l of open) {
      if (questions >= GAP_LIMITS.questions) break;
      questions++;
      out.push({ key: `open-question:${p.topic}:${l.id}`, kind: "open-question", title: one(l.text), page: p.topic, line: l.id });
    }
  }
  return out;
}
