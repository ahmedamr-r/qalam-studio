import { describe, expect, it } from "vitest";
import type { ChatJob, ChatTurn } from "@/space/chat";
import { checklistRows, checklistStates, checklistTargets, type ChecklistCard, type ChecklistTargets } from "./checklist";

const card = (id: string, o: Partial<ChecklistCard> = {}): ChecklistCard => ({ id, kind: "opportunity", title: id, faint: false, underGoal: false, problems: 0, brief: false, ...o });
const turns = (...jobs: unknown[]) => jobs.map((job, i) => ({ id: `t${i}`, at: i, said: "", job: job as ChatJob })) as ChatTurn[];
const goal = (id: string, o: Partial<ChecklistCard> = {}) => card(id, { kind: "outcome", goal: `g-${id}`, ...o });
const noDump = () => ({ added: 0 });

describe("checklistTargets", () => {
  it("runs on the card they picked where it fits", () => {
    const cards = [card("a"), card("b"), goal("g"), goal("h"), card("s", { kind: "solution" })];
    expect(checklistTargets(cards, "b").goal?.id).toBe("b");
    expect(checklistTargets(cards, "h").problems?.id).toBe("h");
    expect(checklistTargets(cards, "b").prd?.id).toBe("b");
  });

  it("leaves a problem that has a goal out of finding it one, and says so by finding none", () => {
    expect(checklistTargets([card("a", { underGoal: true })], "a").goal).toBeNull();
    expect(checklistTargets([card("a", { underGoal: true }), card("b")], "a").goal?.id).toBe("b");
  });

  it("takes a real problem before a faint one, and a faint one when that's all there is", () => {
    expect(checklistTargets([card("f", { faint: true, topic: "t" }), card("a")], null).goal?.id).toBe("a");
    expect(checklistTargets([card("f", { faint: true, topic: "t" })], null).goal?.id).toBe("f");
  });

  it("prefers a goal with nothing behind it yet", () => {
    expect(checklistTargets([goal("g", { problems: 2 }), goal("h")], null).problems?.id).toBe("h");
    expect(checklistTargets([goal("g", { problems: 2 })], null).problems?.id).toBe("g");
    expect(checklistTargets([card("a")], null).problems).toBeNull();
  });

  it("writes a PRD on a solution first, then a problem, then a goal, skipping cards that have one", () => {
    const s = card("s", { kind: "solution" });
    const p = card("p");
    const g = goal("g");
    expect(checklistTargets([g, p, s], null).prd?.id).toBe("s");
    expect(checklistTargets([g, p], null).prd?.id).toBe("p");
    expect(checklistTargets([g], null).prd?.id).toBe("g");
    expect(checklistTargets([{ ...s, brief: true }, p], null).prd?.id).toBe("p");
    expect(checklistTargets([card("t", { kind: "test" })], "t").prd).toBeNull();
  });
});

describe("checklistStates", () => {
  it("is idle with nothing in the chat", () => {
    expect(checklistStates([], noDump)).toEqual({ goal: "idle", problems: "idle", prd: "idle" });
  });

  it("finds a goal once one's taken, even while its number is still being asked", () => {
    expect(checklistStates(turns({ kind: "goalfor", step: "fits" }), noDump).goal).toBe("going");
    expect(checklistStates(turns({ kind: "goalfor", step: "asking", on: { card: "c", title: "g" } }), noDump).goal).toBe("done");
    expect(checklistStates(turns({ kind: "goalfor", step: "failed" }), noDump).goal).toBe("idle");
  });

  it("finds problems only once one's accepted", () => {
    const find = { what: "problem", said: [], goal: { card: "c", id: "g", title: "t" } };
    expect(checklistStates(turns({ kind: "find", what: "problem", goal: find.goal }), noDump).problems).toBe("going");
    expect(checklistStates(turns({ kind: "dump", source: "s", find }), () => ({ phase: "review", added: 0 })).problems).toBe("going");
    expect(checklistStates(turns({ kind: "dump", source: "s", find }), () => ({ phase: "placed", added: 0 })).problems).toBe("idle");
    expect(checklistStates(turns({ kind: "dump", source: "s", find }), () => ({ phase: "placed", added: 2 })).problems).toBe("done");
  });

  it("doesn't count finding a goal or a problem with no goal in mind", () => {
    expect(checklistStates(turns({ kind: "find", what: "goal" }), noDump).problems).toBe("idle");
    expect(checklistStates(turns({ kind: "dump", source: "s", find: { what: "problem", said: [] } }), () => ({ phase: "placed", added: 2 })).problems).toBe("idle");
  });

  it("writes a PRD on a card or at the end of a scan", () => {
    expect(checklistStates(turns({ kind: "brief", brief: { step: "asking" } }), noDump).prd).toBe("going");
    expect(checklistStates(turns({ kind: "brief", brief: { step: "failed" } }), noDump).prd).toBe("idle");
    expect(checklistStates(turns({ kind: "brief", brief: { step: "ready" } }), noDump).prd).toBe("done");
    expect(checklistStates(turns({ kind: "scan", plan: { brief: { step: "ready" } } }), noDump).prd).toBe("done");
  });

  it("stays done when a later try is under way or fails", () => {
    const on = { kind: "goalfor", step: "done", on: { card: "c", title: "g" } };
    expect(checklistStates(turns(on, { kind: "goalfor", step: "looking" }), noDump).goal).toBe("done");
    expect(checklistStates(turns({ kind: "goalfor", step: "looking" }, on), noDump).goal).toBe("done");
  });
});

describe("checklistRows", () => {
  const none: ChecklistTargets = { goal: null, problems: null, prd: null };
  const idle = { goal: "idle", problems: "idle", prd: "idle" } as const;
  const base = { targets: none, states: idle, done: [], blocked: null, anyProblem: false };

  it("names the card each row would run on", () => {
    const rows = checklistRows({ ...base, targets: { goal: card("Slow support"), problems: goal("More orders"), prd: card("Slow support") } });
    expect(rows.map((r) => r.hint)).toEqual(["For “Slow support”", "For “More orders”", "A brief for “Slow support”"]);
    expect(rows.every((r) => r.can)).toBe(true);
  });

  it("says what's missing when there's nothing to run it on", () => {
    expect(checklistRows(base).map((r) => [r.hint, r.can])).toEqual([["Add a problem first", false], ["Find a goal first", false], ["Add a problem first", false]]);
    expect(checklistRows({ ...base, anyProblem: true })[0].hint).toBe("Every problem here has a goal");
  });

  it("says why Qalam AI can't start, and lets what's going be shown", () => {
    const rows = checklistRows({ ...base, targets: { goal: card("a"), problems: null, prd: card("a") }, states: { ...idle, prd: "going" }, blocked: "Qalam AI isn't ready here" });
    expect(rows[0]).toMatchObject({ hint: "Qalam AI isn't ready here", can: false });
    expect(rows[1].hint).toBe("Find a goal first");
    expect(rows[2]).toMatchObject({ hint: "Under way in the chat", state: "going", can: true });
  });

  it("keeps a row done once it's been done, whatever the chat holds now", () => {
    expect(checklistRows({ ...base, done: ["goal"] })[0]).toEqual({ item: "goal", label: "Find a goal for a problem", hint: "", state: "done", can: false });
  });
});
