import { z } from "zod";
import { RESTYLE_BASE, blockFor } from "@/ai/prompts";
import { RESTYLE_SCHEMA } from "@/ai/ds-schemas";
import { SystemPayloadSchema } from "@/ai/ds-payload";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import type Anthropic from "@anthropic-ai/sdk";
import { ReferencesField, referenceBlocks } from "@/ai/references";

export const maxDuration = 300;

const Body = z
  .object({
    /** The screen's catalog spec, when it was built from one. */
    spec: z.unknown().optional(),
    /** Frames without a spec: an outline and a render to rebuild from. */
    outline: z.string().max(20_000).optional(),
    image: z.string().max(4_000_000).optional(),
    targets: z.array(z.string().max(80)).max(40).default([]),
    targetNames: z.array(z.string().max(120)).max(40).default([]),
    designSystem: SystemPayloadSchema,
    /** Screenshots of the product the target system was extracted from. */
    references: ReferencesField,
  })
  .refine((b) => b.spec !== undefined || b.outline, "Send the screen spec or an outline.")
  .refine((b) => JSON.stringify(b.spec ?? null).length < 60_000, "Screen spec is too large.");

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { spec, outline, image, targets, targetNames, designSystem, references } = parsed.data;

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [...referenceBlocks(references, "Screenshots of the product the target design system was extracted from — the look to restyle towards")];
  if (image) {
    if (references?.length) content.push({ type: "text", text: "The screen as it is now:" });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: image } });
  }
  const scope = targets.length
    ? `Restyle only these parts: ${targets.map((t, i) => `${t}${targetNames[i] ? ` (${targetNames[i]})` : ""}`).join(", ")}.`
    : "Restyle the whole screen.";
  content.push({
    type: "text",
    text:
      spec !== undefined
        ? `${scope}\n\nCurrent screen spec:\n${JSON.stringify(spec)}`
        : `This screen was drawn by hand, so there is no spec. Rebuild it from catalog components in the target system, keeping its content (render above).\n\nOutline (id · type · name · tokens · text):\n${outline}`,
  });
  return streamStructured({ system: [RESTYLE_BASE, blockFor(designSystem)], schema: RESTYLE_SCHEMA, effort: "medium", content, model: process.env.RESTYLE_MODEL || undefined });
}
