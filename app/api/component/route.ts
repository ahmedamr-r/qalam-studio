import { COMPONENT_BASE, ComponentBody, componentContent, componentSchema, existingNames } from "@/ai/component-import";
import { blockFor } from "@/ai/prompts";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

export const maxDuration = 300;

/** Reading a screenshot precisely: Opus 5.5 (like extraction), whatever the default model is. */
const COMPONENT_MODEL = process.env.COMPONENT_MODEL || process.env.DS_EXTRACT_MODEL || "claude-opus-5-5";

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = ComponentBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;
  if (b.stage !== "build" && !b.current) return jsonError(400, "bad_input", "Checking or revising needs the component as it stands.");
  return streamStructured({
    system: [COMPONENT_BASE, blockFor(b.designSystem)],
    schema: componentSchema(b.stage),
    // The first read decides the structure; comparing two pictures of it is quicker work.
    effort: b.stage === "build" ? "high" : "medium",
    model: COMPONENT_MODEL,
    maxTokens: 32000,
    // The designer reads Qalam AI's first sentence while the rest is written (the check runs quietly).
    deltas: b.stage !== "check",
    content: componentContent(b, existingNames(b.designSystem)),
  });
}
