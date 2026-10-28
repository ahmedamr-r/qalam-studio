import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foldJobs, type JobLog } from "@/goals/jobs";
import { changeJob, noteForJob, planJobs, searchForJob, takeInForJob } from "./jobs";
import { OrgStore } from "./store";

// The model, the tools and the linking call, as tests stand them in.
const structured = vi.fn();
const flushBearings = vi.fn();
const importItems = vi.fn();
const searchConnector = vi.fn();
vi.mock("@/ai/server", () => ({ structured: (...a: unknown[]) => structured(...a) }));
vi.mock("../routes/discovery", () => ({ DISCOVERY_MODEL: "test-model" }));
vi.mock("./goals", () => ({ flushBearings: (...a: unknown[]) => flushBearings(...a) }));
vi.mock("./needs", () => ({ knowledgeInputs: async (s: OrgStore) => ({ topics: await s.listTopics(), pieces: new Map(), shows: new Map(), indexed: false }) }));
vi.mock("../connectors", () => ({
  connectorsView: async () => ({
    checkedAt: null,
    connectors: [
      { id: "notion", label: "Notion", imports: true, numbers: false, tone: "ok" },
      { id: "slack", label: "Slack", imports: true, numbers: false, tone: "off" },
      { id: "posthog", label: "PostHog", imports: false, numbers: true, tone: "ok" },
      { id: "linear", label: "Linear", imports: false, numbers: false, tone: "ok" },
    ],
  }),
  importItems: (...a: unknown[]) => importItems(...a),
  searchConnector: (...a: unknown[]) => searchConnector(...a),
}));

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-jobs-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
  for (const f of [structured, flushBearings, importItems, searchConnector]) f.mockReset();
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const job = (o: Partial<JobLog> = {}): JobLog => ({ id: "j1", goal: "g1", kind: "search", title: "Search Notion for basket", why: "Who rebuilds baskets.", connector: "notion", query: "basket", status: "todo", results: [], by: "qalam", at: 1, ...o });
const jobNow = async (id = "j1") => foldJobs(await store.listJobLog()).find((j) => j.id === id);

describe("jobs for a goal, in the core", () => {
  it("plans jobs for what isn't known, keeping only what code can stand behind, and keeps the call's trace", async () => {
    const { goal } = await store.createGoal({ title: "More customers reorder every week" });
    structured.mockResolvedValue({
      model: "test-model",
      data: {
        jobs: [
          { kind: "numbers", gap: "x1", title: "Read the weekly reorders from PostHog", why: "Shows which number would show it moving.", connector: "posthog", query: "Weekly reorders", questions: [], who: [] },
          // Linear reads no material and no numbers: it isn't a tool a job may use.
          { kind: "search", gap: "x2", title: "Search Linear", why: "Nothing.", connector: "linear", query: "reorders", questions: [], who: [] },
        ],
      },
    });
    const emitted: string[] = [];
    expect(await planJobs(store, goal.id, (l) => emitted.push(l))).toEqual({ added: 1, gaps: 2 });
    // The call was told which tools are connected here.
    const sent = (structured.mock.calls[0][0] as { content: { text: string }[] }).content[0].text;
    expect(sent).toContain("- slack · Slack: searches the team's messages, customer channels among them · not connected");
    expect(sent).not.toContain("linear");
    expect(await jobNow((await store.listJobLog())[0].id)).toMatchObject({ goal: goal.id, gap: `no-number:${goal.id}`, kind: "numbers", connector: "posthog", status: "todo", by: "qalam" });
    expect(await readdir(path.join(dir, "chats", "goals", "traces"))).toHaveLength(1);
    expect(emitted.at(-1)).toBe("Qalam AI is planning how to find out 2 things not known yet");
  });

  it("runs a search job in its tool, takes the picked items in, links them at once, and is done", async () => {
    await store.addJobs([job()]);
    searchConnector.mockResolvedValue([{ id: "h1", title: "Sara call" }]);
    expect(await searchForJob(store, "j1", "weekly  basket")).toEqual([{ id: "h1", title: "Sara call" }]);
    expect(searchConnector).toHaveBeenCalledWith("notion", "weekly basket");
    // The person's words are kept on the job.
    expect((await jobNow())?.query).toBe("weekly basket");
    importItems.mockResolvedValue({ added: ["Sara call"], skipped: [], failed: [], sources: ["s1"], pages: ["p1"] });
    flushBearings.mockResolvedValue({ added: 1, kept: 1, removed: 0, none: "" });
    const r = await takeInForJob(store, "j1", [{ id: "h1", title: "Sara call" }], () => {});
    expect(flushBearings).toHaveBeenCalledWith(store, ["p1"]);
    expect(r.linked).toEqual({ added: 1, kept: 1, removed: 0, none: "" });
    expect(await jobNow()).toMatchObject({ status: "done", results: ["s1"], outcome: "1 item brought in · 1 new link from problems to goals" });
  });

  it("says when a search brought nothing new, and links nothing", async () => {
    await store.addJobs([job()]);
    importItems.mockResolvedValue({ added: [], skipped: ["Sara call"], failed: [], sources: [], pages: [] });
    await takeInForJob(store, "j1", [{ id: "h1", title: "Sara call" }], () => {});
    expect(flushBearings).not.toHaveBeenCalled();
    expect((await jobNow())?.outcome).toBe("Nothing new: it was all in already");
  });

  it("keeps a talk's notes on the job and links the pages they were filed into", async () => {
    await store.addJobs([job({ kind: "talk", connector: undefined, query: undefined, questions: ["When did you last rebuild your basket?"] })]);
    flushBearings.mockResolvedValue({ added: 0, kept: 1, removed: 0, none: "" });
    const filed = { calls: 1, created: 0, added: 2, revised: 0, retired: 0, disputed: 0, pages: [{ id: "p2", title: "Rebuilding takes too long", kind: "need" as const }] };
    expect(await noteForJob(store, "j1", { sourceId: "s9", filed }, () => {})).toEqual({ added: 0, kept: 1, removed: 0, none: "" });
    expect(flushBearings).toHaveBeenCalledWith(store, ["p2"]);
    // Notes nothing was filed from: kept on the job, nothing to link.
    expect(await noteForJob(store, "j1", { sourceId: "s10" }, () => {})).toBeNull();
    expect(flushBearings).toHaveBeenCalledTimes(1);
    expect(await jobNow()).toMatchObject({ status: "todo", results: ["s9", "s10"] });
  });

  it("changes only jobs that are there", async () => {
    await expect(changeJob(store, "nope", { status: "done" })).rejects.toThrow("No such job");
    await store.addJobs([job()]);
    await changeJob(store, "j1", { status: "dropped" });
    expect((await jobNow())?.status).toBe("dropped");
  });
});
