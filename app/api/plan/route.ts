import { z } from "zod";
import { FOLLOWUP_SCHEMA, PLAN_SCHEMA, PlanRounds, PlanSoFar, followupBlock, followupSystem, planSystem, standardTask } from "@/ai/plan";
import { aiConfigured, jsonError, rateLimited, streamResearch, streamStructured } from "@/ai/server";
import { ChatContext, historyBlock } from "@/ai/chat-context";
import { ConnectorsField, researchHistory } from "@/ai/research-shared";
import { PLATFORMS, PLATFORM_IDS, inferPlatform } from "@/design-system/platform";

export const maxDuration = 300;

/** Planning decides what Generate builds: it runs on the generation model (Opus 5.5 by default). */
const PLAN_MODEL = process.env.PLAN_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/** What the plan knows about the look: the design system, or that Generate picks one (worth a question on feel or brand colour). */
const systemLine = (b: { systemName?: string; freeform?: boolean }) =>
  b.freeform ? "\nNo design system: Qalam AI also picks the look (colour, type, corners, depth) when it generates, so how the product should feel, or its brand colour, is worth asking when the brief doesn't say." : b.systemName ? `\nDesign system: ${b.systemName}.` : "";

const Body = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("plan"),
    prompt: z.string().trim().min(3).max(800),
    lang: z.enum(["en", "ar", "both"]).default("en"),
    /** What the designer picked in the composer; "auto" leaves it to the plan. */
    platform: z.enum(["auto", ...PLATFORM_IDS]).default("auto"),
    systemName: z.string().max(80).optional(),
    /** No design system: Generate picks the look too. */
    freeform: z.boolean().optional(),
    context: ChatContext,
    /** The composer's connectors: the market-standard lookup uses them, with web search. */
    connectors: ConnectorsField,
  }),
  z.object({
    /** A bucket was answered: read the answers, revise the plan, ask again only if needed. */
    stage: z.literal("followup"),
    prompt: z.string().trim().min(3).max(800),
    lang: z.enum(["en", "ar", "both"]).default("en"),
    platform: z.enum(PLATFORM_IDS as [string, ...string[]]),
    systemName: z.string().max(80).optional(),
    /** No design system: Generate picks the look too. */
    freeform: z.boolean().optional(),
    context: ChatContext,
    plan: PlanSoFar,
    rounds: PlanRounds,
    /** The studio asks no more buckets after this one. */
    last: z.boolean().default(false),
  }),
  z.object({
    /** Look up open-source libraries for the parts the catalog can't express. */
    stage: z.literal("libraries"),
    product: z.string().max(200),
    gaps: z.array(z.object({ need: z.string().max(200), closest: z.string().max(200), search: z.string().max(200) })).min(1).max(3),
    connectors: ConnectorsField,
  }),
]);

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;

  if (b.stage === "libraries") {
    // Web search always runs for this (the designer asked for libraries); Tavily joins when it's on.
    const connectors = ["web", ...(b.connectors ?? []).filter((id) => id !== "web" && /tavily/i.test(id))];
    const task = [
      `Product: ${b.product}`,
      "Parts of the design the component catalog can't express, each with a suggested search:",
      ...b.gaps.map((g, i) => `${i + 1}. ${g.need} (closest in the catalog: ${g.closest}). Search: "${g.search}"`),
    ].join("\n");
    return streamResearch({ purpose: "libraries", task, connectors });
  }

  const lang = b.lang === "both" ? "English and Arabic" : b.lang === "ar" ? "Arabic" : "English";

  if (b.stage === "followup")
    return streamStructured({
      system: followupSystem(),
      schema: FOLLOWUP_SCHEMA,
      effort: "medium",
      model: PLAN_MODEL,
      maxTokens: 24000,
      content: [
        {
          type: "text",
          text: `${historyBlock(b.context)}Brief: ${b.prompt}\nPlatform: ${PLATFORMS[b.platform as keyof typeof PLATFORMS].label}. Language of the screens: ${lang}.${systemLine(b)}\n\n${followupBlock(b.plan, b.rounds, b.last)}`,
        },
      ],
    });
  const platformLine =
    b.platform === "auto"
      ? `Platform: not chosen. Pick the one that fits the product (keywords in the brief suggest ${PLATFORMS[inferPlatform(b.prompt)].label}, which may be wrong).`
      : `Platform: ${PLATFORMS[b.platform as keyof typeof PLATFORMS].label}, chosen by the designer: keep it.`;
  // Market standard first: how the leading products design this screen, looked up before planning.
  // Web search always joins (the plan is built on it); the step skips it when the brief spells out the whole screen.
  const research = {
    purpose: "standard" as const,
    task: standardTask({
      prompt: b.prompt,
      platform: b.platform === "auto" ? `not chosen yet (the brief suggests ${PLATFORMS[inferPlatform(b.prompt)].label})` : PLATFORMS[b.platform as keyof typeof PLATFORMS].label,
      lang,
      history: researchHistory(b.context),
    }),
    connectors: ["web", ...(b.connectors ?? []).filter((id) => id !== "web")],
  };
  return streamStructured({
    research,
    system: planSystem(),
    schema: PLAN_SCHEMA,
    effort: "medium",
    model: PLAN_MODEL,
    // Thinking counts toward the cap on Opus 5.5.
    maxTokens: 24000,
    content: [
      {
        type: "text",
        text: `${historyBlock(b.context)}Brief: ${b.prompt}\n${platformLine}\nLanguage of the screens: ${lang}.${systemLine(b)}\n\nWork out the market standard for this screen, then plan it and write your first bucket of questions for the designer.`,
      },
    ],
  });
}
