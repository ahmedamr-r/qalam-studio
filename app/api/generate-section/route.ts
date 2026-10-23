import { z } from "zod";
import { GENERATE_BASE, blockFor } from "@/ai/prompts";
import { SystemPayloadSchema } from "@/ai/ds-payload";
import { sectionSchema } from "@/ai/schemas";
import { withAssumptions, withReliance } from "@/ai/reliance";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import { ChatContext, historyBlock } from "@/ai/chat-context";
import { ConnectorsField } from "@/ai/research-shared";
import { ReferencesField, referenceBlocks } from "@/ai/references";

export const maxDuration = 300;

/** Same model as Generate: this is generation, scoped to part of a screen. */
const GENERATE_MODEL = process.env.GENERATE_MODEL || "claude-opus-5-5";

const Body = z.object({
  prompt: z.string().trim().min(3).max(800),
  /** The whole screen, for context: only the targeted parts may change. */
  spec: z.record(z.string(), z.unknown()),
  targets: z
    .array(z.object({ path: z.string().regex(/^(header|sidebar|hero|body|footer)\.\d+(\.children\.\d+)*$/), component: z.string().max(60), spec: z.unknown() }))
    .min(1)
    .max(8),
  designSystem: SystemPayloadSchema.optional(),
  context: ChatContext,
  connectors: ConnectorsField,
  references: ReferencesField,
});

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { prompt, spec, targets, designSystem, context, connectors, references } = parsed.data;
  if (JSON.stringify(spec).length > 60_000) return jsonError(400, "bad_input", "Screen spec is too large.");
  const lang = spec.lang === "ar" ? "Arabic (lang ar, dir rtl)" : "English (dir ltr)";
  const parts = targets.map((t) => `- ${t.path} (${t.component}):\n${JSON.stringify(t.spec)}`).join("\n");

  return streamStructured({
    research: connectors?.length ? { purpose: "generate", task: `Brief for part of the screen "${String(spec.name ?? "")}" (${targets.map((t) => t.component).join(", ")}): ${prompt}`, connectors } : undefined,
    system: [GENERATE_BASE, blockFor(designSystem)],
    schema: withAssumptions(withReliance(sectionSchema(targets.map((t) => t.path)))),
    effort: "medium",
    model: GENERATE_MODEL,
    maxTokens: 32000,
    deltas: true,
    content: [
      ...referenceBlocks(references, "Screenshots of the product this design system was extracted from. Match its density, grouping and component styling"),
      {
        type: "text",
        text:
          `${historyBlock(context)}<screen>\nThe screen being edited, as a spec (context: only the parts listed below may change):\n${JSON.stringify(spec)}\n</screen>\n\n` +
          `Edit only these parts of the screen, by spec path:\n${parts}\n\n` +
          `Brief: ${prompt}\n\n` +
          `Return one edit per listed path: the component(s) that replace it. Change only what the brief asks and keep the rest of each part (copy, props, variants) as it is. ` +
          `Keep it consistent with the rest of the screen, which stays exactly as it is. Language: ${lang}. ` +
          `Use one component per path unless the brief asks to add something beside it, split it or remove it.`,
      },
    ],
  });
}
