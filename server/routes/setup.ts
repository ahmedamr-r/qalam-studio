import { SetupBody, setupCall } from "@/ai/setup";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

/**
 * Setting an organization up from a brain dump about it: read it (what Qalam AI took from it, its
 * pieces, pushback, a round of questions), read each round of answers, then propose the
 * organization's About and its products. The client checks every piece and line against what was
 * sent (src/org/setup.ts) before anything is written.
 */
export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = SetupBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  return streamStructured(setupCall(parsed.data));
}
