import { callAI } from "@/ai/client";
import type { TestsDrafted } from "@/discovery/tests";
import type { OstEvidence } from "@/discovery/types";
import { orgPath } from "./client";

/*
 * A solution card's tests drafted, from the window (server/org/tests.ts): the solution, the problem
 * it's under and the goal go with the words each rests on; what comes back is what code kept.
 */

type Words = { title: string; evidence: Pick<OstEvidence, "text" | "piece" | "sourceTitle" | "kind">[] };

export interface TestsAsk {
  solution: Words & { description: string; assumptions: string[]; tests: string[] };
  problem: Words | null;
  goal: { title: string; metric: string | null } | null;
}

export async function draftTests(ask: TestsAsk, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<TestsDrafted> {
  const { data } = await callAI<TestsDrafted>(await orgPath("/tests"), ask, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}
