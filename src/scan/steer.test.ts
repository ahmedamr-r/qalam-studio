import { describe, expect, it } from "vitest";
import { focusWith, isOff, notAsked, sanitizeSteer, steerAnswers, steerOf, steerRound, toldLines, withSteer } from "./steer";

const idea = { kind: "idea" as const, said: "A meal planner for 3 kinds of night shift workers" };
const product = { kind: "product" as const, name: "Beamer" };

describe("questions while a scan reads", () => {
  it("says back how it took them only with a word of theirs in it and no number they didn't say", () => {
    const title = (understood: string) => sanitizeSteer({ understood, who: [] }, idea)[0].title;
    expect(title("You want a meal planner built around night shifts")).toBe("You want a meal planner built around night shifts. Right?");
    expect(title("You want a planner for 3 kinds of shift worker.")).toBe("You want a planner for 3 kinds of shift worker. Right?");
    expect(title("You want a planner for 40 million shift workers.")).toBe(`You want to build: ${idea.said}. Right?`);
    expect(title("You want a fitness tracker app.")).toBe(`You want to build: ${idea.said}. Right?`);
    expect(title("")).toBe(`You want to build: ${idea.said}. Right?`);
    expect(title("You want a meal planner for night shifts. It isn't clear yet who for.")).toBe("You want a meal planner for night shifts. Right?");
    expect(title(`You want a meal planner for ${"people on night shifts and ".repeat(12)}others.`)).toBe(`You want to build: ${idea.said}. Right?`);
  });

  it("offers kinds of people to pick from, never a number, each once, always open to their own words", () => {
    const who = sanitizeSteer({ understood: "", who: ["Nurses", "nurses", "Long-haul drivers", "The 4 million paramedics", 7, "", "Factory crews", "Security guards", "Baristas"] }, idea)[1];
    expect(who.options.map((o) => o.label)).toEqual(["Nurses", "nurses", "Long-haul drivers", "Factory crews"]);
    expect(who.allowOther).toBe(true);
    expect(who.recommended).toEqual([]);
  });

  it("asks who it's for only of an idea, and with nothing from Qalam AI still asks in the open", () => {
    expect(steerRound(product).map((q) => q.id)).toEqual(["meant", "seen"]);
    expect(sanitizeSteer({ understood: "Beamer, the changelog tool.", who: ["Founders"] }, product).map((q) => q.id)).toEqual(["meant", "seen"]);
    const open = steerRound(idea);
    expect(open.map((q) => q.id)).toEqual(["meant", "who", "seen"]);
    expect(open[1]).toMatchObject({ options: [], allowOther: false });
    expect(sanitizeSteer(null, idea)[0].options[0].label).toBe("Yes, that's it");
  });

  it("hears a yes as what they mean, and a correction in their words", () => {
    const q = sanitizeSteer({ understood: "You want a planner for night shifts.", who: [] }, idea);
    expect(steerAnswers(q, { meant: "Yes, that's it", who: "Nurses", seen: " " })).toEqual([
      { question: "What they mean:", answer: "You want a planner for night shifts." },
      { question: "Who do you picture using this first?", answer: "Nurses" },
    ]);
    expect(steerAnswers(q, { meant: "No, it's for their kids" })).toEqual([{ question: "What they mean, in their words:", answer: "No, it's for their kids" }]);
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
    expect(notAsked(q, [{ question: q[1].title, answer: "Nurses" }]).map((x) => x.id)).toEqual(["meant", "seen"]);
    expect(notAsked(q, [])).toHaveLength(3);
  });
});
