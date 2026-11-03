import type { PlanQuestion } from "@/ai/plan";
import type { ScanPlan } from "@/space/chat";
import type { ScanAudience } from "@/scan/plan";
import type { BriefAsked } from "@/scan/brief";
import type { ShareProblem } from "@/scan/share";
import type { ScanKnown, ScanRequest, ScanSession, ScanTarget } from "@/scan/session";
import type { ScanSaid, ScanSteer } from "@/scan/steer";
import { orgFetch, orgJson } from "./client";

/** What people complain about, in the window: the core runs it (server/org/scan.ts) and announces each change. */

export const scanNow = () => orgJson<{ session: ScanSession | null }>("/scan").then((r) => r.session);

export const startScan = (req: ScanRequest) => orgJson<{ session: ScanSession }>("/scan", { method: "POST", json: req }).then((r) => r.session);

export const stopScan = () => orgFetch("/scan", { method: "DELETE" }).then(() => {});

type Plan = { target: ScanTarget; sources: string[]; told?: ScanSaid[] };
const post = <T>(path: string, json: unknown, signal?: AbortSignal) => orgJson<T>(path, { method: "POST", json, ...(signal ? { signal } : {}) });

export const writeBrief = (p: Plan & { topic: string; draft: string; audience: string; about?: string; goal: { title: string; metric: string }; answers: string; why: string; later: { draft: string; why: string }[]; asked: BriefAsked; known: ScanKnown[] }, signal?: AbortSignal) => post<{ brief: { file: string; markdown: string } | null }>("/scan/brief", p, signal).then((r) => r.brief);
export const scanShare = (p: Plan) => post<{ problems: ShareProblem[] }>("/scan/share", p).then((r) => r.problems);
export const steerQuestions = (target: ScanTarget, signal?: AbortSignal) => post<{ questions: PlanQuestion[] }>("/scan/ask", { target }, signal).then((r) => r.questions);
export const steerScan = (more: Partial<ScanSteer>) => post<{ session: ScanSession | null }>("/scan/steer", more).then((r) => r.session);

export const planQuestions = (p: Plan, signal?: AbortSignal) => post<{ questions: PlanQuestion[] }>("/scan/questions", p, signal).then((r) => r.questions);
export const keepAnswers = (said: { question: string; answer: string }[], title: string) => post<{ source: string | null }>("/scan/answers", { said, title }).then((r) => r.source);
export const planAudiences = (p: Plan & { answers: string }, signal?: AbortSignal) => post<{ audiences: ScanAudience[] }>("/scan/audiences", p, signal).then((r) => r.audiences);
export const keepAudience = (a: { name: string; about?: string; refs: string[] }) => post<{ ok: true }>("/scan/audience", a);
export const firstBuild = (p: Plan & { audience: string; refs: string[]; answers: string; answersSource?: string; topic?: string }, signal?: AbortSignal) => post<{ build: ScanPlan["build"] | null }>("/scan/first", p, signal).then((r) => r.build ?? null);
