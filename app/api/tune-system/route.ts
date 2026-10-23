import { TUNE_SCHEMA, TUNE_SYSTEM, TuneBody, buildTuneContent, tuneResearchTask } from "@/ai/tune";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

export const maxDuration = 300;

/** Tuning changes the system every later screen is built with: it runs on the generation model (Opus 5.5 by default). */
const TUNE_MODEL = process.env.TUNE_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = TuneBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { connectors } = parsed.data;
  return streamStructured({
    research: connectors?.length ? { purpose: "tune", task: tuneResearchTask(parsed.data), connectors } : undefined,
    system: TUNE_SYSTEM,
    schema: TUNE_SCHEMA,
    effort: "high",
    model: TUNE_MODEL,
    // Thinking counts toward the cap on Opus 5.5.
    maxTokens: 48000,
    content: buildTuneContent(parsed.data),
  });
}
