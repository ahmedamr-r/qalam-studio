import { callAI } from "@/ai/client";
import type { FocusLook } from "@/goals/focus";
import type { OutlineCard, PlanDraft, PlanLook, PlanNext, PlanRound } from "@/space/plan";
import { orgPath } from "./client";

/* Working something out as a plan, from the window (server/org/plan.ts): the chat keeps the conversation and sends it with each call. */

export interface PlanAsk {
  said: string;
  outline: OutlineCard[];
  rounds: PlanRound[];
  looks: PlanLook[];
}

async function run<T>(path: string, body: unknown, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<T> {
  const { data } = await callAI<T>(await orgPath(path), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

export const planRoute = (said: string, signal?: AbortSignal) => run<{ route: "ask" | "plan" }>("/plan/route", { said }, undefined, signal);
export const planLook = (b: PlanAsk & { query?: string }, onActivity?: (label: string) => void, signal?: AbortSignal) => run<FocusLook>("/plan/look", b, onActivity, signal);
export const planAhead = (b: PlanAsk, onActivity?: (label: string) => void, signal?: AbortSignal) => run<PlanNext>("/plan/next", b, onActivity, signal);
export const planPropose = (b: PlanAsk, onActivity?: (label: string) => void, signal?: AbortSignal) => run<PlanDraft>("/plan/propose", b, onActivity, signal);
