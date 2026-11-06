import { callAI } from "@/ai/client";
import type { Drafted, SolutionsFile } from "@/discovery/solutions";
import type { OstEvidence } from "@/discovery/types";
import { orgFetch, orgGet, orgPath } from "./client";

/*
 * Drafted solutions, from the window (server/org/solutions.ts): one call for a problem's page or a
 * card on a board, a page's drafts as they're kept, and a person's decision about one.
 */

/** A card asking, with or without a page of its own. */
export interface DraftCard {
  title: string;
  evidence: Pick<OstEvidence, "text" | "piece" | "sourceId" | "sourceTitle" | "kind" | "online">[];
  children: { title: string; kind: "solution" | "test" }[];
}

export type SolutionsView = SolutionsFile & { quotes: Drafted["quotes"] };

/** The person's words a draft rests on, by id: their answers' source, and quotes found on their words. */
export interface DraftWords {
  answers?: string;
  found?: string[];
  /** What was read on the web while asking: others' words, never evidence. */
  looks?: { text: string; url?: string; title?: string; quote?: string }[];
}

export async function draftSolutions(req: { topic?: string | null; card?: DraftCard } & DraftWords, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<Drafted> {
  const body = { ...(req.topic ? { topic: req.topic } : {}), ...(req.card ? { card: req.card } : {}), ...(req.answers ? { answers: req.answers } : {}), ...(req.found?.length ? { found: req.found } : {}), ...(req.looks?.length ? { looks: req.looks } : {}) };
  const { data } = await callAI<Drafted>(await orgPath("/solutions"), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

/** A page's drafts as they're kept (null: none drafted yet). */
export const solutionsOf = async (topic: string): Promise<SolutionsView | null> => ((await orgGet<SolutionsView | null>(`/topics/${encodeURIComponent(topic)}/solutions`))?.value ?? null);

/** A person took a draft (it's on a board now) or left it. */
export const decideDraft = (topic: string, draft: string, decision: "accepted" | "discarded") => orgFetch(`/topics/${encodeURIComponent(topic)}/solutions/${encodeURIComponent(draft)}`, { method: "PUT", json: { decision } }).then(() => {});
