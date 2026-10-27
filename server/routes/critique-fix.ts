import { FIX_BASE, FixBody, buildFixContent } from "@/ai/critique-fix";
import { blockFor } from "@/ai/prompts";
import { RESTYLE_SCHEMA } from "@/ai/ds-schemas";
import { withReliance } from "@/ai/reliance";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = FixBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const body = parsed.data;
  return streamStructured({
    system: [FIX_BASE, blockFor(body.designSystem)],
    schema: withReliance(RESTYLE_SCHEMA),
    effort: "medium",
    content: buildFixContent(body),
    model: process.env.RESTYLE_MODEL || undefined,
  });
}
