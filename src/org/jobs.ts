import { callAI } from "@/ai/client";
import type { Hit } from "@/connectors/recipes";
import type { LookedOnline } from "@/discovery/ingest/posts";
import type { Job, JobStatus } from "@/goals/jobs";
import type { LinkedNow } from "./capture";
import type { ImportResult } from "./connectors";
import { orgFetch, orgJson, orgPath } from "./client";

/*
 * Jobs for goals in the window (server/org/jobs.ts): planning them for a goal (Qalam AI), the open
 * ones across goals, marking one done or dropping it, and running a search job: its search, then
 * the items picked, taken in and linked to the goals at once.
 */

const at = (id: string, rest = "") => `/jobs/${encodeURIComponent(id)}${rest}`;

export const jobsDb = {
  /** The jobs still to do, across goals, the oldest first. */
  open: () => orgJson<Job[]>("/jobs"),
  /** Qalam AI plans jobs for what isn't known yet about the goal; `onActivity` hears how it's going. */
  plan: async (goal: string, onActivity: (label: string) => void) =>
    (
      await callAI<{ added: number; gaps: number }>(await orgPath(`/goals/${encodeURIComponent(goal)}/jobs`), {}, undefined, undefined, (e) => {
        if (e.type === "activity") onActivity(e.label);
      })
    ).data,
  change: (id: string, patch: { status?: JobStatus; outcome?: string }) => orgFetch(at(id), { method: "PATCH", json: patch }).then(() => undefined),
  /** A search job's search, in its tool (the person's own words, when they changed them). */
  search: (id: string, query: string) => orgJson<{ hits: Hit[] }>(at(id, "/search"), { method: "POST", json: { query } }).then((r) => r.hits),
  /** Take the picked items in; the job is done once they're filed and linked. */
  takeIn: async (id: string, hits: Hit[], onActivity: (label: string) => void) =>
    (
      await callAI<ImportResult & { linked: LinkedNow | null }>(await orgPath(at(id, "/take")), { hits }, undefined, undefined, (e) => {
        if (e.type === "activity") onActivity(e.label);
      })
    ).data,
  /** A posts job: what people say online about its problem, taken in as people online's. */
  online: async (id: string, onActivity: (label: string) => void) =>
    (
      await callAI<LookedOnline>(await orgPath(at(id, "/online")), {}, undefined, undefined, (e) => {
        if (e.type === "activity") onActivity(e.label);
      })
    ).data,
};
