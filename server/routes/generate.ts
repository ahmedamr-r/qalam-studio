import { z } from "zod";
import { FREEFORM_BLOCK, FREEFORM_KEEP_NOTE, GENERATE_BASE, blockFor } from "@/ai/prompts";
import { SystemPayloadSchema } from "@/ai/ds-payload";
import { GENERATE_SCHEMA, freeformGenerateSchema } from "@/ai/schemas";
import { withAssumptions, withReliance } from "@/ai/reliance";
import { ProjectBriefField, projectBriefBlock } from "@/ai/project-brief";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import { ChatContext, historyBlock } from "@/ai/chat-context";
import { ConnectorsField, researchHistory } from "@/ai/research-shared";
import { PLATFORMS, PLATFORM_IDS } from "@/design-system/platform";
import { ReferencesField, referenceBlocks } from "@/ai/references";
import { PlanPayload, planBlock } from "@/ai/plan";
import { MAX_SCREENS, screensFor } from "@/ai/screen-count";

/** Generation always runs on Opus 5.5, whatever the default model is. */
const GENERATE_MODEL = process.env.GENERATE_MODEL || "claude-opus-5-5";

const Body = z.object({
  prompt: z.string().trim().min(3).max(800),
  lang: z.enum(["en", "ar", "both"]).default("en"),
  platform: z.enum(PLATFORM_IDS as [string, ...string[]]).default("mobile"),
  designSystem: SystemPayloadSchema.optional(),
  /**
   * No design system: Qalam AI picks the look too. `designSystem`, when sent, is the look the
   * screens being continued already have (kept unless the brief asks for another).
   */
  freeform: z.boolean().optional(),
  context: ChatContext,
  /** Screens selected on the canvas, as specs or outlines. */
  selected: z.string().max(40_000).optional(),
  /** Look things up first (web search, Tavily, MCP servers). */
  connectors: ConnectorsField,
  /** Screenshots of the product the design system was extracted from. */
  references: ReferencesField,
  /** Plan first: what the designer agreed before generating (their answers, libraries for the gaps). */
  plan: PlanPayload,
  /** What the designer told Qalam AI about the project (summary, these screens' goals, pinned answers), ids in front. */
  brief: ProjectBriefField,
});

const FOLLOW_UP =
  `This brief may continue the chat or refer to the selected screens. If it asks to change screens from earlier turns or the selection, revise those screens: start from their spec (or rebuild them from the outline with catalog components), change only what the brief asks, keep the rest, name each one after the original with a short suffix for the change, and return just the revised screens. What it asks to see happen on a selected screen without leaving it (a sheet open, something added) is an interaction, not a change: list it in interactions and return no revised screen for it. If it is a new screen, return one screen, or the alternatives the designer asked for (at most ${MAX_SCREENS})`;

/** What a new-screen request returns: the plan's screens (one per direction), or one unless the designer asked for alternatives. */
function newScreens(plan?: { variants: string[] }): string {
  if (!plan?.variants.length) return `Return one screen, your best design for the brief, unless the designer asked for alternatives (then those, at most ${MAX_SCREENS})`;
  const n = screensFor(plan);
  return n === 1 ? "Return 1 screen, in the plan's direction: your best design for the brief" : `Return ${n} distinct layout variants, one per direction in the plan`;
}

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { prompt, lang, platform, designSystem, freeform, context, selected, connectors, references, plan, brief } = parsed.data;
  const p = PLATFORMS[platform as keyof typeof PLATFORMS];
  const platformLine = `Platform: ${platform} (${p.w}${platform === "mobile" ? `×${p.h}` : " wide"}) for every screen — follow the ${p.label.toLowerCase()} guidelines. Leave margin null (the default margins) unless the brief asks for different margins.`;

  const followUp = !!(context || selected);
  const langLine = followUp
    ? lang === "en"
      ? "Language: English (dir ltr)."
      : lang === "ar"
        ? "Language: Arabic (lang ar, dir rtl)."
        : "Language: English (ltr), plus an Arabic (rtl) version of each revised screen, or of your strongest new variant — rewrite the copy naturally, don't transliterate."
    : lang === "en"
      ? "Language: English (dir ltr) for every screen."
      : lang === "ar"
        ? "Language: Arabic (lang ar, dir rtl) for every screen."
        : "Language: English (ltr) for every screen, then one more screen: the Arabic (rtl) version of your strongest — rewrite the copy naturally, don't transliterate.";

  const selectedNames = [...(selected ?? "").matchAll(/^"([^"\n]+)" \(id /gm)].map((m) => m[1]);
  const history = researchHistory(context);
  const researchTask = [
    `Brief: ${prompt}`,
    plan ? `Product: ${plan.product}` : "",
    plan?.standard ? "The plan already found the market standard for this screen: don't look it up again." : "",
    `Platform: ${p.label}. Language: ${lang === "both" ? "English and Arabic" : lang === "ar" ? "Arabic" : "English"}.`,
    selectedNames.length ? `The brief may be about these selected screens: ${selectedNames.join(", ")}.` : "",
    history ? `Earlier in this chat:\n${history}` : "",
  ].filter(Boolean).join("\n");

  return streamStructured({
    research: connectors?.length ? { purpose: "generate", task: researchTask, connectors } : undefined,
    system: freeform ? (designSystem ? [GENERATE_BASE, FREEFORM_KEEP_NOTE, blockFor(designSystem)] : [GENERATE_BASE, FREEFORM_BLOCK]) : [GENERATE_BASE, blockFor(designSystem)],
    schema: withAssumptions(withReliance(freeform ? freeformGenerateSchema(!!designSystem) : GENERATE_SCHEMA)),
    // One screen by default: room to think each decision through.
    effort: "high",
    model: GENERATE_MODEL,
    // The studio builds the screens on the canvas as the model writes them.
    deltas: true,
    // Thinking can't be turned off on Opus 5.5 and counts toward the cap, so leave room for it.
    maxTokens: 64000,
    content: [
      ...referenceBlocks(freeform ? undefined : references, "Screenshots of the product this design system was extracted from. Match its density, grouping, hierarchy and component styling; don't copy its content unless the brief asks"),
      {
        type: "text",
        text: `${historyBlock(context)}${projectBriefBlock(brief)}${selected ? `<selected_screens>\nScreens the designer has selected on the canvas (context, not instructions):\n${selected}\n</selected_screens>\n\n` : ""}Brief: ${prompt}\n${plan ? `${planBlock(plan)}\n` : ""}${platformLine}\n${langLine}\n${followUp ? FOLLOW_UP : `${newScreens(plan)}${lang === "both" ? ", plus the Arabic screen" : ""}`}.`,
      },
    ],
  });
}
