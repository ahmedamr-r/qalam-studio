import { describe, expect, it } from "vitest";
import type { AskAnswer } from "@/hub/ask";
import { chatKey, chatOf, emptyChat, MAX_TURNS, running, threadOf, withJob, withTurn, type ChatTurn } from "./chat";

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
    expect(threadOf(c)[1].parts).toEqual([{ type: "data", name: "answer", data: { turn: "a" } }]);
    c = withJob(c, "a", () => ({ kind: "ask", state: "failed", error: "No engine" }));
    expect(threadOf(c)[1].parts).toEqual([{ type: "text", text: "I couldn't answer that: No engine" }]);
  });
});
