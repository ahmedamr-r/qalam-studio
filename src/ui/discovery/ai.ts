import { aiStatus, callAI, type AIDelta } from "@/ai/client";
import { SAMPLE_DRAFT_RAW, SAMPLE_FOLLOWUPS_RAW } from "@/ai/fixtures-discovery";
import type { FollowUp } from "@/design-system/interview/sanitize";
import type { InterviewAnswer } from "@/discovery/interview";
import { sanitizeFollowups } from "@/discovery/sanitize";
import { replayStream } from "../ai/replay";

/**
 * The board's calls to Qalam AI. Without AI (or for the sample) they answer from the recorded
 * sample, replayed as if it were being written, so the board fills in the same way.
 */

export interface CallOpts {
  sample?: boolean;
  signal?: AbortSignal;
  onProgress?: (tokens: number) => void;
}

const PATH = "/api/discovery";

/** Use the recorded sample? (asked for, or AI isn't set up here) */
export async function offline(opts: CallOpts = {}) {
  return !!opts.sample || !(await aiStatus()).ai;
}

export async function runFollowups(answers: InterviewAnswer[], opts: CallOpts = {}): Promise<FollowUp[]> {
  if (await offline(opts)) return sanitizeFollowups(SAMPLE_FOLLOWUPS_RAW);
  const { data } = await callAI<unknown>(PATH, { stage: "followups", answers }, opts.onProgress, opts.signal);
  return sanitizeFollowups(data);
}

/** The draft as the model wrote it (sanitized by the caller); `onDelta` sees it being written. */
export async function runDraft(answers: InterviewAnswer[], followUps: InterviewAnswer[], opts: CallOpts & { onDelta: (d: AIDelta) => void }): Promise<{ raw: unknown; sample: boolean; model?: string }> {
  if (await offline(opts)) {
    await replayStream(SAMPLE_DRAFT_RAW, {
      onDelta: opts.onDelta,
      onProgress: opts.onProgress,
      signal: opts.signal,
      ms: 7000,
      thinking: ["Reading what customers told you…", "Choosing an outcome you can move…"],
    });
    return { raw: SAMPLE_DRAFT_RAW, sample: true };
  }
  const { data, model } = await callAI<unknown>(PATH, { stage: "draft", answers, ...(followUps.length ? { followUps } : {}) }, opts.onProgress, opts.signal, undefined, opts.onDelta);
  return { raw: data, sample: false, model };
}

/**
 * A brain dump's call (read, a round's answers, placing it). The sample replays its recording as
 * if it were being written; without AI there's nothing to read the builder's own text with, so
 * the caller checks `offline` first.
 */
export async function runDump(body: unknown, recorded: unknown, opts: CallOpts & { onDelta?: (d: AIDelta) => void; ms?: number; thinking?: string[] }): Promise<{ raw: unknown; sample: boolean; model?: string }> {
  if (opts.sample) {
    await replayStream(recorded, { onDelta: opts.onDelta ?? (() => {}), onProgress: opts.onProgress, signal: opts.signal, ms: opts.ms ?? 3000, thinking: opts.thinking });
    return { raw: recorded, sample: true };
  }
  const { data, model } = await callAI<unknown>(PATH, body, opts.onProgress, opts.signal, undefined, opts.onDelta);
  return { raw: data, sample: false, model };
}
