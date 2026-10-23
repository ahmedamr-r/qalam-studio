import {
  DIRECTIONS_SCHEMA,
  DIRECTIONS_SYSTEM,
  InterviewBody,
  NUDGE_SCHEMA,
  NUDGE_SYSTEM,
  READ_SCHEMA,
  READ_SYSTEM,
  REVIEW_SCHEMA,
  REVIEW_SYSTEM,
  directionsContent,
  nudgeContent,
  readContent,
  reviewContent,
} from "@/ai/interview";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

export const maxDuration = 300;

/** The interview shapes a whole design system: it runs on the generation model (Opus 5.5 by default). */
const INTERVIEW_MODEL = process.env.INTERVIEW_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/**
 * The design-system interview: read the brand brief, propose three directions, turn a nudge into
 * knob changes, review a rendered screen. Answers come back as fixed options; the client
 * sanitizes them and code computes the tokens.
 */
export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = InterviewBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const b = parsed.data;
  const call = { model: INTERVIEW_MODEL };
  switch (b.stage) {
    case "read":
      return streamStructured({ ...call, system: READ_SYSTEM, schema: READ_SCHEMA, effort: "medium", maxTokens: 16000, content: [{ type: "text", text: readContent(b) }] });
    case "directions":
      return streamStructured({ ...call, system: DIRECTIONS_SYSTEM, schema: DIRECTIONS_SCHEMA, effort: "medium", maxTokens: 24000, content: [{ type: "text", text: directionsContent(b) }] });
    case "nudge":
      return streamStructured({ ...call, system: NUDGE_SYSTEM, schema: NUDGE_SCHEMA, effort: "low", maxTokens: 8000, content: [{ type: "text", text: nudgeContent(b) }] });
    case "review":
      return streamStructured({ ...call, system: REVIEW_SYSTEM, schema: REVIEW_SCHEMA, effort: "medium", maxTokens: 16000, content: reviewContent(b) });
  }
}
