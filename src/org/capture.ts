import { callAI } from "@/ai/client";
import type { CaptureResult } from "@/discovery/capture";
import type { Ingested } from "@/discovery/ingest/core";
import { orgPath } from "./client";

/**
 * Add material to the organization (server/capture.ts): read in this window (a paste, a file, a
 * page), handed to the core, which keeps it as a source, picks out what customers said, files it
 * into the topic pages and proposes where it fits on the boards. `onActivity` hears each step.
 */
export async function captureIngested(ingested: Ingested, o: { product?: string | null; onActivity?: (label: string) => void; signal?: AbortSignal } = {}): Promise<CaptureResult> {
  const { data } = await callAI<CaptureResult>(await orgPath("/capture"), { ingested, ...(o.product ? { product: o.product } : {}) }, undefined, o.signal, (e) => {
    if (e.type === "activity") o.onActivity?.(e.label);
  });
  return data;
}
