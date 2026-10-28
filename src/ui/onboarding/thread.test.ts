import { describe, expect, it } from "vitest";
import type { SetupLine, SetupSession } from "@/org/setup";
import { initialFlow } from "../ai/questionFlow";
import { askOf, isAddress, stepsOf, threadOf, type ChatMessage, type ThreadInput } from "./thread";

const base = (over: Partial<ThreadInput> = {}): ThreadInput => ({
  route: "setup",
  mode: "first",
  first: true,
  orgName: "Basket",
  engine: "ready",
  naming: { name: null, busy: false, error: null },
  step: "goals",
  door: null,
  opened: true,
  know: { phase: "write", sent: false, answered: null, added: 0, error: null, goals: 0, questions: 0 },
  find: { session: null, pending: false, error: null, open: 0, accepted: 0 },
  busy: null,
  picked: 0,
  ...over,
});

const session = (over: Partial<SetupSession> = {}): SetupSession => ({ v: 1, phase: "asking", understanding: "A grocery app for parents.", challenges: [], buckets: [], ...over });
const bucket = (submitted: boolean) => ({ questions: [], form: { ...initialFlow([]), submitted } });
const line = (id: string, over: Partial<SetupLine> = {}): SetupLine => ({ id, to: "org", field: "goals", text: id, pieces: [], answers: [], why: "", ...over });

const ids = (m: ChatMessage[]) => m.map((x) => x.id);
const choices = (m: ChatMessage | undefined) => m?.parts.flatMap((p) => (p.type === "data" && p.name === "choices" ? [p.data.set] : []));

describe("the welcome", () => {
  it("looks for Claude first, and takes nothing while it does", () => {
    const i = base({ route: "welcome", engine: "looking" });
    expect(ids(threadOf(i))).toEqual(["engine"]);
    expect(askOf(i)).toMatchObject({ kind: "none", key: "engine" });
    expect(stepsOf(i).map((s) => s.state)).toEqual(["now", "next", "next", "next", "next"]);
  });

  it("asks for the name once Qalam AI is ready or left for later", () => {
    for (const engine of ["ready", "skipped"] as const) {
      const i = base({ route: "welcome", engine });
      expect(ids(threadOf(i))).toEqual(["engine", "name:ask"]);
      expect(askOf(i)).toMatchObject({ kind: "name", submit: "enter" });
      expect(stepsOf(i).map((s) => s.state)).toEqual(["done", "now", "next", "next", "next"]);
    }
  });

  it("shows the name sent while the organization is made", () => {
    const m = threadOf(base({ route: "welcome", naming: { name: "Basket", busy: true, error: null } }));
    expect(ids(m)).toEqual(["engine", "name:ask", "name:you", "status:name"]);
  });

  it("only checks in verify mode", () => {
    const i = base({ route: "welcome", mode: "verify" });
    expect(ids(threadOf(i))).toEqual(["engine", "verify"]);
    expect(askOf(i).kind).toBe("none");
  });
});

describe("the goals", () => {
  it("offers the two doors after the earlier steps", () => {
    const i = base();
    const m = threadOf(i);
    expect(ids(m)).toEqual(["engine", "name:ask", "name:you", "goals:ask"]);
    expect(choices(m.at(-1))).toEqual(["door"]);
    expect(askOf(i)).toMatchObject({ kind: "none", key: "door" });
    const goals = stepsOf(i).find((s) => s.id === "goals")!;
    expect(goals.state).toBe("now");
    expect(goals.sub?.map((s) => s.state)).toEqual(["now", "next", "next"]);
  });

  it("leaves the earlier steps out when it isn't the first run, and ends on All set", () => {
    const i = base({ first: false, find: { session: session({ phase: "done", proposal: { summary: "s", products: [], lines: [line("g1")] }, decided: { g1: "accepted" } }), pending: false, error: null, open: 0, accepted: 1 } });
    const m = threadOf(i);
    expect(ids(m)[0]).toBe("goals:ask");
    expect(ids(m).at(-1)).toBe("all-set");
    expect(stepsOf(i).map((s) => [s.label, s.state])).toEqual([
      ["Way in", "done"],
      ["Read and ask", "done"],
      ["Review", "done"],
      ["All set", "done"],
    ]);
  });

  it("takes an outline through the know door, then hands the composer to the questions", () => {
    const write = base({ door: "know" });
    expect(choices(threadOf(write).find((x) => x.id === "goals:ask"))).toEqual([]);
    expect(askOf(write)).toMatchObject({ kind: "outline", submit: "ctrlEnter" });
    const asking = base({ door: "know", know: { phase: "asking", sent: true, answered: null, added: 0, error: null, goals: 3, questions: 2 } });
    expect(ids(threadOf(asking)).slice(-3)).toEqual(["know:ask", "know:outline", "know:missing"]);
    expect(askOf(asking)).toMatchObject({ kind: "questions", scope: "know" });
    const review = base({ door: "know", know: { phase: "review", sent: true, answered: "skipped", added: 0, error: null, goals: 3, questions: 2 } });
    expect(ids(threadOf(review)).slice(-2)).toEqual(["know:answers", "know:review"]);
    expect(choices(threadOf(review).at(-1))).toEqual(["know-review"]);
  });

  it("reads a brain dump, asks a round, and lets the round be skipped", () => {
    const i = base({ door: "find", find: { session: session({ buckets: [bucket(false)] }), pending: false, error: null, open: 0, accepted: 0 } });
    const m = threadOf(i);
    expect(ids(m).slice(-4)).toEqual(["find:ask", "find:said", "find:took", "find:round:0"]);
    expect(choices(m.at(-1))).toEqual(["skip"]);
    expect(askOf(i)).toMatchObject({ kind: "questions", scope: "find" });
  });

  it("shows an answered round as their message, then what Qalam AI took from it", () => {
    const s = session({ phase: "ready", buckets: [{ ...bucket(true), analysis: "They sell to parents." }] });
    const m = threadOf(base({ find: { session: s, pending: false, error: null, open: 0, accepted: 0 } }));
    expect(ids(m).slice(-4)).toEqual(["find:round:0", "find:answers:0", "find:analysis:0", "find:ready"]);
  });

  it("sends the review to the right, with Accept all for what's open", () => {
    const s = session({ phase: "review", proposal: { summary: "Three goals and the About.", products: [], lines: [line("g1"), line("g2"), line("a1", { field: "context" })] }, decided: {} });
    const i = base({ find: { session: s, pending: false, error: null, open: 3, accepted: 0 } });
    const m = threadOf(i);
    expect(m.at(-1)?.id).toBe("find:proposal");
    expect(m.at(-1)?.parts.find((p) => p.type === "data")).toMatchObject({ data: { set: "proposal", n: 3 } });
    expect(stepsOf(i).find((x) => x.id === "goals")?.sub?.map((x) => x.state)).toEqual(["done", "done", "now"]);
  });

  it("ends the goals with Next on the first run, and drops the button once they move on", () => {
    const s = session({ phase: "done", proposal: { summary: "s", products: [], lines: [line("g1")] }, decided: { g1: "accepted" } });
    const at = (step: ThreadInput["step"]) => threadOf(base({ step, picked: 2, find: { session: s, pending: false, error: null, open: 0, accepted: 1 } }));
    expect(choices(at("goals").at(-1))).toEqual(["goals-in"]);
    expect(ids(at("yours")).slice(-2)).toEqual(["goals:in", "yours:ask"]);
    expect(choices(at("yours").find((x) => x.id === "goals:in"))).toEqual([]);
    expect(ids(at("connect")).slice(-3)).toEqual(["yours:ask", "yours:you", "connect:ask"]);
  });
});

describe("while Qalam AI works", () => {
  it("ends on a status message with a steady id, and the composer waits", () => {
    const i = base({ door: "find", find: { session: session({ phase: "reading", understanding: "" }), pending: false, error: null, open: 0, accepted: 0 }, busy: { label: "Reading" } });
    const a = threadOf(i);
    expect(a.at(-1)?.id).toBe("status:find:said");
    expect(ids(threadOf(i))).toEqual(ids(a));
    expect(askOf(i)).toMatchObject({ kind: "none", key: "busy" });
  });

  it("shows what they sent before there's a session", () => {
    const i = base({ door: "find", find: { session: null, pending: true, error: null, open: 0, accepted: 0 }, busy: { label: "Reading the page" } });
    expect(ids(threadOf(i)).slice(-2)).toEqual(["find:said", "status:find:said"]);
  });
});

describe("isAddress", () => {
  it("reads a lone web address as a page, anything else as writing", () => {
    expect(isAddress("example.com")).toBe(true);
    expect(isAddress(" https://basket.ae/about ")).toBe(true);
    expect(isAddress("We deliver groceries. See basket.ae")).toBe(false);
    expect(isAddress("notes")).toBe(false);
  });
});
