import { describe, expect, it } from "vitest";
import type { OstMetric } from "@/discovery/types";
import type { PackedPiece } from "@/org/pack";
import { breakdownMaterial, sanitizeBreakdown } from "./breakdown";
import { checkParts, funnelDrops } from "./math";
import { claimsMaterial, numbersByPage, pageExcerpt, sanitizeClaims, type Benchmark } from "./outside";
import { ordered } from "./tree";
import type { Goal, GoalTree } from "./types";

const metric = (o: Partial<OstMetric> = {}): OstMetric => ({ name: "Orders a month", direction: "increase", baseline: null, current: null, target: null, ...o });

describe("whether a goal's parts add up", () => {
  it("multiplies a goal's parts, a rate as a fraction, now and at the targets", () => {
    const goal = metric({ unit: "dirhams", current: 1_400_000, target: 2_000_000 });
    const parts = [metric({ name: "Active customers", current: 20_000, target: 24_000 }), metric({ name: "Orders each", current: 2, target: 2.2 }), metric({ name: "Order value", unit: "dirhams", current: 35, target: 38 })];
    const c = checkParts(goal, parts, "product")!;
    expect(c.now).toEqual({ combined: 1_400_000, goal: 1_400_000, holds: true });
    expect(c.target?.reaches).toBe(true);
    expect(c.line).toBe("Now 20,000 × 2 × 35 dirhams = 1,400,000 dirhams, the goal's number. At their targets 24,000 × 2.2 × 38 dirhams = 2,006,400 dirhams, which reaches the goal's 2,000,000 dirhams.");
    // A funnel of rates.
    const funnel = checkParts(metric({ unit: "%", current: 12 }), [metric({ unit: "%", current: 40 }), metric({ unit: "%", current: 30 })], "product")!;
    expect(funnel.now).toEqual({ combined: 12, goal: 12, holds: true });
  });

  it("adds a goal's parts, and says when they don't make its number", () => {
    const c = checkParts(metric({ name: "Active", current: 640, target: 1000 }), [metric({ current: 400, target: 500 }), metric({ current: 150, target: 300 }), metric({ current: 30, target: 100 })], "sum")!;
    expect(c.now?.holds).toBe(false);
    expect(c.target?.reaches).toBe(false);
    expect(c.line).toBe("Now 400 + 150 + 30 = 580, but the goal's number is 640. At their targets 500 + 300 + 100 = 900, short of the goal's 1,000.");
    // Within 5% holds: rounding, a number read a day apart.
    expect(checkParts(metric({ current: 640 }), [metric({ current: 430 }), metric({ current: 180 })], "sum")?.now?.holds).toBe(true);
    expect(checkParts(metric({ current: 640 }), [metric({ current: 400 }), metric()], "sum")?.line).toBe("Code checks the arithmetic once every part has its number.");
    expect(checkParts(metric({ current: 640 }), [metric({ current: 400 })], "sum")).toBeNull();
  });

  it("marks a funnel's biggest drop", () => {
    expect(funnelDrops([{ label: "a", count: 200 }, { label: "b", count: 90 }, { label: "c", count: 60 }])).toEqual([
      { label: "a", count: 200, rate: null, biggest: false },
      { label: "b", count: 90, rate: 0.45, biggest: true },
      { label: "c", count: 60, rate: 60 / 90, biggest: false },
    ]);
    expect(funnelDrops([{ label: "a", count: 0 }, { label: "b", count: 0 }]).map((d) => d.biggest)).toEqual([false, false]);
  });
});

describe("what others aim for", () => {
  const page = { ref: "", url: "https://example.com/report", title: "Grocery report 2025", text: "Intro text about the market. ".repeat(40) + "In 2025, 38% of new grocery customers placed a second order within 30 days, up from 31%. " + "More text. ".repeat(60) };
  const notes = "- New grocery customers: 38% order again within 30 days [Grocery report 2025](https://example.com/report)\n- Unlinked: 50% of something";

  it("reads the numbers the notes give for each page, and sends the parts of the page around them", () => {
    expect(numbersByPage(notes).get("https://example.com/report")).toEqual([38, 30]);
    const excerpt = pageExcerpt(page.text, [38, 30]);
    expect(excerpt).toContain("38% of new grocery customers placed a second order within 30 days");
    expect(excerpt.length).toBeLessThan(1600);
    // No number found: the page's start.
    expect(pageExcerpt("Just words here.", [7])).toBe("Just words here.");
  });

  it("keeps a claim only when its quote is on its page and its number in the quote", () => {
    const m = claimsMaterial({ task: "A goal", notes, pages: [page] });
    expect([...m.pages.keys()]).toEqual(["w1"]);
    const dropped: string[] = [];
    const kept = sanitizeClaims(
      {
        claims: [
          { what: "New customers who order again within 30 days", value: 38, unit: "%", who: "A grocery report, 2025", quote: "38% of new grocery customers placed a second order within 30 days", page: "w1" },
          // The number isn't in the quote.
          { what: "Second orders", value: 45, unit: "%", who: "A grocery report", quote: "38% of new grocery customers placed a second order within 30 days", page: "w1" },
          // The quote isn't on the page.
          { what: "Repeat rate", value: 60, unit: "%", who: "Someone", quote: "60% of customers come back every week", page: "w1" },
          // A page that wasn't read.
          { what: "Repeat rate", value: 38, unit: "%", who: "Someone", quote: "38% of new grocery customers", page: "w9" },
          // Up from: its unit without the aside.
          { what: "Second orders the year before", value: 31, unit: "% (prior year)", who: "A grocery report, 2024", quote: "up from 31%", page: "w1" },
        ],
      },
      m,
      { now: 5 },
      (why) => dropped.push(why),
    );
    expect(kept.map((b) => [b.what, b.value, b.unit])).toEqual([
      ["New customers who order again within 30 days", 38, "%"],
      ["Second orders the year before", 31, "%"],
    ]);
    expect(kept[0]).toEqual({ id: "b1", what: "New customers who order again within 30 days", value: 38, unit: "%", who: "A grocery report, 2025", quote: "38% of new grocery customers placed a second order within 30 days", url: "https://example.com/report", title: "Grocery report 2025", at: 5 });
    expect(dropped).toEqual(["its number isn't in the quote", "its quote isn't on the page", "a page not read"]);
  });
});

describe("breaking a goal down", () => {
  const goal = (id: string, o: Partial<Goal> = {}): Goal => ({ id, title: `Goal ${id}`, parent: null, product: null, status: "active", cites: [], by: "person", at: 1, ...o });
  const tree: GoalTree = ordered({ north: "ns", goals: [goal("ns", { title: "2M dirhams a month in orders", metric: metric({ unit: "dirhams", current: 1_400_000, target: 2_000_000 }) }), goal("kept", { title: "More customers come back every week", parent: "ns", lever: "retention" })] });
  const piece = (k: string, text: string): PackedPiece => ({ k, ref: `hub:quote:${k}`, whole: true, type: "quote", sub: null, text, title: null, product: null, source: "s1", speaker: null, board: null, card: null }) as PackedPiece;
  const pieces = [piece("k1", "Only 31% of first-time customers order a second time."), piece("k2", "Lapsed customers came back when we sent a free delivery code.")];
  const bench: Benchmark = { id: "b1", what: "New customers who order again within 30 days", value: 38, unit: "%", who: "A grocery report, 2025", quote: "38% of new grocery customers placed a second order", url: "https://example.com", title: "Report", at: 1 };
  const m = breakdownMaterial({ tree, goal: tree.goals[0], context: "Basket delivers groceries in Dubai.", pack: { block: "[k1] Only 31% of first-time customers order a second time.\n[k2] Lapsed customers came back when we sent a free delivery code.", pieces }, benchmarks: [bench], levers: ["reactivation"] });

  it("sends the goal, the goals under it already, their material, the levers they picked and what others report", () => {
    expect(m.text).toContain("- North Star: 2M dirhams a month in orders · Orders a month: 1,400,000 → 2,000,000 dirhams   ← this goal");
    expect(m.text).toContain("- More customers come back every week · no number yet");
    expect(m.text).toContain("What they asked to look at: Winning back");
    expect(m.text).toContain("- o1 · A grocery report, 2025 · New customers who order again within 30 days: 38% · “38% of new grocery customers placed a second order”");
  });

  it("keeps a part only on what it cites, never a goal under it already, its number only from their words", () => {
    let n = 0;
    const dropped: string[] = [];
    const r = sanitizeBreakdown(
      {
        parts: [
          { title: "More first-time customers order a second time", lever: "activation", why: "Only 31% order again, so lifting second orders grows the active base behind orders a month.", metric: { name: "first-time customers who order a second time", unit: "%", direction: "increase", baseline: null, current: 31, target: 38, timeframe: "" }, cites: ["k1"], benchmarks: ["o1"] },
          // A goal under it already.
          { title: "More customers come back every week", lever: "retention", why: "Weekly orders make the month.", metric: null, cites: [], benchmarks: [] },
          // What others report, put in its reason.
          { title: "Win back lapsed customers", lever: "reactivation", why: "Others win back 38% of them.", metric: null, cites: ["k2"], benchmarks: ["o1"] },
          { title: "Win back lapsed customers with a free delivery code", lever: "reactivation", why: "Lapsed customers “came back when we sent a free delivery code”, adding orders without new customers.", metric: null, cites: ["k2"], benchmarks: [] },
          { title: "Not a lever", lever: "magic", why: "x", metric: null, cites: [], benchmarks: [] },
        ],
        relation: "sum",
        none: "",
      },
      m,
      { now: 1, id: () => `p${++n}` },
      (why) => dropped.push(why),
    );
    expect(r.parts.map((p) => [p.title, p.lever])).toEqual([
      ["More first-time customers order a second time", "activation"],
      ["Win back lapsed customers with a free delivery code", "reactivation"],
    ]);
    // 38 is what others report, not theirs: the target goes; 31 is theirs.
    expect(r.parts[0].metric).toMatchObject({ current: 31, target: null, unit: "%" });
    expect(r.parts[0].benchmarks.map((b) => b.value)).toEqual([38]);
    expect(r.parts[0].cites).toEqual(["hub:quote:k1"]);
    expect(r.relation).toBe("sum");
    expect(dropped).toEqual(["a goal under it already, or there twice", "its words or numbers aren't in what it cites", "not a lever"]);
  });
});
