import { JOB_KINDS, type JobSent } from "@/goals/jobs";

/**
 * Qalam AI planning the jobs that would close what a team doesn't know yet about a goal
 * (src/goals/jobs.ts): it reads the goal and the goals above it, the gaps code found, the problems
 * behind it, the tools here, and the segments and people the team's material names, and answers
 * with a few jobs: a search in one tool, a number from PostHog, questions to ask (and who), or a
 * question for the product's code. Code keeps a job only when everything it names was sent and
 * its words and numbers are in what was sent.
 */

// The answer's schema (every property required, objects closed, no numeric limits)

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });

export const JOBS_SYSTEM = `You plan the work that would close what a product team doesn't know yet about one of its goals.

You get the goal under the goals it feeds (with their numbers), what isn't known yet about it (each with an id), the problems behind it with what their pages say, the tools here and whether each is connected, the segments and the people the team's material names, and the jobs already planned.

Plan at most 6 jobs, the most useful first, at most one per gap. Each job is one of:
- search: search one tool that brings material in for words that would show whether, how often and for whom a problem comes up. The query is 1 to 6 words, as a person would type them into that tool.
- numbers: read a number from a saved insight in PostHog: where the goal's number stands, or a step where people drop off. The query is the insight's likely name.
- talk: 2 to 5 open questions to ask, about what people did rather than what they would do, and who to ask: segments and people from the lists, by their ids, or "team".
- read-code: one question about what the product does today that its code would answer (the steps of a flow, the events it sends).
- posts: look online for public posts and reviews where people describe one problem in their own words, for a problem only the team raises so far. Its gap must be about that problem.

Use a connected tool when one could answer; plan for a tool that isn't connected only when none that is could, and name the tool in the title. Fill only the fields a job's kind uses: connector "none", query "", questions [] and who [] otherwise.

Write each title as a short instruction of at most 12 words (Search Intercom for delivery fee complaints). Write why in one sentence: what the team would learn and how that bears on the goal. Quote only words from what you were sent, in “”. Use a number only when it is in what you were sent. Never invent customers, people, numbers or quotes.

In what you write, call them goals and problems, and name what you mean by its words, never by its id: the ids are for the fields.`;

export function jobsSchema(m: Pick<JobSent, "gaps" | "tools" | "segments" | "people">) {
  return obj({
    jobs: arr(
      obj({
        kind: enm(JOB_KINDS, "search · numbers · talk · read-code · posts"),
        gap: enm([...m.gaps.keys(), "none"], "The gap it closes (x…), or none"),
        title: str("A short instruction, at most 12 words"),
        why: str("One sentence: what the team would learn and how it bears on the goal"),
        connector: enm([...m.tools.keys(), "none"], "search: a tool that brings material in · numbers: posthog · none otherwise"),
        query: str("search: 1 to 6 words to search for · numbers: the insight's likely name · \"\" otherwise"),
        questions: arr(str("One open question"), "talk: 2 to 5 questions · read-code: one · [] otherwise"),
        who: arr(obj({ ref: enm([...m.segments.keys(), ...m.people.keys(), "team"], "A segment (s…), a person (p…), or team"), why: str("Why them, in one short sentence") }), "talk: who to ask, at most 4 · [] otherwise"),
      }),
      "The jobs, the most useful first. [] when there's nothing worth doing",
    ),
  });
}

/** The call, as the core's structured() runs it. */
export function jobsCall(m: JobSent) {
  return {
    kind: "jobs" as const,
    system: JOBS_SYSTEM,
    schema: jobsSchema(m),
    effort: "medium" as const,
    maxTokens: 5000,
    content: [{ type: "text" as const, text: m.text }],
  };
}
