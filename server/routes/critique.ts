import { CRITIQUE_SCHEMA, CRITIQUE_SYSTEM } from "@/ai/critique";
import { CritiqueBody, buildCritiqueContent, critiqueResearchTask } from "@/ai/critique-request";
import { aiConfigured, BACKEND, jsonError, rateLimited, streamStructured } from "@/ai/server";

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = CritiqueBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const body = parsed.data;
  const first = body.transcript.length === 0;
  return streamStructured({
    // Research runs once, on the first turn; later turns resend its notes.
    research: first && body.connectors?.length ? { purpose: "critique", task: critiqueResearchTask(body), connectors: body.connectors } : undefined,
    system: CRITIQUE_SYSTEM,
    schema: CRITIQUE_SCHEMA,
    effort: first ? "medium" : "low",
    // cache_control on user blocks is only exercised on the API path; the CLI gets plain blocks.
    content: buildCritiqueContent(body, { cache: BACKEND === "api" }),
    maxTokens: first ? 16000 : 8000,
  });
}
