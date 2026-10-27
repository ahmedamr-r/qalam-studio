import { z } from "zod";
import { TRANSLATE_BASE } from "@/ai/prompts";
import { TRANSLATE_SCHEMA } from "@/ai/schemas";
import { aiConfigured, jsonError, rateLimited, streamStructured } from "@/ai/server";

/** Translation is quick work for the default model; TRANSLATE_MODEL overrides it. */
const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || undefined;

const LANG = { en: "English", ar: "Arabic" } as const;

const Body = z.object({
  to: z.enum(["en", "ar"]),
  /** Each distinct string once, with where it's used and its length budget (found by the studio). */
  units: z
    .array(
      z.object({
        id: z.string().max(12),
        text: z.string().max(600),
        where: z.string().max(200),
        maxChars: z.number().int().min(1).max(2000).optional(),
        /** The last translation, which the studio measured as too long for maxChars. */
        previous: z.string().max(1200).optional(),
      }),
    )
    .min(1)
    .max(400),
  screens: z.array(z.string().max(120)).max(8),
  /** What the product is (the Knowledge hub's summary), for the right terms. */
  product: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  if (!aiConfigured()) return jsonError(501, "no_key", "AI is not configured on this deployment.");
  if (rateLimited(req)) return jsonError(429, "rate_limited", "Too many requests, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "bad_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const { to, units, screens, product } = parsed.data;
  const lines = units.map((u) => JSON.stringify({ id: u.id, where: u.where, ...(u.maxChars ? { maxChars: u.maxChars } : {}), text: u.text, ...(u.previous ? { previous: u.previous, previousLength: u.previous.length } : {}) }));
  const text = [
    `Translate into ${LANG[to]}. ${screens.length ? `Screens: ${screens.map((s) => `"${s}"`).join(", ")}.` : ""}`,
    product ? `About the product (from the designer's knowledge hub): ${product}` : "",
    `Strings, in the order they appear:\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return streamStructured({ system: TRANSLATE_BASE, schema: TRANSLATE_SCHEMA, effort: "low", model: TRANSLATE_MODEL, maxTokens: 16000, content: [{ type: "text", text }] });
}
