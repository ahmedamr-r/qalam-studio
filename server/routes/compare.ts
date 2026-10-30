import { CompareBody, compareCall } from "@/ai/compare";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";
import { DISCOVERY_MODEL } from "./discovery";

/**
 * Which need to target: Qalam AI argues for one of the needs under an outcome, from what code
 * counted about each and the team's ratings. The client checks the argument against what it cites
 * (src/discovery/compare.ts sanitizeCompare) before showing it.
 */
export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = CompareBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  return streamStructured({ model: DISCOVERY_MODEL, ...compareCall(parsed.data) });
}
