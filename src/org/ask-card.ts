import { callAI } from "@/ai/client";
import type { AskTurn } from "@/asking/types";
import type { AskingInT } from "@/asking/wire";
import { orgPath } from "./client";

/* A turn of the interview before a card's draft, from the window (server/org/ask-card.ts): the chat keeps the conversation and sends it each time. */

export interface AskCardReq {
  card: { kind: "outcome" | "opportunity" | "solution" | "test"; title: string; description: string; above: string[] };
  step: "draft-solutions" | "break-down" | "draft-problems" | "draft-tests";
  /** What lookups in their project found, under the ids the turns cite. */
  found: { id: string; text: string; source: string; whose: string }[];
  asking: AskingInT;
}

export async function askCardTurn(b: AskCardReq, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<AskTurn & { role: string | null }> {
  const { data } = await callAI<AskTurn & { role: string | null }>(await orgPath("/ask/card"), b, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}
