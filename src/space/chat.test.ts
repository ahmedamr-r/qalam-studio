import { describe, expect, it } from "vitest";
import type { DumpSession } from "@/discovery/dump";
import type { AskAnswer } from "@/hub/ask";
import { asking, chatKey, chatOf, emptyChat, MAX_TURNS, running, threadOf, withJob, withTurn, type ChatTurn } from "./chat";

const answer: AskAnswer = { question: "Why do parents stop?", answer: "The window.", claims: [], unknowns: [], how: "packed", at: 1 };
const turn = (id: string, job: ChatTurn["job"], said = "Why do parents stop ordering?"): ChatTurn => ({ id, at: 1, said, job });

describe("the canvas's chat", () => {
  it("is keyed by its product, or org", () => {
    expect(chatKey(null)).toBe("org");
    expect(chatKey("grocery")).toBe("grocery");
  });

  it("reads a file: nothing usable is an empty chat, and an ask still running when the page went is over", () => {
    expect(chatOf(null)).toEqual(emptyChat());
    expect(chatOf({ v: 2, turns: [] })).toEqual(emptyChat());
    const c = chatOf({ v: 1, turns: [turn("a", { kind: "ask", state: "asking" }), { id: 3 }, turn("b", { kind: "ask", state: "answered", answer })] });
    expect(c.turns.map((t) => t.id)).toEqual(["a", "b"]);
    expect(c.turns[0].job).toMatchObject({ kind: "ask", state: "failed" });
    expect(running(c)).toBeNull();
  });

  it("keeps the newest turns", () => {
    let c = emptyChat();
    for (let i = 0; i < MAX_TURNS + 5; i++) c = withTurn(c, turn(`t${i}`, { kind: "ask", state: "answered", answer }));
    expect(c.turns).toHaveLength(MAX_TURNS);
    expect(c.turns[0].id).toBe("t5");
  });

  it("works the thread out from the turns: their words, then what came of them", () => {
    let c = withTurn(emptyChat(), turn("a", { kind: "ask", state: "asking" }));
    expect(running(c)?.id).toBe("a");
    expect(threadOf(c)).toEqual([
      { id: "a:you", role: "user", parts: [{ type: "text", text: "Why do parents stop ordering?" }] },
      { id: "a:ai", role: "assistant", parts: [{ type: "data", name: "working", data: { turn: "a" } }] },
    ]);
    c = withJob(c, "a", () => ({ kind: "ask", state: "answered", answer, secs: 4 }));
    // An answer offers to take the words another way ("Not a question?").
    expect(threadOf(c)[1].parts).toEqual([
      { type: "data", name: "answer", data: { turn: "a" } },
      { type: "data", name: "switch", data: { turn: "a" } },
    ]);
    c = withJob(c, "a", () => ({ kind: "ask", state: "failed", error: "No engine" }));
    expect(threadOf(c)[1].parts[0]).toEqual({ type: "text", text: "I couldn't answer that: No engine" });
  });
});

describe("a brain dump in the canvas's chat", () => {
  const session = (over: Partial<DumpSession>): DumpSession => ({ v: 1, phase: "asking", understanding: "Riders give up when the car moves away.", challenges: [], buckets: [{ questions: [], form: { current: null, answers: {}, visited: [], editing: false, submitted: false } } as never], anchor: null, ...over });
  const dumpTurn = (source: string): ChatTurn => ({ id: "d", at: 1, said: "My thinking…", job: { kind: "dump", source } });

  it("reads its session for where it stands: reading, asking, placing, proposing", () => {
    const c = withTurn(emptyChat(), dumpTurn("s1"));
    const names = (s: DumpSession | null) =>
      threadOf(c, () => s)[1].parts.map((p) => (p.type === "data" ? p.name : "text"));
    expect(names(null)).toEqual(["dumping"]);
    expect(names(session({ phase: "reading", understanding: "" }))).toEqual(["dumping"]);
    expect(names(session({}))).toEqual(["took", "text", "skip"]);
    expect(names(session({ phase: "placing" }))).toEqual(["took", "answered", "dumping"]);
    expect(names(session({ phase: "review" }))).toEqual(["took", "answered", "proposed"]);
    expect(names(session({ phase: "failed", failed: { at: "placing", error: "No engine" } }))).toEqual(["took", "answered", "text", "retry"]);
  });

  it("reads a file for a card: what it took from it and the file that would help when it's the wrong one, or that they left it out", () => {
    const file = { card: "c1", title: "Price list.pdf" };
    const c = withTurn(emptyChat(), { ...dumpTurn("s1"), job: { kind: "dump", source: "s1", file } });
    const names = (cc: typeof c, s: DumpSession | null) => threadOf(cc, () => s)[1].parts.map((p) => (p.type === "data" ? p.name : "text"));
    expect(names(c, session({ phase: "ready", buckets: [], off: { wanted: "Notes from talks with regulars" } }))).toEqual(["took", "off"]);
    expect(names(c, session({ phase: "ready", buckets: [] }))).toEqual(["took", "text", "place"]);
    const left = withJob(c, "d", (j) => (j.kind === "dump" ? { ...j, file: { ...file, left: true } } : j));
    expect(threadOf(left, () => null)[1].parts).toEqual([{ type: "text", text: "You left “Price list.pdf” out." }]);
  });

  it("says when a dump never started", () => {
    const c = withTurn(emptyChat(), { ...dumpTurn("s1"), job: { kind: "dump", source: "s1", error: "Qalam AI isn't set up here." } });
    expect(threadOf(c)[1].parts).toEqual([{ type: "text", text: "Qalam AI isn't set up here." }]);
  });

  it("has the box ask the newest dump's questions while it waits on them", () => {
    const c = withTurn(withTurn(emptyChat(), { ...dumpTurn("s1"), id: "a" }), { ...dumpTurn("s2"), id: "b" });
    expect(asking(c, (id) => session({ phase: id === "s1" ? "asking" : "review" }))).toMatchObject({ source: "s1" });
    expect(asking(c, () => session({}))?.turn.id).toBe("b");
    expect(asking(c, () => session({ phase: "placed" }))).toBeNull();
  });

  it("asks code's opening questions first when they want help finding one, then reads the answers as a dump", () => {
    let c = withTurn(emptyChat(), turn("f", { kind: "find", what: "goal" }, "Help me find a goal"));
    expect(asking(c, () => null)).toMatchObject({ find: "goal" });
    expect(threadOf(c)[1].parts.map((p) => (p.type === "data" ? p.name : "text"))).toEqual(["text", "cancel"]);
    c = withJob(c, "f", () => ({ kind: "dump", source: "s1", find: { what: "goal", said: [{ question: "What changes?", answer: "More riders finish trips" }] } }));
    expect(asking(c, () => session({ phase: "review" }))).toBeNull();
    expect(threadOf(c, () => session({ phase: "review" }))[1].parts.map((p) => (p.type === "data" ? p.name : "text"))).toEqual(["opening", "took", "answered", "proposed"]);
  });

  it("finds the problem to focus on for a goal: looks on the web first (Stop stops it), asks, then shows each look after the round it followed", () => {
    const goal = { card: "c1", id: "g1", title: "More PMs adopt Qalam" };
    const look = { at: 1, query: "", lines: [], pages: [] };
    const names = (cc: ReturnType<typeof emptyChat>, s: DumpSession | null = null) => threadOf(cc, () => s)[1].parts.map((p) => (p.type === "data" ? `${p.name}${p.data.look !== undefined ? `:${p.data.look}` : ""}` : "text"));
    let c = withTurn(emptyChat(), turn("f", { kind: "find", what: "problem", goal, loading: true }, "Find the problem to focus on"));
    expect(names(c)).toEqual(["working", "cancel"]);
    expect(running(c)?.id).toBe("f");
    c = withJob(c, "f", () => ({ kind: "find", what: "problem", goal, look }));
    expect(running(c)).toBeNull();
    expect(asking(c, () => null)).toMatchObject({ find: "problem" });
    expect(names(c)).toEqual(["looked", "text", "cancel"]);
    c = withJob(c, "f", () => ({ kind: "dump", source: "s1", find: { what: "problem", said: [{ question: "Who?", answer: "PMs" }], goal } }));
    const two = session({ phase: "asking", buckets: [session({}).buckets[0], session({}).buckets[0]], looks: [{ ...look, after: -1 }, { ...look, query: "why PMs drop tools", after: 0 }] });
    expect(names(c, two)).toEqual(["looked:0", "opening", "took", "answered", "looked:1", "text", "skip"]);
    // What it took from that round, read with the look, comes after the look.
    const read = { ...two, phase: "review" as const, buckets: two.buckets.map((b) => ({ ...b, analysis: "Cash at the door wins." })) };
    expect(names(c, read)).toEqual(["looked:0", "opening", "took", "answered", "looked:1", "analysis", "answered", "proposed"]);
    // A reload while it looked: code's own questions, no look.
    expect(chatOf({ v: 1, turns: [turn("f", { kind: "find", what: "problem", goal, loading: true })] }).turns[0].job).toEqual({ kind: "find", what: "problem", goal });
  });
});

describe("short statements and what came of them", () => {
  it("asks whether a short statement is a goal or a problem", () => {
    const c = withTurn(emptyChat(), turn("s", { kind: "choose", first: "problem" }, "Riders can't find the car"));
    expect(threadOf(c)[1].parts.map((p) => (p.type === "data" ? p.name : "text"))).toEqual(["text", "choose"]);
  });

  it("words a goal or a problem first, for them to use, edit or keep as they wrote it, then says where it went", () => {
    const parts = (job: ChatTurn["job"]) => threadOf(withTurn(emptyChat(), turn("a", job, "more oil from homes")))[1].parts.map((p) => (p.type === "data" ? p.name : "text"));
    expect(parts({ kind: "add", what: "goal", card: "", under: null, state: "suggesting" })).toEqual(["working"]);
    expect(parts({ kind: "add", what: "goal", card: "", under: null, state: "suggested", suggestion: "More households hand over their used oil" })).toEqual(["statement"]);
    expect(parts({ kind: "add", what: "goal", card: "c1", under: null })).toEqual(["added"]);
    // A wording still being worked out as the page went: their own words, to add as they are.
    expect(chatOf({ v: 1, turns: [turn("a", { kind: "add", what: "goal", card: "", under: null, state: "suggesting" })] }).turns[0].job).toMatchObject({ state: "suggested" });
  });

  it("lists the pages what customers said went into, and says when none took it", () => {
    const took = (pages: number, quotes: number) => threadOf(withTurn(emptyChat(), turn("t", { kind: "take", state: "done", sources: ["a"], pages: Array.from({ length: pages }, (_, i) => ({ id: `p${i}`, title: `Page ${i}` })), quotes }, "")))[1].parts;
    expect(took(2, 5)).toEqual([{ type: "text", text: "I kept 1 source. 5 quotes from customers went into these problems' pages:" }, { type: "data", name: "pages", data: { turn: "t" } }]);
    expect(took(0, 0)).toEqual([{ type: "text", text: "I kept 1 source, but found nothing customers said in it." }]);
    expect(running(withTurn(emptyChat(), turn("t", { kind: "take", state: "taking", sources: [], pages: [], quotes: 0 }, "")))?.id).toBe("t");
  });

  it("asks code's own opening questions when Qalam AI's were still being worked out as the page went", () => {
    const c = chatOf({ v: 1, turns: [turn("f", { kind: "find", what: "goal", loading: true }, "Help me find a goal")] });
    expect(c.turns[0].job).toEqual({ kind: "find", what: "goal" });
  });

  it("forgets a capture the page closed on, as it does an ask", () => {
    const c = chatOf({ v: 1, turns: [turn("t", { kind: "take", state: "taking", sources: [], pages: [], quotes: 0 }), turn("x", { kind: "made-up" } as never)] });
    expect(c.turns.map((t) => [t.id, t.job.kind === "take" && t.job.state])).toEqual([["t", "failed"]]);
  });
});
