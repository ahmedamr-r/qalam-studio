import { PROPOSE_SYSTEM, PrototypeBody, partsContent, partsSchema, partsSystem, proposeContent, proposeSchema } from "@/ai/prototype";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

export const maxDuration = 300;

/** The prototyping agent runs on the generation model (Opus 5.5 by default). */
const PROTOTYPE_MODEL = process.env.PROTOTYPE_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/**
 * The prototyping agent: "propose" picks, orders and words what code found can be built on a
 * screen; "parts" writes the sheets, bars, dialogs and toasts the picked steps need.
 */
export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = PrototypeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;
  if (b.stage === "propose") {
    return streamStructured({
      system: PROPOSE_SYSTEM,
      schema: proposeSchema(
        b.candidates.map((c) => c.id),
        b.ask?.trim() ? (b.layers ?? []).map((l) => l.id) : [],
      ),
      effort: "medium",
      model: PROTOTYPE_MODEL,
      maxTokens: 16000,
      content: [{ type: "text", text: proposeContent(b) }],
    });
  }
  return streamStructured({
    system: partsSystem(),
    schema: partsSchema(b.parts.map((p) => p.candidate)),
    effort: "medium",
    model: PROTOTYPE_MODEL,
    maxTokens: 32000,
    content: [{ type: "text", text: partsContent(b) }],
  });
}
