/**
 * What Qalam AI didn't know when it made a design (pure): the brief's answers a screen is missing,
 * measured by code, and what the model says it guessed in their place. Each gap names where the
 * designer's answer goes, so "Tell it" saves it to the brief for the next request.
 */
import { screenBriefFor } from "@/doc/brief";
import type { BriefTopic, Doc, ProjectBrief } from "@/doc/schema";

export type GapField = "goal" | "firstNotice" | "primaryAction" | "summary";

export interface Gap {
  topic: BriefTopic;
  question: string;
  /** Where the answer is saved: a screen's goal field, the summary, or (none) a new answer. */
  field?: GapField;
  screenId?: string;
  /** What Qalam AI guessed instead. */
  guess?: string;
}

const QUESTION: Record<BriefTopic, string> = {
  goal: "What is this screen for?",
  audience: "Who uses it?",
  problem: "What problem does the project solve?",
  "first-notice": "What must people notice first?",
  "primary-action": "What should people do here?",
  "success-metric": "How will you know it works?",
  constraints: "Anything it must or mustn't do?",
  other: "Anything else it should know?",
};

const FIELD: Partial<Record<BriefTopic, GapField>> = { goal: "goal", "first-notice": "firstNotice", "primary-action": "primaryAction" };

const MAX_GAPS = 5;

/**
 * Gaps for a design: its guesses first (each where its answer would go), then the brief fields its
 * screen still lacks, then the project's (summary, audience). A gap answered since is left out.
 */
export function knowledgeGaps(brief: ProjectBrief | undefined, doc: Pick<Doc, "nodes" | "roots" | "brief">, screenId: string | undefined, assumed: { topic: string; guess: string }[] = []): Gap[] {
  const s = screenId ? screenBriefFor(brief, doc as Doc, screenId) : null;
  const known = (topic: BriefTopic): boolean => {
    const f = FIELD[topic];
    if (f && screenId) return !!s?.[f as "goal" | "firstNotice" | "primaryAction"];
    if (topic === "problem") return !!brief?.summary.trim();
    return !!brief?.answers.some((a) => a.topic === topic && (!screenId || !a.screenIds.length || a.screenIds.includes(screenId)));
  };
  const at = (topic: BriefTopic): Pick<Gap, "field" | "screenId"> => {
    const f = FIELD[topic];
    if (f && screenId) return { field: f, screenId };
    if (topic === "problem") return { field: "summary" };
    return screenId ? { screenId } : {};
  };
  const out: Gap[] = [];
  const seen = new Set<BriefTopic>();
  for (const a of assumed) {
    const topic = (a.topic in QUESTION ? a.topic : "other") as BriefTopic;
    if (topic !== "other" && (seen.has(topic) || known(topic))) continue;
    seen.add(topic);
    out.push({ topic, question: topic === "other" ? QUESTION.other : QUESTION[topic], guess: a.guess, ...at(topic) });
  }
  const missing: BriefTopic[] = screenId ? ["goal", "first-notice", "primary-action", "audience", "problem"] : ["audience", "problem"];
  for (const topic of missing) {
    if (seen.has(topic) || known(topic)) continue;
    seen.add(topic);
    out.push({ topic, question: QUESTION[topic], ...at(topic) });
  }
  return out.slice(0, MAX_GAPS);
}
