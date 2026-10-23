import { z } from "zod";
import { EXTRACT_BASE, blockFor } from "@/ai/prompts";
import { SystemPayloadSchema } from "@/ai/ds-payload";
import { EXTRACT_SCHEMA } from "@/ai/schemas";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import type Anthropic from "@anthropic-ai/sdk";
import { ChatContext, historyBlock } from "@/ai/chat-context";

export const maxDuration = 300;

const Raw = z.object({
  id: z.string().max(20),
  value: z.string().max(80),
  kind: z.string().max(20),
  count: z.number(),
  contexts: z.array(z.string().max(160)).max(12),
});

const Body = z.object({
  mode: z.enum(["css", "json", "image"]),
  raw: z.array(Raw).max(160).default([]),
  image: z
    .object({ mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]), data: z.string().max(4_000_000), width: z.number().int().positive().max(10_000).optional(), height: z.number().int().positive().max(10_000).optional() })
    .optional(),
  palette: z.array(z.string().max(12)).max(16).default([]),
  decisions: z
    .array(z.object({ value: z.string().max(80), intent: z.string().max(120), suggested: z.string().max(80), final: z.string().max(80) }))
    .max(40)
    .default([]),
  context: ChatContext,
  /** The library suggestions are matched against and named for; the rebuild is drawn with it. */
  designSystem: SystemPayloadSchema.optional(),
});

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { mode, raw, image, palette, decisions, context, designSystem } = parsed.data;
  if (mode === "image" && !image) return jsonError(400, "bad_input", "Missing image");

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });

  const lines: string[] = [];
  if (context) lines.push(historyBlock(context).trimEnd());
  if (mode === "image") {
    lines.push(`Source: a screenshot of an existing app screen (above)${image?.width && image.height ? `, shown to you at ${image.width}×${image.height} px (crop boxes are in these pixels)` : ""}.`);
    if (palette.length) lines.push(`Dominant colours measured from the pixels (use these exact hexes where they match): ${palette.join(", ")}`);
    lines.push("Extract its tokens and rebuild it from catalog components.");
  } else {
    lines.push(`Source: raw values parsed from a ${mode === "css" ? "CSS file" : "Figma/Tokens Studio JSON export"}. Each has an id, value, kind, count and usage contexts:`);
    lines.push(JSON.stringify(raw));
  }
  if (decisions.length) {
    lines.push("Designer decisions on earlier suggestions (follow their naming style):");
    for (const d of decisions)
      lines.push(d.suggested === d.final ? `- approved "${d.final}" for ${d.value} (${d.intent})` : `- renamed "${d.suggested}" → "${d.final}" for ${d.value} (${d.intent})`);
  }
  content.push({ type: "text", text: lines.join("\n") });

  return streamStructured({ system: [EXTRACT_BASE, blockFor(designSystem)], schema: EXTRACT_SCHEMA, effort: "high", content });
}
