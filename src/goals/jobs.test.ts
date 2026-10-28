import { describe, expect, it } from "vitest";
import type { OstMetric } from "@/discovery/types";
import type { Topic } from "@/hub/topics";
import { gapsOf } from "./gaps";
import { foldJobs, jobLine, jobMaterial, jobsOf, sanitizeJobs, type Job, type JobLog, type JobTool } from "./jobs";
import type { GoalProblem } from "./problems";
import { ordered } from "./tree";
import type { Goal, GoalTree } from "./types";

const metric = (o: Partial<OstMetric> = {}): OstMetric => ({ name: "Weekly reorders", unit: "orders", direction: "increase", baseline: 1.2, current: 1.3, target: 1.5, ...o });
const goal = (id: string, o: Partial<Goal> = {}): Goal => ({ id, title: `Goal ${id}`, parent: null, product: null, status: "active", cites: [], by: "person", at: 1, ...o });
const tree: GoalTree = ordered({
  north: "ns",
  goals: [goal("ns", { title: "2M dirhams a month in orders", metric: metric({ name: "Orders a month", unit: "dirhams", baseline: 1_400_000, current: 1_500_000, target: 2_000_000 }) }), goal("r", { title: "More customers reorder every week", parent: "ns", product: "grocery", metric: metric() })],
});
const line = (id: string, text: string, section: "know" | "believe" | "open" = "know") => ({ id, section, text, cites: [], by: "qalam" as const, from: [], at: 1 });
const page = (id: string, title: string, lines: ReturnType<typeof line>[], kind: Topic["kind"] = "need"): Topic => ({ id, kind, title, products: ["grocery"], createdAt: 1, updatedAt: 1, lines, history: [] });
const basket = page("p1", "Rebuilding my usual basket takes too long", [line("a", "Sara rebuilds her weekly shop by hand: “Every Sunday night I sit down and rebuild my basket from scratch.”"), line("q", "Do people reorder the same basket each week?", "open")]);
const fees = page("p2", "Surprise delivery fees put me off ordering again", [line("c", "The team thinks fees put people off.", "believe")]);
const parents = page("s1", "Busy parents", [line("w", "They order on Sunday nights.")], "segment");
const topics = new Map([basket, fees, parents].map((t) => [t.id, t]));

const problem = (t: Topic, o: Partial<GoalProblem> = {}): GoalProblem => ({ topic: t.id, title: t.title, products: t.products, quotes: 0, sources: 0, against: 0, segments: [], weeks: [], boards: [], newest: 1, bears: "direct", how: "", by: "qalam", via: null, onBoard: false, ...o });
const problems = [problem(basket, { quotes: 12, sources: 4, how: "Planners who rebuild “from scratch” skip reordering." }), problem(fees, { bears: "some" })];
const tools: JobTool[] = [
  { id: "notion", label: "Notion", kind: "search", what: "searches the team's docs and notes", connected: true },
  { id: "intercom", label: "Intercom", kind: "search", what: "searches conversations with customers", connected: false },
  { id: "posthog", label: "PostHog", kind: "numbers", what: "reads a number from a saved insight", connected: true },
];

describe("what isn't known about a goal", () => {
  it("finds the number's gaps, then the problems': only the team's words, nobody named, open questions", () => {
    const g = goal("r", { metric: metric({ baseline: null, current: null, target: null }) });
    const gaps = gapsOf(g, problems, topics);
    expect(gaps.map((x) => [x.kind, x.title])).toEqual([
      ["no-baseline", "Where “Weekly reorders” stands today"],
      ["no-target", "Where “Weekly reorders” should get to, and by when"],
      ["no-segment", "Who has “Rebuilding my usual basket takes too long”"],
      ["team-only", "Whether customers have “Surprise delivery fees put me off ordering again”, or only the team says so"],
      ["open-question", "Do people reorder the same basket each week?"],
    ]);
    // Keys stay the same while a gap is open.
    expect(gaps.map((x) => x.key)).toEqual(["no-baseline:r", "no-target:r", "no-segment:p1", "team-only:p2", "open-question:p1:q"]);
  });

  it("asks for a number first, and for problems when none is linked", () => {
    expect(gapsOf(goal("x"), [], topics).map((x) => x.kind)).toEqual(["no-number", "no-problems"]);
    // A segment page that cites a problem's words answers who has it.
    expect(gapsOf(goal("r", { metric: metric() }), [problem(basket, { quotes: 3, sources: 1, segments: [{ id: "s1", title: "Busy parents" }] })], new Map()).map((x) => x.kind)).toEqual([]);
  });
});

describe("jobs", () => {
  const first: JobLog = { id: "j1", goal: "r", kind: "search", title: "Search Notion for basket", why: "Shows who rebuilds baskets.", connector: "notion", query: "basket", status: "todo", results: [], by: "qalam", at: 1 };

  it("folds the log: a job's first line, then each change's fields, results adding up", () => {
    const log: JobLog[] = [
      { id: "j1", query: "weekly basket", at: 2 },
      first,
      { id: "j1", status: "done", results: ["s1"], outcome: "1 item brought in", at: 3 },
      { id: "j1", results: ["s2", "s1"], at: 4 },
      // A change can't make it another goal's, another kind, or someone else's.
      { id: "j1", goal: "ns", kind: "talk", by: "you", at: 5 },
      // A change to no job.
      { id: "j9", status: "done", at: 6 },
    ];
    const [j] = foldJobs(log);
    expect(j).toMatchObject({ id: "j1", goal: "r", kind: "search", query: "weekly basket", status: "done", results: ["s1", "s2"], outcome: "1 item brought in", by: "qalam", at: 1, changed: 5 });
    expect(foldJobs(log)).toHaveLength(1);
    // Lines are read in time order: a change from before the job was planned is no change to it.
    expect(foldJobs([{ id: "j1", query: "early", at: 0 }, first])[0].query).toBe("basket");
  });

  it("lists a goal's jobs: to do oldest first, then done newest first, dropped ones gone", () => {
    const j = (id: string, status: Job["status"], at: number, changed = at): Job => ({ ...(first as Job), id, status, at, changed });
    expect(jobsOf([j("a", "done", 1, 5), j("b", "todo", 3), j("c", "todo", 2), j("d", "dropped", 1), j("e", "done", 1, 9), { ...j("f", "todo", 1), goal: "ns" }], "r").map((x) => x.id)).toEqual(["c", "b", "e", "a"]);
  });

  const material = (planned: Job[] = []) => {
    const g = goal("r", { title: "More customers reorder every week", product: "grocery", parent: "ns", metric: metric({ baseline: null, current: null }) });
    const t: GoalTree = ordered({ north: "ns", goals: [tree.goals[0], g] });
    return jobMaterial({ tree: t, goal: g, gaps: gapsOf(g, problems, topics), problems, topics, tools, segments: [parents], people: [{ name: "Sara", quotes: 4 }], planned, productName: (id) => ({ grocery: "Grocery app" })[id] });
  };

  it("sends the goal under the goals it feeds, the gaps, the problems, the tools, and who the material names", () => {
    const m = material();
    expect(m.text).toContain("- the organization · North Star: 2M dirhams a month in orders · Orders a month: 1,500,000 → 2,000,000 dirhams");
    expect(m.text).toContain("  - Grocery app · More customers reorder every week · Weekly reorders: ? → 1.5 orders   ← this goal");
    expect(m.text).toContain("- x1 · Where “Weekly reorders” stands today");
    expect(m.text).toContain("- x4 · Do people reorder the same basket each week? (an open question on “Rebuilding my usual basket takes too long”)");
    expect(m.text).toContain("- intercom · Intercom: searches conversations with customers · not connected");
    expect(m.text).toContain("- s1 · Busy parents");
    expect(m.text).toContain("- p1 · Sara · 4");
    expect([...m.gaps.keys()]).toEqual(["x1", "x2", "x3", "x4"]);
  });

  it("keeps a job only when its gap, tool and people were sent and its words are in what was sent", () => {
    const m = material();
    let n = 0;
    const id = () => `n${++n}`;
    const raw = {
      jobs: [
        { kind: "numbers", gap: "x1", title: "Read Weekly reorders from PostHog", why: "Shows where “Weekly reorders” stands today.", connector: "posthog", query: "Weekly reorders", questions: [], who: [] },
        // A second job for one gap.
        { kind: "search", gap: "x1", title: "Search Notion for reorders", why: "Shows reorders.", connector: "notion", query: "reorders", questions: [], who: [] },
        { kind: "search", gap: "x3", title: "Search Intercom for delivery fee", why: "Shows whether customers raise fees, not just the team.", connector: "intercom", query: "delivery fee", questions: [], who: [] },
        // A tool for the wrong kind of job.
        { kind: "search", gap: "x2", title: "Search PostHog", why: "Nothing.", connector: "posthog", query: "fees", questions: [], who: [] },
        // A number nothing sent has.
        { kind: "search", gap: "none", title: "Search Notion for churn", why: "Churn is 40% this year.", connector: "notion", query: "churn", questions: [], who: [] },
        {
          kind: "talk",
          gap: "x4",
          title: "Ask busy parents how they reorder",
          why: "Tells whether people reorder the same basket each week.",
          connector: "none",
          query: "",
          questions: ["When did you last rebuild your basket “from scratch”?", "Who told you “fees are a scam”?"],
          who: [
            { ref: "s1", why: "They order on Sunday nights." },
            { ref: "p1", why: "She rebuilds her shop by hand." },
            { ref: "team", why: "" },
            { ref: "p7", why: "Not sent." },
          ],
        },
        { kind: "read-code", gap: "x9", title: "Read the reorder flow", why: "Unsent gap.", connector: "none", query: "", questions: ["Which steps does reordering have?"], who: [] },
        { kind: "read-code", gap: "none", title: "Read the reorder flow", why: "Shows the steps of reordering today.", connector: "none", query: "", questions: ["Which steps does reordering have?"], who: [] },
      ],
    };
    const dropped: string[] = [];
    const kept = sanitizeJobs(raw, m, { goal: "r", now: 9, id }, (why) => dropped.push(why));
    expect(kept.map((j) => [j.kind, j.gap ?? null, j.connector ?? null, j.query ?? null])).toEqual([
      ["numbers", "no-baseline:r", "posthog", "Weekly reorders"],
      ["search", "team-only:p2", "intercom", "delivery fee"],
      ["talk", "open-question:p1:q", null, null],
      ["read-code", null, null, null],
    ]);
    const talk = kept[2];
    expect(talk.questions).toEqual(["When did you last rebuild your basket “from scratch”?"]);
    expect(talk.who).toEqual([
      { kind: "segment", id: "s1", name: "Busy parents", why: "They order on Sunday nights." },
      { kind: "person", name: "Sara", why: "She rebuilds her shop by hand." },
      { kind: "team", name: "The team", why: "" },
    ]);
    expect(kept.every((j) => j.status === "todo" && j.by === "qalam" && j.at === 9 && j.goal === "r")).toBe(true);
    expect(dropped).toEqual(["a second job for one gap", "a tool not sent, or not one for this kind of job", "its words or numbers aren't in what was sent", "someone not named in what was sent", "a gap not sent"]);
    // A job planned already isn't planned again.
    const again = sanitizeJobs(raw, material(kept), { goal: "r", now: 10, id });
    expect(again.map((j) => j.kind)).toEqual([]);
    expect(jobLine(kept[0])).not.toHaveProperty("changed");
  });
});
