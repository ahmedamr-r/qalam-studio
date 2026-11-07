import { describe, expect, it } from "vitest";
import { askedId, foldAsked, linesFor } from "./fold";
import type { AskedEntry, AskedLine } from "./types";

const me = { id: "u1", name: "Sara" };
const entry = (qid: string, at: number, a: string, how: AskedEntry["how"] = "own", x: Partial<AskedEntry> = {}): AskedEntry => ({ v: 1, id: askedId("find", "t1", qid), at, by: me, flow: "find", key: "t1", about: { product: null }, qid, q: `Question ${qid}?`, how, a, ...x });

describe("the memory as it's read", () => {
  it("gives the same id to the same question in the same conversation, on any computer, and different ones otherwise", () => {
    expect(askedId("find", "t1", "nrr")).toBe(askedId("find", "t1", "nrr"));
    expect(new Set([askedId("find", "t1", "nrr"), askedId("focus", "t1", "nrr"), askedId("find", "t2", "nrr"), askedId("find", "t1", "arr")]).size).toBe(4);
  });

  it("keeps the latest answer to each question, whatever order a merge left the lines in", () => {
    const lines: AskedLine[] = [entry("nrr", 1, "About 104%"), entry("share", 2, "22%"), entry("nrr", 3, "About 108%")];
    for (const order of [lines, [...lines].reverse(), [lines[2], lines[0], lines[1]]]) {
      const m = foldAsked(order);
      expect(m.entries.map((e) => e.a)).toEqual(["About 108%", "22%"]);
    }
  });

  it("takes a forgotten answer off, even when the forget landed before its entry", () => {
    const e = entry("nrr", 5, "About 104%");
    const forget: AskedLine = { v: 1, forget: e.id, at: 9, by: me };
    expect(foldAsked([forget, e]).entries).toEqual([]);
    expect(foldAsked([e, forget, entry("share", 10, "22%")]).entries.map((x) => x.qid)).toEqual(["share"]);
  });

  it("keeps when an answer was last said to be right, and leaves out broken lines", () => {
    const e = entry("nrr", 5, "About 104%");
    const m = foldAsked([e, { v: 1, confirm: e.id, at: 7, by: me }, { v: 1, confirm: e.id, at: 6, by: me }, "nope", { v: 2, id: "x" }, { ...e, id: "" }, null]);
    expect(m.entries).toHaveLength(1);
    expect(m.confirmed.get(e.id)).toBe(7);
  });
});

describe("what a round writes", () => {
  it("writes their own answers and picks for the team, what they didn't know or left for this computer, and nothing twice", () => {
    const answers = [
      { qid: "nrr", q: "What is net revenue retention today?", a: "About 104%", how: "own" as const },
      { qid: "who", q: "Who is it for?", a: "Agencies", how: "pick" as const },
      { qid: "fail", q: "What's the failure rate?", a: "no idea", how: "unknown" as const },
      { qid: "tried", q: "What have you tried?", a: "", how: "left" as const },
    ];
    const first = linesFor({ flow: "find", key: "t1", about: { product: null }, answers, by: me, at: 1, have: foldAsked([]) });
    expect(first.shared.map((e) => e.qid)).toEqual(["nrr", "who"]);
    expect(first.local.map((e) => e.qid)).toEqual(["fail", "tried"]);
    // The same round again writes nothing; a changed answer is written.
    const have = foldAsked([...first.shared, ...first.local]);
    expect(linesFor({ flow: "find", key: "t1", about: { product: null }, answers, by: me, at: 2, have })).toEqual({ shared: [], local: [] });
    const changed = linesFor({ flow: "find", key: "t1", about: { product: null }, answers: [{ ...answers[0], a: "About 108%" }], by: me, at: 3, have });
    expect(changed.shared.map((e) => e.a)).toEqual(["About 108%"]);
  });
});
