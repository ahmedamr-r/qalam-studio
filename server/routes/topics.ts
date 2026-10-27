import { TOPICS_KNOWLEDGE, TOPICS_SYSTEM, TopicsBody, filingIds, filingSchema, topicsContent } from "@/ai/topics";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import { DISCOVERY_MODEL } from "./discovery";

/**
 * Filing new material into the organization's topic pages: what customers said in a source (or the
 * team's words in a brain dump) goes on the pages of the needs, segments and products it's about.
 * The client checks every line against the pieces it cites before anything is written
 * (src/hub/topics.ts sanitizeFiling), then the organization's store applies it.
 */
export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = TopicsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;
  return streamStructured({
    model: DISCOVERY_MODEL,
    system: b.context?.ids.length ? `${TOPICS_SYSTEM}\n\n${TOPICS_KNOWLEDGE}` : TOPICS_SYSTEM,
    schema: filingSchema(filingIds(b)),
    effort: "medium",
    maxTokens: 20000,
    content: [{ type: "text", text: topicsContent(b) }],
  });
}
