import { describe, expect, it } from "vitest";
import { closeDumpRound, firstRound, sanitizeRead } from "@/discovery/dump";
import type { PlanQuestion } from "@/ai/plan";
import { initialFlow } from "@/ui/ai/questionFlow";
import { toQuestion } from "@/ui/ai/plan";
import { emptyContext } from "./context-md";
import { applyLines, boardGoals, decide, goalLines, nameHolds, pendingLines, sanitizeSetup, setupSent, type OrgNow, type ProductSays, type SetupSession } from "./setup";

const nothing = (): OrgNow => ({ about: { ...emptyContext(), goals: [] }, products: [] });

const DUMP = `Basket is a grocery delivery app in Dubai and Abu Dhabi, 40 dark stores, orders in under an hour. Mostly parents with young kids who do a big weekly shop.

We also run Basket for Business: offices order their pantry restock every Monday.

The company goal this year is 2M dirhams a month in orders. For the app what matters is people coming back every week, we're at 1.3 reorders per customer. Offices churn after the first month, idk why.`;

const READ = {
  understanding: "A grocery app and an office restock service.",
  fragments: [
    { id: "f1", quote: "Basket is a grocery delivery app in Dubai and Abu Dhabi, 40 dark stores, orders in under an hour.", role: "context" },
    { id: "f2", quote: "Mostly parents with young kids who do a big weekly shop.", role: "context" },
    { id: "f3", quote: "We also run Basket for Business: offices order their pantry restock every Monday.", role: "context" },
    { id: "f4", quote: "The company goal this year is 2M dirhams a month in orders.", role: "goal" },
    { id: "f5", quote: "For the app what matters is people coming back every week, we're at 1.3 reorders per customer.", role: "goal" },
    { id: "f6", quote: "Offices churn after the first month, idk why.", role: "question" },
  ],
  challenges: [{ kind: "unmeasured", fragmentId: "f6", text: "How would you tell offices stay?" }],
  questions: [
    { id: "office-goal", title: "What should Basket for Business move?", why: "Its goal.", multi: false, options: [{ value: "retention", label: "Offices staying past month two", description: "Fewer churn." }, { value: "orders", label: "3M dirhams from offices", description: "Revenue." }], recommended: ["retention"], allowOther: true },
    { id: "where-number", title: "Where are monthly orders today?", why: "The baseline.", multi: false, options: [], recommended: [], allowOther: true },
  ] satisfies PlanQuestion[],
};

/** The dump read, a round answered (an option picked, an open question typed), and the organization as it is. */
function setup(now: OrgNow = nothing()) {
  const r = sanitizeRead(READ, DUMP, []);
  const buckets = firstRound(r.questions);
  const answers = { "office-goal": { kind: "single" as const, value: "orders" }, "where-number": { kind: "text" as const, text: "Around 1.4M a month now." } };
  let s: SetupSession = { v: 1, phase: "asking", understanding: r.understanding, challenges: r.challenges, buckets };
  s = closeDumpRound(s, { ...initialFlow(buckets[0].questions.map(toQuestion)), answers, submitted: true }, "analyzing");
  const source = { text: DUMP, quotes: r.fragments };
  return { r, s, source, sent: setupSent("Basket", source, s, now), now };
}

const line = (text: string, fragmentIds: string[], answerIds: string[] = []) => ({ text, fragmentIds, answerIds, why: "It says so." });

describe("what Qalam AI proposes", () => {
  it("names the pieces f1…, the answers a1… and the products p1…", () => {
    const grocery: ProductSays = { id: "pg", name: "Basket", ...emptyContext(), goals: [] };
    const { sent } = setup({ ...nothing(), products: [grocery] });
    expect(sent.pieces.map((p) => p.ref)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
    expect(sent.answers).toEqual([
      { ref: "a1", question: "What should Basket for Business move?", answer: "3M dirhams from offices (Revenue.)" },
      { ref: "a2", question: "Where are monthly orders today?", answer: "Around 1.4M a month now." },
    ]);
    expect(sent.products).toEqual([{ ref: "p1", product: grocery }]);
    expect(sent.said).toContain("Basket\n");
  });

  it("keeps a line only on what it cites: pieces and answers sent, quotes found, numbers theirs", () => {
    const { sent, r } = setup();
    const p = sanitizeSetup(
      {
        summary: "An About and two products.",
        about: {
          audience: line("Families in Dubai and Abu Dhabi, and offices.", ["f1", "f2", "f3"]),
          context: line("Grocery delivery from 40 dark stores, in under an hour.", ["f1"]),
          goals: [
            line("2M dirhams a month in orders", ["f4"]),
            // The number isn't in what it cites.
            line("2.5M dirhams a month in orders", ["f4"]),
            // Cites nothing that was sent.
            line("Win Abu Dhabi", ["f99"]),
            // An option they picked is their answer, numbers and all…
            line("3M dirhams a month from offices", [], ["a1"]),
            // …but not one they didn't pick.
            line("4M dirhams a month from offices", [], ["a1"]),
            // What they typed.
            line("From 1.4M a month to 2M", ["f4"], ["a2"]),
          ],
          segments: [line("Parents with young kids", ["f2"]), line("Parents saying “we hate substitutions”", ["f2"])],
        },
        products: [],
      },
      sent,
    );
    expect(p.summary).toBe("An About and two products.");
    expect(p.lines.map((l) => [l.field, l.text])).toEqual([
      ["audience", "Families in Dubai and Abu Dhabi, and offices."],
      ["context", "Grocery delivery from 40 dark stores, in under an hour."],
      ["goals", "2M dirhams a month in orders"],
      ["goals", "3M dirhams a month from offices"],
      ["goals", "From 1.4M a month to 2M"],
      ["segments", "Parents with young kids"],
    ]);
    const twoM = p.lines[2];
    expect(twoM).toMatchObject({ to: "org", pieces: [r.fragments[3].id], answers: [] });
    expect(p.lines[3].answers).toEqual([{ question: "What should Basket for Business move?", answer: "3M dirhams from offices (Revenue.)" }]);
    expect(p.lines[4].answers).toEqual([{ question: "Where are monthly orders today?", answer: "Around 1.4M a month now." }]);
  });

  it("fills a text field only where it's empty and never repeats a goal or a segment", () => {
    const grocery: ProductSays = { id: "pg", name: "Basket", ...emptyContext(), audience: "Parents.", goals: ["More customers reorder every week"] };
    const { sent } = setup({ about: { ...emptyContext(), context: "Groceries, fast.", goals: [] }, products: [grocery] });
    const p = sanitizeSetup(
      {
        about: { audience: null, context: line("Grocery delivery in Dubai.", ["f1"]), goals: [], segments: [] },
        products: [
          {
            id: "p1",
            name: "Basket",
            audience: line("Parents with young kids.", ["f2"]),
            context: line("Orders in under an hour, from 40 dark stores.", ["f1"]),
            goals: [line("More customers reorder every week", ["f5"]), line("People come back every week", ["f5"]), line("people come back, every week!", ["f5"])],
            segments: [],
          },
        ],
      },
      sent,
    );
    expect(p.lines.map((l) => [l.to, l.field, l.text])).toEqual([
      ["pg", "context", "Orders in under an hour, from 40 dark stores."],
      ["pg", "goals", "People come back every week"],
    ]);
    expect(p.products).toEqual([]);
  });

  it("adds a product only under a name they used, with a line to stand on; one there already takes its lines by id or by name", () => {
    const grocery: ProductSays = { id: "pg", name: "Basket", ...emptyContext(), goals: [] };
    const { sent } = setup({ ...nothing(), products: [grocery] });
    const fields = (goal: string, cite: string) => ({ audience: null, context: null, goals: [line(goal, [cite])], segments: [] });
    const p = sanitizeSetup(
      {
        products: [
          { id: "n1", name: "Basket for Business", why: "Offices restock.", ...fields("Offices stay past their first month", "f6"), segments: [line("Offices that restock every Monday", ["f3"])] },
          // Not their name.
          { id: "n2", name: "Basket Pro", why: "Premium.", ...fields("Sell more", "f4") },
          // Their name, but nothing kept to stand on.
          { id: "n3", name: "Dark stores", why: "Stores.", ...fields("Open 60 dark stores", "f1") },
          // The product there already, named rather than by its id.
          { id: "n4", name: "basket", why: "", ...fields("People come back every week", "f5") },
        ],
      },
      sent,
    );
    expect(p.products).toEqual([{ ref: "n1", name: "Basket for Business", why: "Offices restock." }]);
    expect(p.lines.map((l) => [l.to, l.field, l.text])).toEqual([
      ["new:n1", "goals", "Offices stay past their first month"],
      ["new:n1", "segments", "Offices that restock every Monday"],
      ["pg", "goals", "People come back every week"],
    ]);
  });

  it("reads a name's words as theirs: plurals, case, and what kind of thing it is aside", () => {
    expect(nameHolds("Basket for Business", "We also run Basket for business.")).toBe(true);
    expect(nameHolds("Basket app", "Basket")).toBe(true);
    expect(nameHolds("Offices", "an office restock")).toBe(true);
    expect(nameHolds("The app", "the app")).toBe(false);
    expect(nameHolds("Basket Pro", "Basket")).toBe(false);
    expect(nameHolds("سلة", "تطبيق سلة للبقالة")).toBe(true);
  });

  it("survives an answer that isn't the shape asked for", () => {
    const { sent } = setup();
    expect(sanitizeSetup(null, sent)).toEqual({ summary: "", products: [], lines: [] });
    expect(sanitizeSetup({ about: "x", products: [{ id: 3, name: null }, "y"] }, sent).lines).toEqual([]);
  });

  it("puts each goal under the goal it feeds, with its number only as what it cites has it", () => {
    const { sent } = setup();
    const goal = (id: string, parent: string, text: string, fragmentIds: string[], metric: unknown = null, answerIds: string[] = []) => ({ id, parent, metric, ...line(text, fragmentIds, answerIds) });
    const p = sanitizeSetup(
      {
        summary: "",
        about: { audience: null, context: null, goals: [goal("G1", "", "2M dirhams a month in orders", ["f4"], { name: "Orders a month", unit: "dirhams", direction: "increase", baseline: 1_400_000, current: null, target: 2_000_000, timeframe: "this year" }, ["a2"])], segments: [] },
        products: [
          {
            id: "n1",
            name: "Basket for Business",
            why: "",
            audience: null,
            context: null,
            goals: [
              // Feeds a goal that isn't there: it feeds none.
              goal("G3", "G9", "Offices stay past their first month", ["f6"]),
            ],
            segments: [],
          },
          {
            id: "n2",
            name: "Basket app",
            why: "",
            audience: null,
            context: null,
            // Under the company's goal; its number from what it cites, a number it doesn't cite left out.
            goals: [goal("G2", "G1", "People come back every week", ["f5"], { name: "Reorders per customer", unit: "", direction: "increase", baseline: null, current: 1.3, target: 1.6, timeframe: "by March" })],
            segments: [],
          },
        ],
      },
      sent,
    );
    const [twoM, offices, weekly] = p.lines;
    expect(twoM).toMatchObject({ text: "2M dirhams a month in orders", metric: { name: "Orders a month", unit: "dirhams", baseline: 1_400_000, current: null, target: 2_000_000 } });
    // "this year" is the dump's words; the answer said "1.4M".
    expect(twoM.metric?.timeframe).toBe("this year");
    expect(twoM.parent).toBeUndefined();
    expect(offices.parent).toBeUndefined();
    expect(weekly).toMatchObject({ parent: twoM.id, metric: { name: "Reorders per customer", current: 1.3, target: null } });
    // "March" isn't in what it cites.
    expect(weekly.metric?.timeframe).toBeUndefined();
    expect(goalLines(p).map(({ line, depth }) => [line.text, depth])).toEqual([
      ["2M dirhams a month in orders", 0],
      ["People come back every week", 1],
      ["Offices stay past their first month", 0],
    ]);
    // Two goals that say they feed each other: neither loops.
    const loop = sanitizeSetup({ summary: "", about: { audience: null, context: null, goals: [goal("G1", "G2", "2M dirhams a month in orders", ["f4"]), goal("G2", "G1", "People come back every week", ["f5"])], segments: [] }, products: [] }, sent);
    expect(loop.lines.filter((l) => l.parent)).toHaveLength(1);
    expect(goalLines(loop)).toHaveLength(2);
  });
});

describe("accepting lines", () => {
  const placed = () => {
    const { sent, s } = setup();
    const proposal = sanitizeSetup(
      {
        summary: "",
        about: { audience: line("Families in Dubai and Abu Dhabi.", ["f1", "f2"]), context: null, goals: [line("2M dirhams a month in orders", ["f4"])], segments: [] },
        products: [{ id: "n1", name: "Basket for Business", why: "", audience: line("Offices that restock their pantry.", ["f3"]), context: null, goals: [line("Offices stay past their first month", ["f6"])], segments: [] }],
      },
      sent,
    );
    return { proposal, s: { ...s, phase: "review" as const, proposal, decided: {} } };
  };

  it("writes each line where it goes, making a new product once, under its proposed name, and each goal for goals.md", () => {
    const { proposal } = placed();
    let n = 0;
    const w = applyLines(nothing(), proposal, proposal.lines, {}, () => `id${++n}`);
    expect(w.about).toEqual({ ...emptyContext(), audience: "Families in Dubai and Abu Dhabi." });
    expect(w.products).toEqual([{ id: "id1", name: "Basket for Business", ...emptyContext(), audience: "Offices that restock their pantry." }]);
    expect(w.goals.map((g) => [g.line.text, g.product])).toEqual([
      ["2M dirhams a month in orders", null],
      ["Offices stay past their first month", "id1"],
    ]);
    expect(w.made).toEqual({ n1: "id1" });
    // Accepting more later goes to the product made, as it is now.
    const later = applyLines({ ...nothing(), products: [{ ...w.products[0], goals: [] }] }, proposal, [proposal.lines[3]], w.made, () => "never");
    expect(later.goals.map((g) => [g.line.text, g.product])).toEqual([["Offices stay past their first month", "id1"]]);
    expect(later.products).toEqual([]);
  });

  it("makes a product again when it was deleted since, adds to a field filled meanwhile, and never adds a line twice", () => {
    const { proposal } = placed();
    const filled = { ...emptyContext(), audience: "Busy parents.", goals: ["2M dirhams a month in orders"] };
    const w = applyLines({ about: filled, products: [] }, proposal, proposal.lines, { n1: "gone" }, () => "fresh");
    expect(w.about).toEqual({ ...emptyContext(), audience: "Busy parents.\n\nFamilies in Dubai and Abu Dhabi." });
    expect(w.goals.map((g) => g.line.text)).toEqual(["Offices stay past their first month"]);
    expect(w.products.map((p) => p.id)).toEqual(["fresh"]);
    expect(w.made).toEqual({ n1: "fresh" });
  });

  it("is done once every line is accepted or discarded, and offers a board for each goal accepted", () => {
    const { s, proposal } = placed();
    const [audience, orgGoal, bizAudience, bizGoal] = proposal.lines;
    let next = decide(s, [orgGoal.id, bizGoal.id, "unknown"], "accepted", { n1: "id1" });
    expect(next.phase).toBe("review");
    expect(pendingLines(next).map((l) => l.id)).toEqual([audience.id, bizAudience.id]);
    expect(boardGoals(next).map((g) => [g.line.text, g.product])).toEqual([
      ["2M dirhams a month in orders", null],
      ["Offices stay past their first month", "id1"],
    ]);
    next = decide(next, [audience.id, bizAudience.id], "discarded");
    expect(next.phase).toBe("done");
    expect(next.decided).toEqual({ [orgGoal.id]: "accepted", [bizGoal.id]: "accepted", [audience.id]: "discarded", [bizAudience.id]: "discarded" });
    // A new product's goal waits for the product to be made.
    expect(boardGoals({ ...next, made: {} }).map((g) => g.line.text)).toEqual(["2M dirhams a month in orders"]);
  });
});
