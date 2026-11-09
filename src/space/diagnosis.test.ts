import { describe, expect, it } from "vitest";
import { planCall, planSchema } from "@/ai/canvas-plan";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, addChild, makeCardNode, newCard } from "@/discovery/ops";
import { CHILD_KINDS, canHold, defaultChildKind, stageLabel } from "@/discovery/kinds";
import { stageItem } from "@/discovery/metrics";
import { applyProposal } from "@/discovery/proposals";
import { isCheck, kindLabel } from "@/discovery/tree";
import { planLine, planMaterial, planProposals, sanitizePlan, type OutlineCard, type PlanAnswer } from "./plan";

/* A consultant's diagnosis (src/consult/): the goal it moves, likely causes, a Check under each; fixes only when asked. */

let n = 0;
const id = () => `id${++n}`;
const card = (over: Record<string, unknown> = {}) => ({ ref: "n1", kind: "opportunity", under: "", title: "", description: "", why: "", type: "none", how: "", needed: "no", helps: [], cites: [], metric: { name: "", target: "" }, assumptions: [], test: { assumption: "", what: "", how: "", pass: "" }, check: { what: "", how: "", pass: "" }, ...over });
const sent = (said: string, answers: PlanAnswer[], outline: OutlineCard[] = []) => planMaterial({ org: "X", said, outline, answers, looks: [], pieces: [] });
const keep = (raw: Record<string, unknown>, m: ReturnType<typeof sent>, o: { fixes?: boolean; shape?: "diagnosis" | "goals" } = {}) => {
  const dropped: string[] = [];
  const d = sanitizePlan({ start: "", doubt: "", ...raw }, m, { id, shape: o.shape ?? "diagnosis", ...(o.fixes ? { fixes: true } : {}) }, (why) => dropped.push(why));
  return { ...d, dropped };
};

describe("a check is a test under a problem", () => {
  it("can hang under a problem, is called Check, and its stages say what it found", () => {
    expect(canHold("opportunity", "test")).toBe(true);
    expect(CHILD_KINDS.opportunity).toContain("test");
    expect(stageLabel("test", "passed", true)).toBe("Confirmed");
    expect(stageLabel("test", "failed", true)).toBe("Ruled out");
    expect(stageLabel("test", "passed")).toBe("Passed");
    expect(stageItem(newCard("test", { title: "x", check: true, stage: "failed" } as never)).text).toBe("Ruled out");
  });

  it("doesn't change what a problem holds next: a check under it, then a problem or a solution", () => {
    const p = newCard("opportunity", { title: "Fee shows late" });
    expect(defaultChildKind(p, ["test"])).toBe("opportunity");
    expect(defaultChildKind({ ...p, stage: "target" }, ["test"])).toBe("solution");
    expect(defaultChildKind(p, ["solution", "test"])).toBe("solution");
  });

  it("names a test under a problem a Check on the canvas", () => {
    const doc = emptyDoc();
    const problem = makeCardNode(newCard("opportunity", { title: "Fee shows late" }));
    addCardIn(doc, problem, null);
    const check = makeCardNode(newCard("test", { title: "Orders before and after the fee" }));
    addCardIn(doc, check, problem.id);
    expect(isCheck(doc, check.id)).toBe(true);
    expect(kindLabel(doc, check.id)).toBe("Check");
    void addChild;
  });
});

describe("a diagnosis as code keeps it", () => {
  // A delivery app's basket page: the goal under the North Star, three causes with checks, no solutions.
  const north: OutlineCard = { id: "G0", kind: "outcome", title: "Revenue from orders", parent: null, north: true };
  const delivery = sent("A problem on my basket page", [
    { question: "What changed?", answer: "We raised the delivery fee from 15 to 25 pounds about a month ago", how: "own" },
    { question: "Where do they first see the fee?", answer: "Only on the basket page", how: "own" },
  ], [north]);

  it("hangs the goal under the North Star, keeps a check under each cause, starts with one, and drops solutions nobody asked for", () => {
    const d = keep(
      {
        cards: [
          card({ ref: "n1", kind: "outcome", title: "More basket openers go on to order", metric: { name: "Orders a day", target: "" } }),
          card({ ref: "n2", under: "n1", title: "The fee surprises people at the basket", cites: ["a2"], check: { what: "Orders before and after the fee", how: "Compare daily orders the week before and after the fee went to 25.", pass: "Orders fell right after it" } }),
          card({ ref: "n3", under: "n1", title: "The new fee is too high for small orders", cites: ["a1"], check: { what: "Ask five who left", how: "Ask five people who left at the basket why.", pass: "Most name the fee" } }),
          card({ ref: "n4", under: "n1", title: "Items run out after they're added", check: { what: "Count removed items", how: "Count items removed as out of stock this month.", pass: "" } }),
          card({ ref: "n5", kind: "solution", under: "n2", title: "Show the fee on the menu", type: "change" }),
        ],
        start: "n2",
      },
      delivery,
    );
    expect(d.cards.map((c) => [c.ref, c.kind])).toEqual([
      ["n1", "outcome"],
      ["n2", "opportunity"],
      ["n3", "opportunity"],
      ["n4", "opportunity"],
    ]);
    expect(d.cards[0].under).toEqual({ card: "G0" });
    expect(d.cards[1].check).toEqual({ what: "Orders before and after the fee", how: "Compare daily orders the week before and after the fee went to 25.", suggested: "Orders fell right after it" });
    // A check is a plan: its own numbers (how many people to ask) are its own.
    expect(d.cards[2].check?.how).toContain("five");
    expect(d.cards[3].check?.suggested).toBeNull();
    expect(d.start).toBe("n2");
    expect(d.dropped).toContain("no solutions in a diagnosis until a check shows a cause is real");

    const proposals = planProposals(d, { doc: emptyDoc(), things: new Map(), pages: {}, now: 1, id });
    const checks = proposals.flatMap((p) => (p.kind === "card" && p.card.kind === "test" ? [p] : []));
    expect(checks).toHaveLength(3);
    expect(checks.every((c) => c.card.check)).toBe(true);
    expect(checks.find((c) => c.id === "check:n2")?.card.start).toBe(true);
    expect(proposals.find((p) => p.id === "plan:n2" && p.kind === "card" && p.card.start)).toBeUndefined();
    expect(planLine(proposals)).toBe("1 goal, 3 problems and 3 checks");

    // Accepted, each check lands under its problem.
    const doc = emptyDoc();
    const northNode = makeCardNode(newCard("outcome", { title: "Revenue from orders" }));
    addCardIn(doc, northNode, null);
    const pr = planProposals({ ...d, cards: d.cards.map((c) => (c.under && "card" in c.under ? { ...c, under: { card: northNode.id } } : c)) }, { doc, things: new Map(), pages: {}, now: 1, id });
    for (const p of pr) expect(applyProposal(doc, p, () => null), p.id).toBe(true);
    const placed = Object.values(doc.nodes).filter((x) => x.meta.ost?.kind === "test");
    expect(placed).toHaveLength(3);
    for (const t of placed) expect(doc.nodes[t.parentId!]?.meta.ost?.kind).toBe("opportunity");
  });

  it("keeps at most two goals and four causes", () => {
    const cards = [card({ ref: "g1", kind: "outcome", title: "Revenue from orders" }), card({ ref: "g2", kind: "outcome", under: "g1", title: "More basket openers order" }), card({ ref: "g3", kind: "outcome", title: "More repeat orders" }), ...[1, 2, 3, 4, 5].map((i) => card({ ref: `p${i}`, under: "g2", title: `Cause number ${["one", "two", "three", "four", "five"][i - 1]} at the basket` }))];
    const d = keep({ cards }, sent("basket", []));
    expect(d.cards.filter((c) => c.kind === "outcome")).toHaveLength(2);
    expect(d.cards.filter((c) => c.kind === "opportunity")).toHaveLength(4);
  });

  // A bank's transfer screen: a figure nobody gave comes out of a cause's words.
  it("holds a cause's words to what was sent, on a bank's transfer screen", () => {
    const m = sent("New-payee transfers dropped since the last release", [{ question: "What changed?", answer: "We added a second confirmation step in release 4.2", how: "own" }]);
    const d = keep({ cards: [card({ ref: "p1", title: "The second confirmation loses 40% of people", check: { what: "Funnel before and after 4.2", how: "Compare completion before and after release 4.2.", pass: "" } })] }, m);
    expect(d.cards[0]?.title ?? "").not.toContain("40%");
  });

  // A SaaS onboarding step, with fixes asked for: one solution under the likeliest cause.
  it("keeps one solution under a cause when they asked for fixes too", () => {
    const m = sent("Bank connection completion dropped", [{ question: "What changed?", answer: "We moved to a new open-banking provider", how: "own" }]);
    const d = keep(
      {
        cards: [
          card({ ref: "p1", title: "The new provider doesn't cover some banks", cites: ["a1"], check: { what: "Failures by bank", how: "List failed connections by bank.", pass: "" } }),
          card({ ref: "s1", kind: "solution", under: "p1", title: "Fall back to the old provider for those banks", type: "change", how: "A routing rule" }),
          card({ ref: "s2", kind: "solution", under: "p1", title: "Let people upload a statement instead", type: "feature", how: "An upload" }),
        ],
      },
      m,
      { fixes: true },
    );
    expect(d.cards.filter((c) => c.kind === "solution").map((c) => c.ref)).toEqual(["s1"]);
  });

  // A clinic: working out how the business works proposes goals alone.
  it("proposes goals alone when the playbook says goals", () => {
    const m = sent("I want more people to book", [{ question: "How does the clinic earn?", answer: "Treatment plans that need several visits", how: "own" }]);
    const d = keep({ cards: [card({ ref: "g1", kind: "outcome", title: "More treatment plans finished" }), card({ ref: "p1", under: "g1", title: "Patients don't come back" })] }, m, { shape: "goals" });
    expect(d.cards.map((c) => c.kind)).toEqual(["outcome"]);
  });

  it("asks the call for checks, and solutions only with fixes", () => {
    const m = sent("basket", []);
    const kinds = (o: Parameters<typeof planSchema>[1]) => (planSchema(m, o) as unknown as { properties: { cards: { items: { properties: { kind: { enum: string[] }; check?: unknown } } } } }).properties.cards.items.properties;
    expect(kinds({ shape: "diagnosis" }).kind.enum).toEqual(["outcome", "opportunity"]);
    expect(kinds({ shape: "diagnosis" }).check).toBeDefined();
    expect(kinds({ shape: "diagnosis", fixes: true }).kind.enum).toContain("solution");
    expect(kinds({}).check).toBeUndefined();
    expect(planCall(m, { shape: "diagnosis" }).system).toContain("No solutions: they come once a check shows a cause is real.");
  });
});
