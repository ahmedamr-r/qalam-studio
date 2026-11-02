import { describe, expect, it } from "vitest";
import { emptyMarket } from "@/market/types";
import { ideasMaterial, nowFrom, withUnit, numberMaterial, numberRound, problemAsTopic, sanitizeIdeas, sanitizeNumber, targetFrom } from "./moves";
import type { Benchmark } from "./outside";

const page = { ref: "", url: "https://example.com/grocery", title: "Grocery benchmarks", text: "Across grocery apps in 2025, 54% of people who open the app start a basket. Fixing search lifted it by 6 points at one retailer." };
const material = (pages = [page]) => ideasMaterial({ org: "Basket", about: "A grocery app.", market: emptyMarket(), problem: "I open the app but never start a basket", words: ["41% of sessions start a basket"], goals: ["Weekly orders grow"], notes: "", pages });
const o = { problem: "I open the app but never start a basket", words: ["41% of sessions start a basket"], goals: ["Weekly orders grow"], now: 1, id: () => "i" };

describe("the goals proposed for a problem", () => {
  it("keeps a goal with what to measure, and what others report only where its page has it", () => {
    const r = sanitizeIdeas(
      {
        goals: [
          {
            title: "More people who open the app start a basket",
            metric_name: "Basket starts per open",
            unit: "%",
            direction: "increase",
            why: "It's the very step they don't take.",
            others: [
              { what: "Opens that start a basket", value: 54, unit: "%", who: "Grocery apps, 2025", quote: "54% of people who open the app start a basket", page: "w1" },
              { what: "Made up", value: 90, unit: "%", who: "Nobody", quote: "90% of people love baskets", page: "w1" },
            ],
          },
        ],
      },
      material(),
      o,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "More people who open the app start a basket", metric: { name: "Basket starts per open", unit: "%", direction: "increase" } });
    expect(r[0].others.map((b) => b.value)).toEqual([54]);
  });

  it("keeps a goal with no page behind it, since a goal is a choice: it just has nothing others report", () => {
    const r = sanitizeIdeas({ goals: [{ title: "More people start a basket", metric_name: "Basket starts", unit: "", direction: "increase", why: "", others: [] }] }, material([]), o);
    expect(r[0].others).toEqual([]);
  });

  it("leaves out a goal they have, one with nothing to measure, and a number nothing it read has", () => {
    const why: string[] = [];
    const r = sanitizeIdeas(
      {
        goals: [
          { title: "Weekly orders grow", metric_name: "Orders", direction: "increase", others: [] },
          { title: "More baskets", metric_name: "", direction: "increase", others: [] },
          { title: "Reach 77% basket starts", metric_name: "Starts", direction: "increase", others: [] },
        ],
      },
      material(),
      o,
      (w) => why.push(w),
    );
    expect(r).toEqual([]);
    expect(why).toHaveLength(3);
  });
});

describe("a goal's number", () => {
  it("asks only what it doesn't have, and nothing once it has a target", () => {
    expect(numberRound(undefined).map((q) => q.id)).toEqual(["name", "now", "target"]);
    expect(numberRound({ name: "Basket starts" }).map((q) => q.id)).toEqual(["now", "target"]);
    expect(numberRound({ name: "Basket starts", current: 41 }).map((q) => q.id)).toEqual(["target"]);
    expect(numberRound({ name: "Basket starts", current: 41, target: 50 })).toEqual([]);
    expect(numberRound({ name: "Basket starts" }).every((q) => !q.options.length)).toBe(true);
  });

  it("reads what they said: the first number for where it stands, the last for where it should go", () => {
    expect(nowFrom("about 41%, maybe")).toBe(41);
    expect(nowFrom("5k a week")).toBe(5000);
    expect(nowFrom("no idea")).toBeNull();
    expect(targetFrom("from 40 to 55", { now: null, unit: "%" })).toEqual({ target: 55, move: null });
    expect(targetFrom("no, not really", { now: 40 })).toBeNull();
  });

  it("takes a percent for a number that isn't one as how far to move it, and code works out the target", () => {
    expect(targetFrom("up 20%", { now: 5000, unit: "orders" })).toEqual({ target: 6000, move: 20 });
    expect(targetFrom("down 10%", { now: 200, unit: "minutes", direction: "decrease" })).toEqual({ target: 180, move: 10 });
    expect(targetFrom("up 20%", { now: null, unit: "orders" })).toEqual({ target: null, move: 20 });
    expect(targetFrom("55%", { now: 41, unit: "%" })).toEqual({ target: 55, move: null });
  });

  it("reads a problem with no page as a page of its card's words, the title when nothing else is known", () => {
    expect(problemAsTopic({ id: "c", title: "Never start", words: ["41% of sessions", "41% of sessions"], now: 1 }).lines.map((l) => l.text)).toEqual(["41% of sessions"]);
    expect(problemAsTopic({ id: "c", title: "Never start", words: [], now: 1 }).lines.map((l) => l.text)).toEqual(["Never start"]);
  });
});

describe("a suggested number", () => {
  const b: Benchmark = { id: "b1", what: "Opens that start a basket", value: 54, unit: "%", who: "Grocery apps, 2025", quote: "54% of people who open the app start a basket", url: "https://example.com", title: "Benchmarks", at: 1 };
  const metric = { name: "Basket starts", unit: "%", direction: "increase" as const };
  const m = (now: number | null) => numberMaterial({ org: "Basket", about: "", market: emptyMarket(), goal: "More people start a basket", metric, now, problem: "Never start", others: [b] });

  it("keeps a target resting on what others report, and says so", () => {
    const s = sanitizeNumber({ target: 50, move: null, timeframe: "in 6 months", why: "Grocery apps reach 54%, so 50 is within reach from 41.", others: ["b1"] }, m(41));
    expect(s).toMatchObject({ target: 50, timeframe: "in 6 months" });
    expect(s?.others).toEqual([b]);
    expect(s?.why).toContain("54%");
  });

  it("keeps one from what Qalam AI knows too, which rests on nothing it can show, and takes a number out of its reason", () => {
    const s = sanitizeNumber({ target: 50, move: null, timeframe: "", why: "Most apps see 63% in my experience.", others: [] }, m(41));
    expect(s).toMatchObject({ target: 50, others: [], why: "" });
    expect(sanitizeNumber({ target: 50, move: null, timeframe: "", why: "From what I know of companies like yours.", others: [] }, m(41))?.why).toBe("From what I know of companies like yours.");
  });

  it("turns a move into a target by code's arithmetic where it knows where it stands, and keeps it a move where it doesn't", () => {
    expect(sanitizeNumber({ target: null, move: 20, timeframe: "", why: "", others: [] }, m(40))).toMatchObject({ target: 48, move: 20 });
    expect(sanitizeNumber({ target: null, move: 20, timeframe: "", why: "", others: [] }, m(null))).toMatchObject({ target: null, move: 20 });
  });

  it("refuses a target on the wrong side of where it stands, and answers nothing with no number", () => {
    expect(sanitizeNumber({ target: 30, move: null, why: "", others: [] }, m(41))).toBeNull();
    expect(sanitizeNumber({ target: null, move: null, why: "", others: [] }, m(41))).toBeNull();
  });

  it("keeps a reason of a few sentences: it's what says why this number", () => {
    const why = `Grocery apps reach 54%. ${"Fixing slots that run out removes part of what people give up on. ".repeat(5)}`.trim();
    expect(why.length).toBeGreaterThan(300);
    expect(sanitizeNumber({ target: 50, move: null, why, others: ["b1"] }, m(41))?.why).toBe(why);
  });

  it("writes a number with its unit as a person would", () => {
    expect(withUnit(30, "%")).toBe("30%");
    expect(withUnit(1200, "orders a week")).toBe("1,200 orders a week");
    expect(withUnit(30)).toBe("30");
  });

  it("leaves out what others report that it wasn't sent", () => {
    expect(sanitizeNumber({ target: 50, move: null, why: "", others: ["b9"] }, m(41))?.others).toEqual([]);
  });
});
