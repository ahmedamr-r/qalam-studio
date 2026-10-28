import { nanoid } from "nanoid";
import { jobsCall } from "@/ai/jobs";
import { structured } from "@/ai/server";
import type { Hit } from "@/connectors/recipes";
import { foldBearings } from "@/goals/bearings";
import { gapsOf } from "@/goals/gaps";
import { foldJobs, jobLine, jobMaterial, sanitizeJobs, type Job, type JobStatus, type JobTool } from "@/goals/jobs";
import { rankForGoal } from "@/goals/problems";
import { goalById } from "@/goals/tree";
import { rankNeeds } from "@/hub/needs";
import type { CaptureResult } from "../capture";
import { connectorsView, importItems, searchConnector, type ImportResult } from "../connectors";
import { DISCOVERY_MODEL } from "../routes/discovery";
import { flushBearings, type Linked } from "./goals";
import { knowledgeInputs } from "./needs";
import { NotFoundError, type OrgStore } from "./store";

/**
 * Jobs for a goal, in the core (src/goals/jobs.ts): Qalam AI plans them from what isn't known yet
 * (src/goals/gaps.ts), code keeps the ones it can stand behind, and Qalam runs what it can: a
 * search in a connected tool, whose picked items are taken in like any other material and then
 * linked to the goals at once. Questions to ask are handed over; the notes that come back are
 * taken in the same way (the capture route, with the job's id).
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What each tool does, for the call. */
const WHAT: Record<string, string> = {
  notion: "searches the team's docs and notes",
  slack: "searches the team's messages, customer channels among them",
  intercom: "searches conversations with customers",
  posthog: "reads a number from a saved insight",
};

/** The tools a job may use: those that bring material in, and those that read numbers; whether each is connected here. */
export async function jobTools(): Promise<JobTool[]> {
  const { connectors } = await connectorsView();
  return connectors.flatMap((c): JobTool[] =>
    c.imports || c.numbers ? [{ id: c.id, label: c.label, kind: c.imports ? "search" : "numbers", what: WHAT[c.id] ?? (c.imports ? "searches what the team keeps there" : "reads numbers"), connected: c.tone === "ok" }] : [],
  );
}

/** Names that say a role, not who someone is. */
const ROLE = /^(customers?|users?|speaker|interviewer|interviewee|participant|moderator|host|guest|team|bot|someone|note|me|you|we|they|admin|agent|support)(\s*\d+)?$/i;

/** The people the organization's material names (quotes' speakers, as their sources name them), the most quoted first. */
async function peopleIn(store: OrgStore): Promise<{ name: string; quotes: number }[]> {
  const count = new Map<string, number>();
  for (const s of await store.listSources()) {
    if (s.kind === "dump") continue;
    for (const q of s.quotes) {
      const name = q.speaker?.replace(/\s+/g, " ").trim();
      if (!name || name.length > 60 || ROLE.test(name)) continue;
      count.set(name, (count.get(name) ?? 0) + 1);
    }
  }
  return [...count].map(([name, quotes]) => ({ name, quotes })).sort((a, b) => b.quotes - a.quotes || a.name.localeCompare(b.name));
}

/** One call planning jobs for what isn't known about a goal; code keeps the ones it can stand behind. */
export async function planJobs(store: OrgStore, goalId: string, emit?: (label: string) => void): Promise<{ added: number; gaps: number }> {
  const tree = await store.getGoals();
  const goal = goalById(tree, goalId);
  if (!goal) throw new NotFoundError("No such goal");
  const k = await knowledgeInputs(store);
  const needs = rankNeeds({ now: Date.now(), topics: k.topics, pieces: k.pieces, shows: k.shows });
  const problems = rankForGoal(goalId, { tree, links: foldBearings(await store.listBearingLog()).links, needs });
  const topics = new Map(k.topics.map((t) => [t.id, t]));
  const gaps = gapsOf(goal, problems, topics);
  const planned = foldJobs(await store.listJobLog()).filter((j) => j.goal === goalId && j.status !== "dropped");
  // The segments whose pages cite the problems' evidence first.
  const near = new Set(problems.flatMap((p) => p.segments.map((s) => s.id)));
  const segments = k.topics.filter((t) => t.kind === "segment").sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)) || b.updatedAt - a.updatedAt);
  const products = await store.listProducts();
  emit?.("Looking at the tools connected here");
  const m = jobMaterial({ tree, goal, gaps, problems, topics, tools: await jobTools(), segments, people: await peopleIn(store), planned, productName: (id) => products.find((p) => p.id === id)?.name });
  emit?.(gaps.length ? `Qalam AI is planning how to find out ${gaps.length === 1 ? "what isn't known" : `${gaps.length} things not known`} yet` : "Qalam AI is planning what would make the problems surer");
  const { data, model } = await structured<unknown>({ model: DISCOVERY_MODEL, ...jobsCall(m) });
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const jobs = sanitizeJobs(data, m, { goal: goalId, now, id: () => nanoid(10) }, (why, item) => dropped.push({ why, item }));
  // The call's trace: what it was sent (by id), what it answered, what code kept and left out, and why.
  await store
    .putTrace({ id: nanoid(10), projectId: "goals", kind: "jobs", at: now, ...(model ? { model } : {}), goal: goalId, gaps: [...m.gaps].map(([ref, g]) => ({ ref, key: g.key })), answer: data, kept: jobs.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  await store.addJobs(jobs.map(jobLine));
  return { added: jobs.length, gaps: gaps.length };
}

async function jobOf(store: OrgStore, id: string): Promise<Job> {
  const job = foldJobs(await store.listJobLog()).find((j) => j.id === id);
  if (!job) throw new NotFoundError("No such job");
  return job;
}

/** The jobs still to do, across goals, the oldest first (the home shows each goal's next). */
export async function openJobs(store: OrgStore): Promise<Job[]> {
  return foldJobs(await store.listJobLog())
    .filter((j) => j.status === "todo")
    .sort((a, b) => a.at - b.at);
}

/** A person marks a job done, drops it, or brings it back. */
export async function changeJob(store: OrgStore, id: string, patch: { status?: JobStatus; outcome?: string }, opts: { tab?: string } = {}) {
  await jobOf(store, id);
  await store.addJobs([{ id, ...patch, at: Date.now() }], opts);
}

/** A search job's search, in its tool; words the person changed are kept on the job. */
export async function searchForJob(store: OrgStore, id: string, query?: string): Promise<Hit[]> {
  const job = await jobOf(store, id);
  if (job.kind !== "search" || !job.connector) throw new Error("This job doesn't search a tool.");
  const words = (query ?? job.query ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!words) throw new Error("Search for something.");
  if (words !== job.query) await store.addJobs([{ id, query: words, at: Date.now() }]);
  return searchConnector(job.connector, words);
}

/** What came of a search job, in a line. */
function searchOutcome(r: ImportResult, linked: Linked | null): string {
  const parts = [r.added.length ? `${plural(r.added.length, "item")} brought in` : r.skipped.length ? "Nothing new: it was all in already" : "Nothing came in", r.added.length && r.skipped.length ? `${r.skipped.length} in already` : "", r.failed.length ? `${r.failed.length} couldn't be read` : ""];
  if (linked) parts.push(linked.added ? `${plural(linked.added, "new link")} from problems to goals` : "no new link to a goal");
  return parts.filter(Boolean).join(" · ");
}

/** Take a search job's picked items in, link what they say to the goals now, and mark the job done. */
export async function takeInForJob(store: OrgStore, id: string, hits: Hit[], emit: (label: string) => void): Promise<ImportResult & { linked: Linked | null }> {
  const job = await jobOf(store, id);
  if (job.kind !== "search" || !job.connector) throw new Error("This job doesn't search a tool.");
  const r = await importItems(store, job.connector, hits, emit);
  let linked: Linked | null = null;
  if (r.pages?.length) {
    emit("Linking what it says to the goals");
    linked = await flushBearings(store, r.pages);
  }
  await store.addJobs([{ id, status: "done", results: r.sources ?? [], outcome: searchOutcome(r, linked), at: Date.now() }]);
  return { ...r, linked };
}

/** Notes from a job that was handed over (a talk), taken in as a source: kept on the job, then the pages it was filed into linked to the goals now. */
export async function noteForJob(store: OrgStore, id: string, taken: Pick<CaptureResult, "sourceId" | "filed">, emit: (label: string) => void): Promise<Linked | null> {
  await jobOf(store, id);
  await store.addJobs([{ id, results: [taken.sourceId], at: Date.now() }]);
  const pages = taken.filed?.pages.map((p) => p.id) ?? [];
  if (!pages.length) return null;
  emit("Linking what it says to the goals");
  return flushBearings(store, pages);
}
