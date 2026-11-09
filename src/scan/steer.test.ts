import { describe, expect, it } from "vitest";
import { focusWith, isOff, notAsked, sanitizeSteer, steerAnswers, steerOf, steerRound, toldLines, withSteer } from "./steer";

const idea = { kind: "idea" as const, said: "A meal planner for 3 kinds of night shift workers" };
const product = { kind: "product" as const, name: "Beamer" };

describe("questions while a scan reads", () => {
  it("never asks them to confirm what they meant: what they said is what they meant", () => {
    for (const q of [...steerRound(idea), ...steerRound(product), ...sanitizeSteer({ understood: "You want a meal planner for night shifts.", who: ["Nurses"] }, idea)]) {
      expect(q.id).not.toBe("meant");
      expect(q.title).not.toMatch(/Right\?$/);
    }
  });

  it("offers kinds of people to pick from, never a number, each once, always open to their own words", () => {
    const who = sanitizeSteer({ who: ["Nurses", "nurses", "Long-haul drivers", "The 4 million paramedics", 7, "", "Factory crews", "Security guards", "Baristas"] }, idea)[0];
    expect(who.options.map((o) => o.label)).toEqual(["Nurses", "nurses", "Long-haul drivers", "Factory crews"]);
    expect(who.allowOther).toBe(true);
    expect(who.recommended).toEqual([]);
  });

  it("asks who it's for only of an idea, and with nothing from Qalam AI still asks in the open", () => {
    expect(steerRound(product).map((q) => q.id)).toEqual(["seen"]);
    expect(sanitizeSteer({ who: ["Founders"] }, product).map((q) => q.id)).toEqual(["seen"]);
    const open = steerRound(idea);
    expect(open.map((q) => q.id)).toEqual(["who", "seen"]);
    expect(open[0]).toMatchObject({ options: [], allowOther: false });
    expect(sanitizeSteer(null, idea).map((q) => q.id)).toEqual(["who", "seen"]);
  });

  it("hears each answer as their words", () => {
    const q = sanitizeSteer({ who: [] }, idea);
    expect(steerAnswers(q, { who: "Nurses", seen: " " })).toEqual([{ question: "Who do you picture using this first?", answer: "Nurses" }]);
    expect(steerAnswers(q, {})).toEqual([]);
  });

  it("keeps what's sent to what it should be, and the newer answer to the same question", () => {
    expect(steerOf({ said: [{ question: "Who?", answer: "  Nurses " }, { question: "", answer: "x" }, { question: "Y", answer: "" }, 3], off: ["Shift Fuel", "", 4] })).toEqual({ said: [{ question: "Who?", answer: "Nurses" }], off: ["Shift Fuel"] });
    expect(steerOf(null)).toEqual({ said: [], off: [] });
    const a = withSteer(undefined, { said: [{ question: "Who?", answer: "Nurses" }], off: ["Shift Fuel"] });
    const b = withSteer(a, { said: [{ question: "who?", answer: "Drivers" }], off: ["Shift Fuel", "Riseo"] });
    expect(b).toEqual({ said: [{ question: "who?", answer: "Drivers" }], off: ["Shift Fuel", "Riseo"] });
    expect(isOff(b, "shift fuel")).toBe(true);
    expect(isOff(b, "Mealime")).toBe(false);
    expect(isOff(undefined, "Mealime")).toBe(false);
  });

  it("tells the reader where to look first, never what to find", () => {
    const steer = { said: [{ question: "Who?", answer: "Nurses" }], off: [] };
    const f = focusWith("What people struggle with", steer);
    expect(f.startsWith("What people struggle with")).toBe(true);
    expect(toldLines(steer)).toBe("- Who? Nurses");
    expect(f).toContain("- Who? Nurses");
    expect(f).toContain("never what to find");
    expect(f).toContain("speaks against it");
    expect(focusWith("What people struggle with", { said: [], off: ["Riseo"] })).toBe("What people struggle with");
    expect(focusWith("What people struggle with", undefined)).toBe("What people struggle with");
  });

  it("doesn't ask again what they've answered", () => {
    const q = steerRound(idea);
    expect(notAsked(q, [{ question: q[0].title, answer: "Nurses" }]).map((x) => x.id)).toEqual(["seen"]);
    expect(notAsked(q, [])).toHaveLength(2);
  });
});
