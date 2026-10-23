import { aiStatus, callAI } from "@/ai/client";
import { SAMPLE_READ_RAW, SAMPLE_REVIEW_RAW, sampleNudgeRaw } from "@/ai/fixtures-interview";
import { fontCandidates } from "@/design-system/interview/fonts";
import type { Direction, KnobId, Knobs, ReadBack } from "@/design-system/interview/knobs";
import { sanitizeDirections, sanitizeNudge, sanitizeRead, sanitizeReview, type BriefAnswer, type FollowUp, type NudgeResult, type ReviewResult } from "@/design-system/interview/sanitize";
import { axisValues, baselineKnobs, codeDirections, lowConfidenceAxes } from "@/design-system/interview/table";

/**
 * The interview's calls to Qalam AI, each sanitized before anything is built from it. Without AI
 * (or for the sample brief) they answer from the recorded sample and the code's own directions.
 */

export interface CallOpts {
  /** Answer from the recorded sample, whatever the AI status. */
  sample?: boolean;
  signal?: AbortSignal;
  onProgress?: (tokens: number) => void;
}

const PATH = "/api/interview";

/** Use the sample? (asked for, or AI isn't set up here) */
async function offline(opts: CallOpts) {
  return opts.sample || !(await aiStatus()).ai;
}

export async function runRead(
  answers: BriefAnswer[],
  followUps: BriefAnswer[] | undefined,
  round: 0 | 1,
  facts: { platform?: ReadBack["platform"]; arabic?: boolean },
  opts: CallOpts = {},
): Promise<{ read: ReadBack; followUps: FollowUp[]; sample: boolean }> {
  const sample = await offline(opts);
  const all = [...answers, ...(followUps ?? [])];
  const raw = sample ? SAMPLE_READ_RAW : (await callAI<unknown>(PATH, { stage: "read", round, answers, ...(followUps?.length ? { followUps } : {}) }, opts.onProgress, opts.signal)).data;
  const { read, followUps: asks } = sanitizeRead(raw, all, round);
  // What the designer picked outright wins over the model's reading of it.
  const next: ReadBack = {
    ...read,
    ...(facts.platform ? { platform: facts.platform } : {}),
    ...(facts.arabic === undefined ? {} : { scripts: facts.arabic ? ["latin", "arabic"] : ["latin"] }),
  };
  return { read: next, followUps: sample ? [] : asks, sample };
}

export async function runDirections(read: ReadBack, opts: CallOpts = {}): Promise<{ list: Direction[]; recommended: number }> {
  const baseline = baselineKnobs(read);
  if (await offline(opts)) return { list: codeDirections(read), recommended: 0 };
  const candidates = fontCandidates(axisValues(read));
  const { data } = await callAI<unknown>(PATH, { stage: "directions", read, baseline, lowAxes: lowConfidenceAxes(read), candidates }, opts.onProgress, opts.signal);
  const { directions, recommended } = sanitizeDirections(data, { read, baseline, candidates });
  return { list: directions, recommended };
}

export async function runNudge(text: string, read: ReadBack, knobs: Knobs, locks: KnobId[], opts: CallOpts = {}): Promise<NudgeResult> {
  const candidates = fontCandidates(axisValues(read));
  const ctx = { knobs, locks, candidates };
  if (await offline(opts)) return sanitizeNudge(sampleNudgeRaw(text), ctx);
  const { data } = await callAI<unknown>(PATH, { stage: "nudge", text, read, knobs, locks, candidates }, opts.onProgress, opts.signal);
  return sanitizeNudge(data, ctx);
}

export async function runReview(image: string, read: ReadBack, knobs: Knobs, locks: KnobId[], opts: CallOpts = {}): Promise<ReviewResult> {
  const candidates = fontCandidates(axisValues(read));
  const ctx = { read, knobs, locks, candidates };
  if (await offline(opts)) return sanitizeReview(SAMPLE_REVIEW_RAW, ctx);
  const { data } = await callAI<unknown>(PATH, { stage: "review", image, read, knobs, locks }, opts.onProgress, opts.signal);
  return sanitizeReview(data, ctx);
}
