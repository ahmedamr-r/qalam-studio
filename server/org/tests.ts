import { nanoid } from "nanoid";
import { structured } from "@/ai/server";
import { testsCall } from "@/ai/tests";
import { sanitizeTests, testsMaterial, type TestsDrafted, type TestsInput } from "@/discovery/tests";
import type { OrgStore } from "./store";

/**
 * Drafting a solution's tests, in the core (src/discovery/tests.ts): the board sends the solution
 * card, the problem it's under and the goal, with the words each rests on; one call proposes its
 * riskiest assumptions and a test of the riskiest, and code keeps what it can stand behind. The
 * board takes them as proposals to review.
 */

/** A card as the board sends it: its words, and the words it rests on. */
export interface TestsCardWords {
  title: string;
  evidence: { text: string; piece?: string; sourceTitle?: string; kind: string }[];
}

export interface TestsRequest {
  solution: TestsCardWords & { description: string; assumptions: string[]; tests: string[] };
  problem: TestsCardWords | null;
  goal: { title: string; metric: string | null } | null;
}

export async function draftTests(store: OrgStore, req: TestsRequest, emit?: (label: string) => void): Promise<TestsDrafted> {
  emit?.("Reading what the solution rests on");
  const pieces: TestsInput["pieces"] = [];
  for (const e of [...req.solution.evidence, ...(req.problem?.evidence ?? [])]) {
    const ref = e.piece ?? `card:${pieces.length}`;
    if (pieces.some((p) => p.ref === ref || p.text === e.text)) continue;
    pieces.push({ ref, text: e.text, label: e.sourceTitle ?? (e.kind === "quote" ? "A source" : "The team's words"), evidence: e.kind === "quote" });
  }
  const m = testsMaterial({ solution: req.solution, problem: req.problem ? { title: req.problem.title } : null, goal: req.goal, pieces });
  emit?.("Qalam AI is drafting its tests");
  const { data, model } = await structured<unknown>(testsCall(m));
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const drafted = sanitizeTests(data, m, { id: () => nanoid(10) }, (why, item) => dropped.push({ why, item }));
  // The call's trace: what it was sent (by id), what it answered, what code kept and left out, and why.
  await store
    .putTrace({ id: nanoid(10), projectId: "tests", kind: "tests", at: now, ...(model ? { model } : {}), sent: { pieces: [...m.pieces].map(([ref, p]) => ({ ref, piece: p.ref })) }, answer: data, kept: drafted.assumptions.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  return drafted;
}
