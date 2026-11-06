import type { PlanQuestion } from "@/ai/plan";
import type { ScanPlan } from "@/space/chat";
import type { ScanAudience } from "@/scan/plan";
import type { BriefAsked, BriefMeta } from "@/discovery/brief";
import type { ShareProblem } from "@/scan/share";
import type { ScanKnown, ScanRequest, ScanSession, ScanTarget } from "@/scan/session";
import type { ScanSaid, ScanSteer } from "@/scan/steer";
import { NOT_READ, type FirstRead } from "@/scan/input";
import { callAI } from "@/ai/client";
import type { AskTurn } from "@/asking/types";
import type { AskingInT } from "@/asking/wire";
import { orgFetch, orgJson, orgPath } from "./client";

/** A turn of the interview before what to build first (server/org/scan-plan.ts, askScanPlan): the chat keeps the conversation and sends it each time. */
export async function askScanPlan(p: Plan, asking: AskingInT, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<AskTurn> {
  const { data } = await callAI<AskTurn>(await orgPath("/scan/plan/ask"), { ...p, asking }, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}

/** What people complain about, in the window: the core runs it (server/org/scan.ts) and announces each change. */

export const scanNow = () => orgJson<{ session: ScanSession | null }>("/scan").then((r) => r.session);

export const startScan = (req: ScanRequest) => orgJson<{ session: ScanSession }>("/scan", { method: "POST", json: req }).then((r) => r.session);

/** A first answer read before there's a project: what they named, and what to call it. Any trouble: it reads as asked. */
export const readFirstAnswer = (said: string): Promise<FirstRead> =>
  fetch("/api/start/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ said }) }).then((r) => (r.ok ? (r.json() as Promise<FirstRead>) : NOT_READ), () => NOT_READ);

/** Whether their words name anything to read about (any trouble: they do, and it reads as asked). */
export const namesSomething = (said: string, signal?: AbortSignal) => orgJson<{ named: boolean }>("/scan/named", { method: "POST", json: { said }, ...(signal ? { signal } : {}) }).then((r) => r.named, () => true);
export const stopScan = () => orgFetch("/scan", { method: "DELETE" }).then(() => {});

type Plan = { target: ScanTarget; sources: string[]; told?: ScanSaid[] };
const post = <T>(path: string, json: unknown, signal?: AbortSignal) => orgJson<T>(path, { method: "POST", json, ...(signal ? { signal } : {}) });

export const writeBrief = (p: Plan & { card: string; topic: string; draft: string; audience: string; about?: string; goal: { title: string; metric: string }; answers: string; why: string; later: { draft: string; why: string }[]; asked: BriefAsked; known: ScanKnown[] }, signal?: AbortSignal) => post<{ brief: BriefMeta | null }>("/scan/brief", p, signal).then((r) => r.brief);
export const scanShare = (p: Plan) => post<{ problems: ShareProblem[] }>("/scan/share", p).then((r) => r.problems);
export const steerQuestions = (target: ScanTarget, signal?: AbortSignal) => post<{ questions: PlanQuestion[] }>("/scan/ask", { target }, signal).then((r) => r.questions);
export const steerScan = (more: Partial<ScanSteer>) => post<{ session: ScanSession | null }>("/scan/steer", more).then((r) => r.session);

export const keepAnswers = (said: { question: string; answer: string }[], title: string) => post<{ source: string | null }>("/scan/answers", { said, title }).then((r) => r.source);
export const planAudiences = (p: Plan & { answers: string }, signal?: AbortSignal) => post<{ audiences: ScanAudience[] }>("/scan/audiences", p, signal).then((r) => r.audiences);
export const keepAudience = (a: { name: string; about?: string; refs: string[] }) => post<{ ok: true }>("/scan/audience", a);
export const firstBuild = (p: Plan & { audience: string; refs: string[]; answers: string; answersSource?: string; topic?: string }, signal?: AbortSignal) => post<{ build: ScanPlan["build"] | null }>("/scan/first", p, signal).then((r) => r.build ?? null);
