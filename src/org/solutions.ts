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
  evidence: Pick<OstEvidence, "text" | "piece" | "sourceId" | "sourceTitle" | "kind">[];
  children: { title: string; kind: "solution" | "test" }[];
}

export type SolutionsView = SolutionsFile & { quotes: Drafted["quotes"] };

export async function draftSolutions(req: { topic?: string | null; card?: DraftCard }, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<Drafted> {
  const body = { ...(req.topic ? { topic: req.topic } : {}), ...(req.card ? { card: req.card } : {}) };
  const { data } = await callAI<Drafted>(await orgPath("/solutions"), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

/** A page's drafts as they're kept (null: none drafted yet). */
export const solutionsOf = async (topic: string): Promise<SolutionsView | null> => ((await orgGet<SolutionsView | null>(`/topics/${encodeURIComponent(topic)}/solutions`))?.value ?? null);

/** A person took a draft (it's on a board now) or left it. */
export const decideDraft = (topic: string, draft: string, decision: "accepted" | "discarded") => orgFetch(`/topics/${encodeURIComponent(topic)}/solutions/${encodeURIComponent(draft)}`, { method: "PUT", json: { decision } }).then(() => {});
