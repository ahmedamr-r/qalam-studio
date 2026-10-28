import { describe, expect, it } from "vitest";
import type { ShapedGoal } from "@/goals/outline";
import { emptyKnow, missingQuestions, readKnow, writeKnow } from "./know-state";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("the know door's tab state", () => {
  it("comes back as it was left, per organization, without the error", () => {
    const s = memory();
    const k = { ...emptyKnow(), phase: "review" as const, text: "2M a month\n  More reorders", sent: true, error: "boom" };
    writeKnow(s, "basket", k);
    expect(readKnow(s, "basket")).toEqual({ ...k, error: null });
    expect(readKnow(s, "other")).toBeNull();
  });

  it("forgets an empty draft, and ignores what it can't read", () => {
    const s = memory();
    writeKnow(s, "basket", { ...emptyKnow(), text: "draft" });
    writeKnow(s, "basket", emptyKnow());
    expect(s.m.size).toBe(0);
    s.setItem("qalam:know:basket", "{not json");
    expect(readKnow(s, "basket")).toBeNull();
    s.setItem("qalam:know:basket", JSON.stringify({ phase: "nope", text: "x" }));
    expect(readKnow(s, "basket")).toBeNull();
    expect(readKnow(null, "basket")).toBeNull();
  });
});

describe("missingQuestions", () => {
  const g = (ref: string, missing: ShapedGoal["missing"], name = "Weekly reorders"): ShapedGoal => ({ ref, title: `Goal ${ref}`, parent: null, product: null, metric: missing.includes("number") ? null : ({ name } as ShapedGoal["metric"]), missing });

  it("asks one short question per goal, about just the part that's missing", () => {
    const qs = missingQuestions([g("o1", ["number"]), g("o2", ["today", "target"]), g("o3", ["today"]), g("o4", ["target", "when"]), g("o5", ["when"])]);
    expect(qs.map((q) => [q.id, q.title])).toEqual([
      ["o1", "“Goal o1”: which number shows it moving?"],
      ["o2", "“Weekly reorders”: where is it today, and where should it get to?"],
      ["o3", "“Weekly reorders”: where is it today?"],
      ["o4", "“Weekly reorders”: where should it get to, and by when?"],
    ]);
  });

  it("asks at most eight", () => {
    expect(missingQuestions(Array.from({ length: 12 }, (_, n) => g(`o${n}`, ["today"])))).toHaveLength(8);
  });
});
