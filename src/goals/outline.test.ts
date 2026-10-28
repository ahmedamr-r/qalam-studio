import { describe, expect, it } from "vitest";
import { missingQuestions } from "@/ui/setup/GoalsForm";
import { missingOf, readOutline, sanitizeShaped, withoutGoal } from "./outline";
import { metricFrom, withoutIds, wordsHold } from "./said";

describe("goals written down as an outline", () => {
  it("reads each line under the nearest less indented line above it, bullets or not", () => {
    const o = readOutline("2M dirhams a month in orders by end of Q2\n  - More customers reorder every week: 1.2 now, 1.5 by March\n\t* More first orders become second orders\n      Fewer first orders arrive late\n  Offices reorder on a schedule");
    expect(o.map((g) => [g.ref, g.text, g.parent])).toEqual([
      ["o1", "2M dirhams a month in orders by end of Q2", null],
      ["o2", "More customers reorder every week: 1.2 now, 1.5 by March", "o1"],
      ["o3", "More first orders become second orders", "o1"],
      ["o4", "Fewer first orders arrive late", "o3"],
      ["o5", "Offices reorder on a schedule", "o1"],
    ]);
  });

  it("reads lines all at one level as the North Star and the goals that feed it", () => {
    expect(readOutline("1. Grow orders\n2. Keep customers\n3. Win offices").map((g) => g.parent)).toEqual([null, "o1", "o1"]);
    expect(readOutline("Just one goal").map((g) => g.parent)).toEqual([null]);
    expect(readOutline("\n  \n")).toEqual([]);
  });
});

describe("what Qalam AI reads from each line", () => {
  const goals = readOutline("2M dirhams a month in orders by end of Q2\n  More customers reorder every week: 1.2 now, 1.5 by March\n  Offices on Basket for Business reorder monthly");
  const products = [{ ref: "p1", id: "grocery", name: "Grocery app" }];

  it("keeps titles in the line's words, numbers only from the line or the answer, and a new product only under a name it used", () => {
    const raw = {
      goals: [
        { id: "o1", title: "2M dirhams a month in orders", product: "org", productName: "", metric: { name: "Orders a month", unit: "dirhams", direction: "increase", baseline: null, current: 1_400_000, target: 2_000_000, timeframe: "by end of Q2" } },
        { id: "o2", title: "Customers love the app", product: "p1", productName: "", metric: { name: "Weekly reorders", unit: "", direction: "increase", baseline: 1.2, current: null, target: 1.5, timeframe: "by March" } },
        { id: "o3", title: "Offices reorder monthly", product: "new", productName: "Basket for Business", metric: null },
        // Twice, and a line it wasn't sent.
        { id: "o1", title: "Something else", product: "org", productName: "", metric: null },
        { id: "o9", title: "Unsent", product: "org", productName: "", metric: null },
      ],
    };
    const [ns, weekly, offices] = sanitizeShaped(raw, { goals, products, answers: new Map([["o1", "We're at about 1.5M a month now."]]) });
    // 1,400,000 is nowhere in what they wrote; 1.5M is, but the model didn't say it.
    expect(ns).toMatchObject({ title: "2M dirhams a month in orders", parent: null, product: null, metric: { name: "Orders a month", current: null, target: 2_000_000, timeframe: "by end of Q2" }, missing: ["today"] });
    // Not the line's words: the line as written.
    expect(weekly).toMatchObject({ title: "More customers reorder every week: 1.2 now, 1.5 by March", parent: "o1", product: { id: "grocery" }, metric: { baseline: 1.2, target: 1.5, timeframe: "by March" }, missing: [] });
    expect(offices).toMatchObject({ title: "Offices reorder monthly", product: { name: "Basket for Business" }, metric: null, missing: ["number"] });
    // Numbers with no measure named in their words: the goal's words name it.
    const unnamed = sanitizeShaped({ goals: [{ id: "o2", title: "More customers reorder every week", product: "org", productName: "", metric: { name: "Repeat purchase rate", unit: "", direction: "increase", baseline: 1.2, current: null, target: 1.5, timeframe: "" } }] }, { goals, products, answers: new Map() });
    expect(unnamed[1].metric).toMatchObject({ name: "More customers reorder every week", baseline: 1.2, target: 1.5 });
    expect(unnamed[1].missing).toEqual(["when"]);
    // A product it names that they didn't, and one they have already, named.
    const named = sanitizeShaped({ goals: [{ id: "o3", title: "Offices reorder monthly", product: "new", productName: "Basket Enterprise", metric: null }] }, { goals, products, answers: new Map() });
    expect(named[2].product).toBeNull();
    const again = sanitizeShaped({ goals: [{ id: "o2", title: "More customers reorder", product: "new", productName: "grocery app", metric: null }] }, { goals, products, answers: new Map() });
    expect(again[1].product).toEqual({ id: "grocery" });
  });

  it("asks only for what's missing, about just that part", () => {
    const shaped = sanitizeShaped({ goals: [{ id: "o1", title: "2M dirhams a month in orders", product: "org", productName: "", metric: { name: "Orders a month", unit: "", direction: "increase", baseline: null, current: null, target: 2_000_000, timeframe: "by end of Q2" } }] }, { goals, products, answers: new Map() });
    expect(missingOf(shaped[0].metric)).toEqual(["today"]);
    expect(missingQuestions(shaped).map((q) => [q.id, q.title])).toEqual([
      ["o1", "Where does “Orders a month” stand today?"],
      ["o2", "How would you know “More customers reorder every week: 1.2 now, 1.5 by March” is moving? The number, where it is today, and where it should get to by when."],
      ["o3", "How would you know “Offices on Basket for Business reorder monthly” is moving? The number, where it is today, and where it should get to by when."],
    ]);
    // A goal taken off: the goals under it move up.
    expect(withoutGoal(shaped, "o1").map((g) => [g.ref, g.parent])).toEqual([
      ["o2", null],
      ["o3", null],
    ]);
  });
});

describe("a call's ids, never in what people read", () => {
  it("drops a list of ids, names an id the call gave, and leaves what isn't one", () => {
    const names = (ref: string) => ({ g3: "Tutors reply within an hour", t1: "Slow replies" })[ref];
    expect(withoutIds("Waiting “almost a week” is exactly the slow first reply g3's 3-hour median counts (l2, l4).", names)).toBe("Waiting “almost a week” is exactly the slow first reply Tutors reply within an hour's 3-hour median counts.");
    expect(withoutIds("t1 moves it, as l7 says.", names)).toBe("Slow replies moves it, as says.");
    expect(withoutIds("Revenue by Q2 for b2b customers", names)).toBe("Revenue by Q2 for b2b customers");
  });
});

describe("a goal in their own words", () => {
  it("holds when every word that says what is theirs, one or many of it", () => {
    expect(wordsHold("Weekly reorders per customer", "customers reorder every week")).toBe(true);
    expect(wordsHold("Monthly churn", "customers reorder every week")).toBe(false);
    expect(wordsHold("by March", "1.5 by March")).toBe(true);
    expect(wordsHold("Families booking a second lesson", "More families book a second lesson")).toBe(true);
    expect(wordsHold("the", "anything")).toBe(false);
  });

  it("keeps a unit that's a sign only where they wrote the sign", () => {
    expect(metricFrom({ name: "Second lessons", unit: "%", direction: "increase", baseline: 30, current: null, target: 45, timeframe: "" }, "30% book a second lesson; 45% by June")?.unit).toBe("%");
    expect(metricFrom({ name: "Second lessons", unit: "$", direction: "increase", baseline: 30, current: null, target: null, timeframe: "" }, "30 book a second lesson")?.unit).toBeUndefined();
  });

  it("keeps a number only where what they wrote has it", () => {
    expect(metricFrom({ name: "Orders a month", unit: "AED", direction: "decrease", baseline: 2, current: 3, target: 2_000_000, timeframe: "Q2" }, "2M dirhams a month in orders by Q2, from 2 stores")).toEqual({ name: "Orders a month", direction: "decrease", baseline: 2, current: null, target: 2_000_000, timeframe: "Q2" });
    expect(metricFrom({ name: "Churn", unit: "", direction: "increase", baseline: 9, current: null, target: null, timeframe: "" }, "Fewer offices leave")).toBeNull();
    expect(metricFrom(null, "anything")).toBeNull();
  });
});
