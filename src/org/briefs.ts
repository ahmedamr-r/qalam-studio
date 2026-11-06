import { callAI } from "@/ai/client";
import type { AskTurn } from "@/asking/types";
import type { AskingInT } from "@/asking/wire";
import type { BriefMeta } from "@/discovery/brief";
import { orgFetch, orgJson, orgPath } from "./client";

/** A turn of the interview before a brief is written (server/org/briefs.ts, askBrief): the chat keeps the conversation and sends it each time. */
export async function askBriefTurn(request: unknown, asking: AskingInT, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<AskTurn> {
  const { data } = await callAI<AskTurn>(await orgPath("/briefs/ask"), { request, asking }, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

/** A card's brief, in the window: the core writes it (server/org/briefs.ts) and announces each change. */

export const listBriefs = () => orgJson<{ briefs: BriefMeta[] }>("/briefs").then((r) => r.briefs);
export const getBrief = (id: string) => orgJson<{ brief: { meta: BriefMeta; body: string } }>(`/briefs/${encodeURIComponent(id)}`).then((r) => r.brief);
export const writeCardBrief = (req: unknown, signal?: AbortSignal) => orgJson<{ brief: BriefMeta }>("/briefs", { method: "POST", json: req, ...(signal ? { signal } : {}) }).then((r) => r.brief);
export const removeBrief = (id: string) => orgFetch(`/briefs/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => {});
