import { z } from "zod";
import { REPAIR_BASE, blockFor } from "@/ai/prompts";
import { SystemPayloadSchema } from "@/ai/ds-payload";
import { REPAIR_SCHEMA } from "@/ai/schemas";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

export const maxDuration = 300;

/** Repairs are mechanical (shorter copy, a valid icon, one primary action): the default model at low effort. */
const REPAIR_MODEL = process.env.REPAIR_MODEL || undefined;

const Body = z.object({
  screens: z
    .array(
      z.object({
        index: z.number().int().min(0).max(8),
        spec: z.unknown(),
        issues: z.array(z.object({ path: z.string().max(120), rule: z.string().max(40), message: z.string().max(400) })).min(1).max(40),
      }),
    )
    .min(1)
    .max(4),
  designSystem: SystemPayloadSchema.optional(),
});

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { screens, designSystem } = parsed.data;
  if (screens.some((s) => JSON.stringify(s.spec ?? null).length > 60_000)) return jsonError(400, "bad_input", "Screen spec is too large.");
  const text = screens
    .map((s) => `Screen ${s.index}:\n${JSON.stringify(s.spec)}\nIssues:\n${s.issues.map((i) => `- ${i.path || "(whole screen)"} · ${i.rule}: ${i.message}`).join("\n")}`)
    .join("\n\n");
  return streamStructured({
    system: [REPAIR_BASE, blockFor(designSystem)],
    schema: REPAIR_SCHEMA,
    // Mechanical fixes: low effort keeps the self-check quick.
    effort: "low",
    model: REPAIR_MODEL,
    maxTokens: 48000,
    content: [{ type: "text", text }],
  });
}
