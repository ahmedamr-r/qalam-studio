import { z } from "zod";
import { AUDIT_BASE, blockFor } from "@/ai/prompts";
import { SystemPayloadSchema } from "@/ai/ds-payload";
import { AUDIT_SCHEMA } from "@/ai/schemas";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import type Anthropic from "@anthropic-ai/sdk";
import { ChatContext, historyBlock } from "@/ai/chat-context";

export const maxDuration = 300;

const Body = z.object({
  findings: z
    .array(
      z.object({
        id: z.string().max(20),
        nodeId: z.string().max(40),
        nodeName: z.string().max(80),
        rule: z.string().max(40),
        severity: z.string().max(10),
        message: z.string().max(400),
        wcag: z.string().max(60).optional(),
        replaceWith: z.string().max(60).optional(),
      }),
    )
    .max(120),
  outline: z.string().max(20000),
  image: z.string().max(4_000_000).optional(),
  designSystem: SystemPayloadSchema.optional(),
  /** What the designer asked the review to focus on. */
  request: z.string().max(800).optional(),
  context: ChatContext,
});

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { findings, outline, image, designSystem, request, context } = parsed.data;

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: image } });
  content.push({
    type: "text",
    text: `${historyBlock(context)}Frame outline (id · type · name · tokens · text):\n${outline}\n\nLinter findings:\n${JSON.stringify(findings)}${request ? `\n\nThe designer asks: ${request}\nFocus the summary and issues on that.` : ""}`,
  });
  return streamStructured({ system: [AUDIT_BASE, blockFor(designSystem)], schema: AUDIT_SCHEMA, effort: "low", content, maxTokens: 16000 });
}
