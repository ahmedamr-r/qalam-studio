import { aiStatus, callAI, type AIDelta } from "@/ai/client";
import { interviewTurnCall, type CallContext } from "@/ai/discovery";
import { sanitizeTurn } from "@/asking/sanitize";
import type { AskTurn, AskingState } from "@/asking/types";
import { askingIn } from "@/asking/wire";
import { SAMPLE_DRAFT_RAW } from "@/ai/fixtures-discovery";
import type { InterviewAnswer } from "@/discovery/interview";
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

/**
 * A turn of the interview after the product interview's own questions (src/asking/), checked here as
 * the board's other calls are. Without AI, or for the sample, there's nothing more to ask.
 */
export async function runInterviewTurn(answers: InterviewAnswer[], s: AskingState, opts: CallOpts = {}): Promise<AskTurn> {
  if (await offline(opts)) return { questions: [], lookups: [], done: true, understood: [], terms: [], choices: [] };
  const b = { stage: "interview-turn" as const, answers, asking: askingIn(s, { said: "" }) };
  const { data } = await callAI<unknown>(PATH, b, opts.onProgress, opts.signal);
  return sanitizeTurn(data, interviewTurnCall(b).check, () => {});
}

/** The draft as the model wrote it (sanitized by the caller); `onDelta` sees it being written. `context`: what the organization already knows. */
export async function runDraft(answers: InterviewAnswer[], followUps: InterviewAnswer[], opts: CallOpts & { onDelta: (d: AIDelta) => void; context?: CallContext }): Promise<{ raw: unknown; sample: boolean; model?: string }> {
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
  const { data, model } = await callAI<unknown>(PATH, { stage: "draft", answers, ...(followUps.length ? { followUps } : {}), ...(opts.context ? { context: opts.context } : {}) }, opts.onProgress, opts.signal, undefined, opts.onDelta);
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
