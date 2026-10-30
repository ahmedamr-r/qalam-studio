import { describe, expect, it } from "vitest";
import { aboutFromMarkdown, aboutToMarkdown, contextShape, contextText, goalId, newGoal, productFromMarkdown, productToMarkdown, type Product } from "./context-md";

const grocery: Product = {
  id: "pGrocery1",
  name: "Grocery app",
  audience: "Families in Dubai and Abu Dhabi who shop weekly.",
  goals: ["Reach 2M AED a month in orders", "Half of new customers order again within 14 days"].map(newGoal),
  context: "40 dark stores. Delivery in 30 minutes.",
  segments: ["Parents", "Young professionals"],
};

describe("product files", () => {
  it("writes readable Markdown and reads it back", () => {
    const md = productToMarkdown(grocery);
    expect(md).toBe(
      '---\nid: "pGrocery1"\nname: "Grocery app"\n---\n\n## Who it\'s for\n\nFamilies in Dubai and Abu Dhabi who shop weekly.\n\n## Goals\n\n- Reach 2M AED a month in orders\n- Half of new customers order again within 14 days\n\n## Context\n\n40 dark stores. Delivery in 30 minutes.\n\n## Segments\n\n- Parents\n- Young professionals\n',
    );
    expect(productFromMarkdown(md)).toEqual(grocery);
  });

  it("reads a file edited by hand: any case, other bullets, sections it doesn't know kept", () => {
    const md = `---\nid: pX\nname: Rider app\n---\nWritten before any heading.\n\n## WHO IT'S FOR\nCouriers.\n\n## goals\n* On-time pickup 90%\n1. Fewer cancelled orders\n\n## Open questions\n- Do riders want shifts?\n`;
    const p = productFromMarkdown(md)!;
    expect(p).toMatchObject({ id: "pX", name: "Rider app", audience: "Couriers.", goals: ["On-time pickup 90%", "Fewer cancelled orders"].map(newGoal), context: "", segments: [] });
    expect(p.notes).toBe("Written before any heading.\n\n## Open questions\n\n- Do riders want shifts?");
    // Writing it again keeps those notes.
    expect(productFromMarkdown(productToMarkdown(p))).toEqual(p);
  });

  it("refuses a file without an id", () => {
    expect(productFromMarkdown("## Goals\n- x\n")).toBeNull();
  });

  it("leaves out empty sections", () => {
    expect(productToMarkdown({ id: "p1", name: "New", audience: "", goals: [], context: "", segments: [] })).toBe('---\nid: "p1"\nname: "New"\n---\n\n');
  });
});

describe("about.md", () => {
  it("uses the organization's headings", () => {
    const md = aboutToMarkdown({ audience: "Shoppers and riders.", goals: [newGoal("2M AED a month")], context: "Grocery delivery in the UAE.", segments: [] });
    expect(md).toContain("## Who we serve");
    expect(md).toContain("## What we do");
    expect(aboutFromMarkdown(md)).toEqual({ audience: "Shoppers and riders.", goals: [newGoal("2M AED a month")], context: "Grocery delivery in the UAE.", segments: [] });
  });
});

describe("goals", () => {
  it("are named by their words until they change, then keep their id in a comment Markdown doesn't show", () => {
    const g = { id: goalId("More families reorder every week"), text: "More families reorder every week each month", measure: "weekly reorders per customer", by: "March", owner: "Sara" };
    const md = productToMarkdown({ ...grocery, goals: [g] });
    expect(md).toContain(`## Goals\n\n- More families reorder every week each month <!-- qalam {"id":"${g.id}"} -->\n  - Measured by: weekly reorders per customer\n  - By: March\n  - Owner: Sara\n`);
    expect(productFromMarkdown(md)!.goals).toEqual([g]);
  });

  it("reads details written by hand, keeps lines under a goal it doesn't know, and tells the same words twice apart", () => {
    const md = `---\nid: pX\nname: Rider app\n---\n## Goals\n- On-time pickup 90%\n    * measure: pickups on time\n    * owner : Omar\n  Riders asked for it in May.\n- Fewer cancelled orders\n- Fewer cancelled orders\n`;
    const p = productFromMarkdown(md)!;
    expect(p.goals).toEqual([
      { id: goalId("On-time pickup 90%"), text: "On-time pickup 90%", measure: "pickups on time", owner: "Omar", more: "  Riders asked for it in May." },
      { id: goalId("Fewer cancelled orders"), text: "Fewer cancelled orders" },
      { id: `${goalId("Fewer cancelled orders")}-2`, text: "Fewer cancelled orders" },
    ]);
    expect(productFromMarkdown(productToMarkdown(p))).toEqual(p);
  });
});

describe("strategy, alternatives and constraints", () => {
  it("are sections of their own, read back", () => {
    const p: Product = { ...grocery, strategy: "Be the fastest in every neighbourhood we serve.", alternatives: ["Carrefour app", "The corner shop"], constraints: ["No alcohol", "Delivery fee stays under 10 AED"] };
    const md = productToMarkdown(p);
    expect(md).toContain("## Strategy\n\nBe the fastest in every neighbourhood we serve.");
    expect(md).toContain("## What customers use instead\n\n- Carrefour app\n- The corner shop");
    expect(md).toContain("## Constraints\n\n- No alcohol\n- Delivery fee stays under 10 AED");
    expect(productFromMarkdown(md)).toEqual(p);
    expect(contextText(p, "x")).toContain("\nStrategy: Be the fastest in every neighbourhood we serve.\n");
    expect(contextText(p, "x")).toContain("\nWhat customers use instead: Carrefour app; The corner shop\nConstraints: No alcohol; Delivery fee stays under 10 AED");
  });
});

describe("contextShape", () => {
  it("takes goals as a window from before sends them (words), and as Qalam keeps them", () => {
    expect(contextShape({ audience: "", context: "", goals: ["Grow reorders", " "], segments: [] })).toEqual({ audience: "", context: "", goals: [newGoal("Grow reorders")], segments: [] });
    expect(contextShape({ audience: "", context: "", goals: [{ id: "gx", text: " Grow  reorders ", owner: "Sara", by: "" }], segments: [], alternatives: ["Shops"] })).toEqual({ audience: "", context: "", goals: [{ id: "gx", text: "Grow reorders", owner: "Sara" }], segments: [], alternatives: ["Shops"] });
  });

  it("refuses what isn't one", () => {
    expect(contextShape(null)).toBeNull();
    expect(contextShape({ audience: "", context: "", goals: [{ text: "" }], segments: [] })).toBeNull();
    expect(contextShape({ audience: "", context: "", goals: [], segments: [1] })).toBeNull();
    expect(contextShape({ audience: "", context: "", goals: [], segments: [], constraints: "x" })).toBeNull();
  });
});

describe("contextText", () => {
  it("gives Qalam AI the lines that have something", () => {
    expect(contextText(grocery, "The product (Grocery app):")).toBe(
      "The product (Grocery app):\nWho it's for: Families in Dubai and Abu Dhabi who shop weekly.\nGoals (the first leads): Reach 2M AED a month in orders; Half of new customers order again within 14 days\nContext: 40 dark stores. Delivery in 30 minutes.\nSegments: Parents; Young professionals",
    );
    expect(contextText({ audience: "", goals: [], context: "", segments: [] }, "x")).toBe("");
    expect(contextText(null, "x")).toBe("");
  });
});
