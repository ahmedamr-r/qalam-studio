import { z } from "zod";
import type { SttParams } from "./types";

/*
 * What a transcription is asked for, checked where it crosses a boundary (the request header to
 * the local engine, a job stored in the browser): the same shape as SttParams, with limits.
 */

export const LANGS = ["ar", "en"] as const;
export const DIALECTS = ["egyptian", "gulf", "levantine", "msa", "maghrebi", "other"] as const;
export const PROVIDERS = ["local", "elevenlabs", "soniox", "captions"] as const;

/** The most speakers a recording may be split into (an interview, a small group). */
export const MAX_SPEAKERS = 8;
/** The longest recording, in seconds (5 hours). */
export const MAX_SECONDS = 5 * 3600;

export const SttParamsSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    engine: z.string().max(80).optional(),
    spoken: z.enum(LANGS),
    dialect: z.enum(DIALECTS).optional(),
    speakers: z.object({ min: z.number().int().min(1).max(MAX_SPEAKERS), max: z.number().int().min(1).max(MAX_SPEAKERS) }),
    keyterms: z.array(z.string().trim().min(1).max(60)).max(100),
    durationSec: z.number().min(0).max(MAX_SECONDS),
    region: z.enum(["us", "eu"]).optional(),
  })
  .refine((p) => p.speakers.min <= p.speakers.max, { message: "At least as many speakers as the fewest", path: ["speakers"] });

/** Params as asked (unknown input), or null when they aren't valid. */
export function parseSttParams(raw: unknown): SttParams | null {
  const r = SttParamsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

// The schema and the type describe the same thing.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same: Same<z.infer<typeof SttParamsSchema>, SttParams> = true;
void same;
