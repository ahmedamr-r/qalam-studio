import { describe, expect, it } from "vitest";
import { askTurnCall } from "@/ai/asking";
import { CONSULT_TASK, consultFields, playbookBlock, situationCall } from "@/ai/consult";
import { capFor, reflects, teaches } from "./pace";
import { consultRound } from "./round";
import { guessLayer, levelOf, pastBasics, sanitizeSituation, simpler, situationLine, situationOf } from "./situation";

describe("reading who's asking", () => {
  // The same read, on four kinds of product: a delivery app's page, a bank's transfer screen, a SaaS step, a clinic's booking.
  const cases = [
    {
      said: "I want to work on a problem on my basket page in my delivery app",
      raw: { said: "named", product: "", name: "Delivery app", role: "", position: "founder", level: "new", stage: "running", theirs: "yes", whose: "unsure", layer: "page" },
      want: { name: "Delivery app", role: "", level: "new", theirs: "yes", layer: "page" },
    },
    {
      said: "I'm the PM for transfers at our bank's app, and new-payee transfers dropped since the last release",
      raw: { said: "named", product: "", name: "Bank transfers", role: "PM for transfers", position: "pm", level: "seasoned", stage: "running", theirs: "yes", whose: "team", layer: "page" },
      want: { role: "PM for transfers", position: "pm", level: "seasoned", whose: "team", layer: "page" },
    },
    {
      said: "We run a SaaS for bookkeepers and fewer people finish connecting their bank during onboarding",
      raw: { said: "named", product: "", name: "Bookkeeping SaaS", role: "", position: "", level: "some", stage: "growing", theirs: "yes", whose: "team", layer: "page" },
      want: { name: "Bookkeeping SaaS", stage: "growing", whose: "team", layer: "page" },
    },
    {
      said: "I own a dental clinic and I want more people to book online",
      raw: { said: "named", product: "", name: "Dental clinic bookings", role: "owns a dental clinic", position: "founder", level: "new", stage: "running", theirs: "yes", whose: "unsure", layer: "grow" },
      want: { role: "owns a dental clinic", position: "founder", level: "new", layer: "grow" },
    },
  ];

  it("keeps a read on four kinds of product", () => {
    for (const c of cases) expect(sanitizeSituation(c.raw, c.said), c.said).toMatchObject(c.want);
  });

  it("keeps a position only where they said something of their role, and a role only in words they used", () => {
    expect(sanitizeSituation(cases[0].raw, cases[0].said).position).toBeUndefined();
    const made = sanitizeSituation({ ...cases[3].raw, role: "head of marketing", position: "product-lead" }, cases[3].said);
    expect(made.role).toBe("");
    expect(made.position).toBeUndefined();
  });

  it("falls back on what code can tell from the words when a read says nothing it can keep", () => {
    const s = sanitizeSituation({ level: "expert", layer: "checkout" }, "My delivery app's checkout is losing people");
    expect(s).toMatchObject({ level: "some", theirs: "yes", layer: "page", stage: "running" });
    expect(situationOf("We want more orders from our shop")).toMatchObject({ whose: "team", theirs: "yes", layer: "grow" });
    expect(guessLayer("I have an idea for a meal planner")).toBe("idea");
    expect(guessLayer("How should we think about our business?")).toBe("business");
  });

  it("goes by what they set over any reading, and steps a level each way", () => {
    expect(levelOf({ set: { level: "seasoned", by: "you" }, read: "new" })).toBe("seasoned");
    expect(levelOf({ set: { level: "seasoned", by: "qalam" }, read: "new" })).toBe("new");
    expect(levelOf({ set: { level: "new", by: "qalam" } })).toBe("new");
    expect(levelOf({})).toBe("some");
    expect([simpler("seasoned"), simpler("some"), simpler("new")]).toEqual(["some", "new", "new"]);
    expect([pastBasics("new"), pastBasics("some"), pastBasics("seasoned")]).toEqual(["some", "seasoned", "seasoned"]);
  });

  it("tells Qalam AI who's asking in a line", () => {
    const line = situationLine(sanitizeSituation(cases[3].raw, cases[3].said));
    expect(line).toContain("owns a dental clinic");
    expect(line).toContain("plain words");
    expect(line).toContain("It's their own product or business.");
  });
});

describe("pacing for who's asking", () => {
  it("holds a few questions at a time for someone new, and teaches only those who aren't seasoned", () => {
    expect([capFor("new"), capFor("some"), capFor("seasoned")]).toEqual([3, 5, undefined]);
    expect([teaches("new"), teaches("seasoned"), reflects("some"), reflects("seasoned")]).toEqual([true, false, true, false]);
  });

  it("asks open questions of its own only as a fallback, for where they came in", () => {
    for (const layer of ["page", "business", "idea", "grow"] as const) {
      const r = consultRound(layer);
      expect(r.length).toBeGreaterThan(0);
      for (const q of r) expect(q.options).toEqual([]);
    }
    expect(consultRound("page")[0].title).toMatch(/what's happening/i);
  });
});

describe("the consultant's prompts", () => {
  it("hear every playbook's index, and the one in use as a block of its own", () => {
    for (const id of ["page", "business", "idea", "grow"]) expect(CONSULT_TASK).toContain(`- ${id}: `);
    const call = askTurnCall({ flow: "consult", who: "person", material: "x", playbook: playbookBlock("page") });
    expect(call.system).toHaveLength(3);
    expect(call.system[1]).toBe(CONSULT_TASK);
    expect(call.system[2]).toContain("A problem on a page or a step");
    expect(askTurnCall({ flow: "plan", who: "team", material: "x" }).system).toHaveLength(2);
  });

  it("never asks for a confirmation, and never looks before an answer", () => {
    expect(CONSULT_TASK).toContain("never ask them to confirm what they just said");
    expect(CONSULT_TASK).toContain("never before they've answered anything");
  });

  it("answer in the fields code reads", () => {
    const f = consultFields() as Record<string, { properties?: Record<string, unknown> }>;
    expect(Object.keys(f)).toEqual(["situation", "playbook", "business"]);
    const s = situationCall("my app").schema as { properties: Record<string, unknown> };
    expect(Object.keys(s.properties)).toEqual(["said", "product", "name", "role", "position", "level", "stage", "theirs", "whose", "layer"]);
  });
});
