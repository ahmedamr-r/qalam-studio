import { describe, expect, it } from "vitest";
import type { SourceQuote } from "@/discovery/sources";
import { groupsFromNeeds, sanitizeGroups, setupGroups } from "./setup-groups";

const SAID = "Pickup is the worst part. The driver went to gate 1, I was at gate 13. Pickup at the airport takes 25 minutes. The price at the end was 40 pounds more. We plan to pin gates.";
const q = (id: string, words: string, role: SourceQuote["role"]): SourceQuote => {
  const at = SAID.indexOf(words);
  return { id, text: words, span: [at, at + words.length], kind: "pain", role, addedBy: "ai", at: 0 };
};
const QUOTES = [
  q("need", "Pickup is the worst part.", "need"),
  q("gate", "The driver went to gate 1, I was at gate 13.", "evidence"),
  q("air", "Pickup at the airport takes 25 minutes.", "evidence"),
  q("fare", "The price at the end was 40 pounds more.", "evidence"),
  q("idea", "We plan to pin gates.", "idea"),
];
const REFS = { f1: "need", f2: "gate", f3: "air", f4: "fare", f5: "idea" };
let n = 0;
const id = () => `g${++n}`;

describe("the problems the reading grouped", () => {
  it("keeps groups of quotes that were sent and raise problems, each quote in one group", () => {
    n = 0;
    const raw = [
      { title: "Pickup at the gate", fragmentIds: ["f1", "f2", "f3", "f5", "f9"] },
      { title: "The price at the end", fragmentIds: ["f4", "f2"] },
      { title: "Nothing", fragmentIds: ["f5"] },
    ];
    expect(sanitizeGroups(raw, REFS, QUOTES, SAID, id)).toEqual([
      { id: "g1", title: "Pickup at the gate", quotes: ["need", "gate", "air"] },
      { id: "g2", title: "The price at the end", quotes: ["fare"] },
    ]);
  });

  it("titles a group in their words, else by its need's or first quote's words", () => {
    n = 0;
    const raw = [
      { title: "Drivers cannot locate riders", fragmentIds: ["f2", "f1"] },
      { title: "Surprise surcharges", fragmentIds: ["f4"] },
    ];
    expect(sanitizeGroups(raw, REFS, QUOTES, SAID, id).map((g) => g.title)).toEqual(["Pickup is the worst part.", "The price at the end was 40 pounds more."]);
  });

  it("makes groups from the needs for a session from before: what customers said joins the need it shares words with", () => {
    const groups = groupsFromNeeds([q("need", "Pickup at the gate is the worst part", "need"), q("gate", "The driver went to gate 1, I was at gate 13.", "evidence"), q("fare", "The price at the end was 40 pounds more.", "evidence")]);
    expect(groups.map((g) => g.quotes)).toEqual([["need"], ["gate"], ["fare"]]);
    const close = groupsFromNeeds([q("need", "Pickup at the airport is slow", "need"), q("air", "Pickup at the airport takes 25 minutes.", "evidence")]);
    expect(close.map((g) => g.quotes)).toEqual([["need", "air"]]);
  });

  it("keeps a group's quotes that are still problems, and says which no group took", () => {
    const quotes = QUOTES.map((x) => (x.id === "air" ? { ...x, role: "context" as const } : x));
    const { groups, loose } = setupGroups({ problems: [{ id: "g1", title: "Pickup", quotes: ["need", "air", "gone"] }] }, quotes);
    expect(groups).toEqual([{ id: "g1", title: "Pickup", quotes: ["need"] }]);
    expect(loose).toEqual(["gate", "fare"]);
  });
});
