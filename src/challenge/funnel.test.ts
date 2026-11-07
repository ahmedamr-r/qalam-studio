import { describe, expect, it } from "vitest";
import { tableText } from "@/discovery/ingest/rows";
import { biggestDrop, funnelOfNumbers, funnelsIn, lossBy, numberOf, stepsNamed, stepWords, tablesIn } from "./funnel";
import { GROCERY_FUNNEL } from "./sample";

/** A sheet as Qalam keeps it: its rows as tableText writes them. */
const sheet = (rows: string[][]) => tableText(rows)!;

// a2's export: a grocery app's first checkout, people entering each step and leaving it.
const GROCERY = sheet([
  ["step", "users_entering", "users_leaving", "percent_lost"],
  ["Basket filled", "10000", "0", "0"],
  ["Picked a delivery slot", "10000", "4400", "44"],
  ["Address confirmed", "5600", "560", "10"],
  ["Payment page reached", "5040", "454", "9"],
  ["Order placed", "4586", "0", "0"],
]);

it("keeps a2's sheet as the sample has it", () => expect(GROCERY).toBe(GROCERY_FUNNEL));

// A SaaS signup: only how many did each step.
const SIGNUP = sheet([
  ["Funnel step", "Users"],
  ["Signed up", "5,000"],
  ["Verified email", "4,100"],
  ["Created workspace", "2,300"],
  ["Invited a teammate", "900"],
]);

// A lending application: only each stage's conversion, in percent.
const LENDING = sheet([
  ["Stage", "Conversion rate"],
  ["Application started", "100%"],
  ["ID uploaded", "65%"],
  ["Income verified", "92%"],
  ["Loan signed", "40%"],
]);

describe("reading a sheet back", () => {
  it("finds its rows as tableText wrote them, with where each is", () => {
    const [rows] = tablesIn(`Notes first\n${GROCERY}\nAnd after.`);
    expect(rows).toHaveLength(5);
    expect(rows[1].cells.get("step")).toBe("Picked a delivery slot");
    const text = `Notes first\n${GROCERY}\nAnd after.`;
    expect(text.slice(...rows[1].span)).toBe(rows[1].text);
  });

  it("reads numbers as people write them", () => {
    expect([numberOf("10,000"), numberOf("4.5"), numberOf("44%"), numberOf("Q4"), numberOf("")]).toEqual([{ value: 10000, percent: false }, { value: 4.5, percent: false }, { value: 44, percent: true }, null, null]);
  });
});

describe("a funnel from a sheet", () => {
  it("reads a2's checkout: each step's loss as the sheet says it", () => {
    const [f] = funnelsIn(GROCERY, "a2-funnel", "src1");
    expect(f.first).toBe(10000);
    expect(f.steps.map((s) => s.lost)).toEqual([0, 4400, 560, 454, 0]);
    expect(f.steps.map((s) => s.share)).toEqual([0, 0.44, 0.1, 0.09, 0]);
    expect(lossBy(f)).toBe("lost");
    expect(f.steps[biggestDrop(f)].label).toBe("Picked a delivery slot");
  });

  it("works out a signup's losses from its counts: those who did the step before and not this one", () => {
    const [f] = funnelsIn(SIGNUP, "Signup funnel");
    expect(f.steps.map((s) => s.lost)).toEqual([null, 900, 1800, 1400]);
    expect(f.steps[biggestDrop(f)].label).toBe("Created workspace");
  });

  it("reads a lending application from its conversion rates alone", () => {
    const [f] = funnelsIn(LENDING, "Applications");
    expect(f.first).toBeNull();
    expect(lossBy(f)).toBe("share");
    expect(f.steps[biggestDrop(f)].label).toBe("Loan signed");
    expect(f.steps.map((s) => s.share)).toEqual([0, 0.35, expect.closeTo(0.08, 5), 0.6]);
  });

  it("never reads months, or a table that only happens to go down, as a funnel", () => {
    expect(funnelsIn(sheet([["month", "revenue"], ["Jan 2026", "12000"], ["Feb 2026", "11000"], ["Mar 2026", "9000"]]), "Revenue")).toEqual([]);
    expect(funnelsIn(sheet([["plan", "churned", "customers"], ["Basic", "120", "2000"], ["Pro", "40", "800"], ["Team", "10", "300"]]), "Plans")).toEqual([]);
    expect(funnelsIn(sheet([["name", "score", "comment"], ["Sara", "3", "No slots"], ["Omar", "8", "Fine"], ["Leila", "6", "Fees came late"]]), "NPS")).toEqual([]);
  });

  it("takes a goal's funnel from the analytics tool", () => {
    const f = funnelOfNumbers({ at: 1, insight: { ref: "1", name: "First checkout" }, steps: [{ label: "Viewed basket", count: 8000 }, { label: "Picked slot", count: 4200 }, { label: "Paid", count: 3900 }, { label: "Ordered", count: 3800 }] }, "g1")!;
    expect(f.steps.map((s) => s.lost)).toEqual([null, 3800, 300, 100]);
    expect(f.steps[biggestDrop(f)].label).toBe("Picked slot");
  });
});

describe("which steps words name", () => {
  const [grocery] = funnelsIn(GROCERY, "a2-funnel");
  const [signup] = funnelsIn(SIGNUP, "Signup funnel");
  const label = (f: typeof grocery, words: string) => stepsNamed(f, words).map((i) => f.steps[i].label);

  it("goes by each step's own words, not how the funnel counts", () => {
    expect(stepWords(grocery)).toEqual([["basket"], ["delivery", "slot"], ["addres"], ["pay"], ["ord"]]);
    expect(label(grocery, "Apple Pay and Google Pay")).toEqual(["Payment page reached"]);
    expect(label(grocery, "Paying for my first order feels clunky")).toEqual(["Payment page reached", "Order placed"]);
    expect(label(grocery, "Show evening slots before the address")).toEqual(["Picked a delivery slot", "Address confirmed"]);
    expect(label(grocery, "Make checkout feel faster")).toEqual([]);
  });

  it("names a signup's steps by theirs", () => {
    expect(label(signup, "Remind people by email to verify")).toEqual(["Verified email"]);
    expect(label(signup, "Start new teams from workspace templates")).toEqual(["Created workspace"]);
  });
});
