import { callAI } from "@/ai/client";
import type { AskTurn } from "@/asking/types";
import type { AskingInT } from "@/asking/wire";
import type { FocusLook } from "@/goals/focus";
import type { OutlineCard, PlanDraft, PlanKept, PlanLook, PlanRound } from "@/space/plan";
import type { BusinessLine } from "@/business/types";
import type { PlaybookId } from "@/consult/playbooks.gen";
import type { Level, Situation } from "@/consult/situation";
import { orgPath } from "./client";

/* Working something out as a plan, from the window (server/org/plan.ts): the chat keeps the conversation and sends it with each call. */

export interface PlanAsk {
  said: string;
  outline: OutlineCard[];
  /** A plan's rounds from before the interview (answers as words). */
  rounds: PlanRound[];
  looks: PlanLook[];
  /** The interview so far (src/asking/wire.ts). */
  asking?: AskingInT;
  /** Pieces a lookup in their project found: what a card may rest on. */
  found?: string[];
  /** What their own evidence said against what was proposed before, which they kept: proposing again goes by it. */
  kept?: PlanKept[];
  /** Worked out with a consultant (server/org/consult.ts): how much they know, who's asking, the playbook in use. */
  mode?: "consult";
  consult?: { level?: Level; situation?: Situation; playbook?: PlaybookId; fixes?: true };
  /** What a look at their screens found that isn't on the canvas, by look and finding: the core reads its words from the look kept. */
  seen?: { review: string; key: string }[];
}

/** A consultant's turn: the interview's, with who's asking as read, the playbook a turn picked, and the lines it noted on the business page. */
export type ConsultTurn = AskTurn & { situation?: Situation; picked?: PlaybookId; noted?: BusinessLine[] };

async function run<T>(path: string, body: unknown, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<T> {
  const { data } = await callAI<T>(await orgPath(path), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

export const planRoute = (said: string, signal?: AbortSignal) => run<{ route: "ask" | "plan" }>("/plan/route", { said }, undefined, signal);
export const planLook = (b: PlanAsk & { query?: string }, onActivity?: (label: string) => void, signal?: AbortSignal) => run<FocusLook>("/plan/look", b, onActivity, signal);
/** One turn of the interview, as code kept it. */
export const planAhead = (b: PlanAsk, onActivity?: (label: string) => void, signal?: AbortSignal) => run<ConsultTurn>("/plan/next", b, onActivity, signal);
export const planPropose = (b: PlanAsk, onActivity?: (label: string) => void, signal?: AbortSignal) => run<PlanDraft>("/plan/propose", b, onActivity, signal);
