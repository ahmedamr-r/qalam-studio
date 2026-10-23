/** Request body of /api/critique and how it becomes the user turn (shared with tests). */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { BRIEF_TOPICS } from "@/doc/brief";
import { MAX_QUESTIONS } from "./critique";
import { ConnectorsField, researchBlock } from "./research-shared";

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

/** Total screenshot budget (base64 chars); Vercel caps request bodies at 4.5 MB. */
export const IMAGE_BUDGET = 3_500_000;

const Topic = z.enum(BRIEF_TOPICS);

export const CritiqueBody = z
  .object({
    screens: z
      .array(z.object({ id: z.string().max(40), name: z.string().max(120), outline: z.string().max(8000), image: z.string().max(2_000_000).optional() }))
      .min(1)
      .max(4),
    lint: z.array(z.object({ nodeId: z.string().max(40), rule: z.string().max(40), severity: z.string().max(10), message: z.string().max(200) })).max(60),
    brief: z.object({
      summary: z.string().max(2010),
      answers: z.array(z.object({ topic: Topic, question: z.string().max(300), answer: z.string().max(610), screens: z.array(z.string().max(120)).max(4) })).max(50),
      screens: z
        .array(
          z.object({
            id: z.string().max(40),
            name: z.string().max(120),
            goal: z.string().max(410),
            firstNotice: z.string().max(410),
            primaryAction: z.string().max(410),
            inheritedFrom: z.string().max(120),
            lastCritique: z.string().max(1000),
          }),
        )
        .max(4),
      otherScreens: z.array(z.object({ name: z.string().max(120), goal: z.string().max(310) })).max(12),
    }),
    transcript: z.array(z.object({ topic: Topic, question: z.string().max(400), answer: z.string().max(610).nullable() })).max(MAX_QUESTIONS + 2),
    /** Issues already shown this session, so follow-up turns don't repeat them. */
    reported: z.array(z.string().max(320)).max(20),
    mustConclude: z.boolean(),
    /** First turn: look things up first (web search, Tavily, MCP servers). */
    connectors: ConnectorsField,
    /** Later turns: the notes the first turn's research found. */
    research: z.string().max(8000).optional(),
  })
  .refine((b) => b.screens.reduce((n, s) => n + (s.image?.length ?? 0), 0) <= IMAGE_BUDGET, "The screenshots are too large to send.");

export type CritiqueRequest = z.infer<typeof CritiqueBody>;

/**
 * Screens first (label + image), then outlines and lint (stable across the session, so the
 * prefix can be cached), then the Knowledge hub and transcript, which change every turn.
 */
export function buildCritiqueContent(b: CritiqueRequest, opts: { cache: boolean }): Block[] {
  const content: Block[] = [];
  for (const s of b.screens) {
    content.push({ type: "text", text: `Screen ${s.id} "${s.name}"${s.image ? "" : " (no image: over the size budget, use the outline)"}` });
    if (s.image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: s.image } });
  }
  content.push({
    type: "text",
    text: `Screen outlines (id · type · name · tokens · text · size):\n${b.screens.map((s) => s.outline).join("\n\n")}\n\nLinter findings (already measured):\n${b.lint.length ? JSON.stringify(b.lint) : "none"}`,
    ...(opts.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  });
  if (b.research) content.push({ type: "text", text: researchBlock(b.research) });
  const turn = b.transcript.length;
  const conclude = b.mustConclude || turn >= MAX_QUESTIONS;
  const transcript = turn
    ? b.transcript.map((t, i) => `Q${i + 1} [${t.topic}]: ${t.question}\nA${i + 1}: ${t.answer ?? "(skipped)"}`).join("\n")
    : "(first turn: critique the screens)";
  content.push({
    type: "text",
    text: [
      `Knowledge hub:\n${JSON.stringify(b.brief)}`,
      `This session so far:\n${transcript}`,
      ...(b.reported.length ? [`Issues you already reported this session (don't repeat or rephrase them):\n${b.reported.map((r) => `- ${r}`).join("\n")}`] : []),
      conclude ? "mustConclude: true. Don't ask another question; give your final verdict now." : `Questions asked so far: ${turn} of at most ${MAX_QUESTIONS}.`,
    ].join("\n\n"),
  });
  return content;
}

/** What the research step is told about a critique. */
export function critiqueResearchTask(b: CritiqueRequest): string {
  return [
    `Critique of ${b.screens.length > 1 ? `${b.screens.length} screens` : "a screen"}: ${b.screens.map((s) => `"${s.name}"`).join(", ")}.`,
    b.brief.summary ? `About the project: ${b.brief.summary}` : "",
    ...b.brief.screens.filter((s) => s.goal).map((s) => `Goal of "${s.name}": ${s.goal}`),
    `What's on the screens (layer outlines, abridged):\n${b.screens.map((s) => s.outline.slice(0, 1500)).join("\n\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
