import type { StartHandoff } from "@/onboarding/handoff";
import { orgJson } from "./client";

/** What the start page's box handed this project, taken once: the next ask finds nothing (src/onboarding/handoff.ts). */
export const takeStart = async (): Promise<StartHandoff | null> => (await orgJson<{ start: StartHandoff | null }>("/start", { method: "DELETE" })).start;
