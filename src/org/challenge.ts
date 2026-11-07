import { callAI } from "@/ai/client";
import type { ChallengeRun, CheckRequest } from "@/challenge/types";
import { orgJson, orgPath } from "./client";

/* Challenging proposals with the project's own evidence, from the window (server/org/challenge.ts). */

/** Check a round of proposals before its review opens: what code finds, worded by Qalam AI where there's evidence. */
export async function checkProposals(req: CheckRequest, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<ChallengeRun> {
  const { data } = await callAI<ChallengeRun>(await orgPath("/challenge"), req, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

/** The check kept with a review, when it's opened again (null: none). */
export const storedCheck = async (origin: string) => (await orgJson<{ run: ChallengeRun | null }>(`/challenge?origin=${encodeURIComponent(origin)}`)).run;

/** Keep a challenge, change it into their words, drop it (for the team), or none again. */
export const decideCheck = async (origin: string, id: string, state: "kept" | "changed" | "dropped" | null, words?: string) =>
  (await orgJson<{ run: ChallengeRun }>("/challenge", { method: "PUT", json: { origin, id, state, ...(words ? { words } : {}) } })).run;

/** The challenges kept on accepted proposals, onto the cards they became. */
export const carryChecks = async (origin: string, product: string | null, cards: { item: string; card: string }[]) =>
  (await orgJson<{ carried: number }>("/challenge/carry", { method: "POST", json: { origin, product, cards } })).carried;
