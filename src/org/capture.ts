import { callAI } from "@/ai/client";
import type { CaptureResult } from "@/discovery/capture";
import type { Ingested } from "@/discovery/ingest/core";
import { orgPath } from "./client";

/** What linking new material to the goals did (server/org/goals.ts). */
export interface LinkedNow {
  added: number;
  kept: number;
  removed: number;
  none: string;
}

/**
 * Add material to the organization (server/capture.ts): read in this window (a paste, a file, a
 * page), handed to the core, which keeps it as a source, picks out what customers said, files it
 * into the topic pages and proposes where it fits on the boards. `onActivity` hears each step.
 * `job`: notes from a job that was handed over; the core keeps them on the job and links what they
 * say to the goals at once.
 */
export async function captureIngested(ingested: Ingested, o: { product?: string | null; job?: string; own?: boolean; onActivity?: (label: string) => void; signal?: AbortSignal } = {}): Promise<CaptureResult & { linked?: LinkedNow | null }> {
  // `own`: the person's own thinking, read as what they believe rather than as what customers said.
  const { data } = await callAI<CaptureResult & { linked?: LinkedNow | null }>(await orgPath("/capture"), { ingested, ...(o.product ? { product: o.product } : {}), ...(o.job ? { job: o.job } : {}), ...(o.own ? { own: true } : {}) }, undefined, o.signal, (e) => {
    if (e.type === "activity") o.onActivity?.(e.label);
  });
  return data;
}
