import { describe, expect, it } from "vitest";
import type { SeenMap, SeenReading } from "@/seen/types";
import { offered, openQuestion, readingAsk, readingSteps, readingThread, type ReadingInput } from "./thread";

const screen = (key: string) => ({ key, name: key, shots: [`asset:${key.padStart(24, "0")}`], states: {}, kind: "detail" as const, can: [], nav: [], by: "qalam" as const, at: 1 });
const flow = (key: string, steps: string[]) => ({ key, name: key, aim: "", steps, moves: [], notShown: [], by: "qalam" as const, at: 1 });
const kept: SeenMap = { key: "g", product: "g", readAt: 1, screens: [screen("cart"), screen("pay")], flows: [flow("checkout", ["cart", "pay"])], gone: [] };
const q = (id: string, options: string[] = []) => ({ id, ask: `Question ${id}?`, why: "Because.", shots: [], marks: [], options, by: "qalam" as const });
const reading = (over: Partial<SeenReading>): SeenReading => ({ key: "g", product: "g", started: 1, phase: "reading", shots: [{ ref: "asset:1", name: "a.png" }, { ref: "asset:2", name: "b.png" }], notes: {}, words: true, rounds: [], steps: {}, settled: { flows: {}, steps: {} }, ...over });
const input = (over: Partial<ReadingInput>): ReadingInput => ({ productName: "Grocery app", reading: null, map: null, words: true, adding: null, answers: {}, decided: {}, error: null, ...over });
const ids = (i: ReadingInput) => readingThread(i).map((m) => m.id);

describe("reading screenshots as a conversation", () => {
  it("opens on the drop area, saying what's kept already", () => {
    expect(readingThread(input({}))[0].parts).toEqual([{ type: "text", text: "Add screenshots of Grocery app: I'll read each one, put them into flows, and ask where I can't tell." }, { type: "data", name: "drop", data: {} }]);
    expect(readingThread(input({ map: kept }))[0].parts[0]).toEqual({ type: "text", text: "Grocery app has 2 screens in 1 flow. Add more screenshots and I'll fit them in." });
    expect(readingSteps(input({})).map((s) => s.state)).toEqual(["now", "next", "next", "next"]);
  });

  it("asks one question at a time, the answered ones as the person's replies, then sends the round", () => {
    const r = reading({ phase: "asking", notes: { "asset:1": { name: "A", kind: "list", can: [], nav: [] } }, rounds: [{ questions: [q("q1", ["Yes", "No"]), q("q2")], answers: [] }] });
    expect(ids(input({ reading: r }))).toEqual(["intro", "shots", "read", "q-0-q1"]);
    expect(openQuestion(input({ reading: r }))?.id).toBe("q1");
    expect(readingAsk(input({ reading: r }))).toEqual({ kind: "answer", question: "q1", placeholder: "Pick one, or say it in your words…" });
    const answered = input({ reading: r, answers: { q1: "Yes" } });
    expect(ids(answered)).toEqual(["intro", "shots", "read", "q-0-q1", "a-0-q1", "q-0-q2"]);
    expect(readingAsk(answered)).toMatchObject({ question: "q2", placeholder: "Your answer…" });
    expect(ids(input({ reading: r, answers: { q1: "Yes", q2: "After paying" } })).slice(-1)).toEqual(["sending"]);
    expect(readingSteps(answered).map((s) => s.state)).toEqual(["done", "done", "now", "next"]);
  });

  it("offers only the flows that are new or changed, and says when this Mac can't read words", () => {
    const proposal: SeenMap = { ...kept, flows: [flow("checkout", ["cart", "pay"]), flow("browse", ["home", "cart"])], screens: [...kept.screens, screen("home"), screen("help")] };
    const r = reading({ phase: "review", words: false, proposal, notes: { "asset:1": { name: "A", kind: "list", can: [], nav: [] } } });
    expect(offered(r, kept).map((f) => f.key)).toEqual(["browse"]);
    const thread = readingThread(input({ reading: r, map: kept }));
    expect(thread.map((m) => m.id)).toContain("no-words");
    expect(thread.at(-1)!.parts[0]).toEqual({ type: "text", text: "Here's how I'd put them: 1 flow, and 1 screen in no flow yet. Accept the flows that are right." });
  });
});
