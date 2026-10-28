import { describe, expect, it } from "vitest";
import { aboutFromMarkdown, aboutToMarkdown, contextText, legacyGoals, productFromMarkdown, productToMarkdown, type Product } from "./context-md";

const grocery: Product = {
  id: "pGrocery1",
  name: "Grocery app",
  audience: "Families in Dubai and Abu Dhabi who shop weekly.",
  context: "40 dark stores. Delivery in 30 minutes.",
  segments: ["Parents", "Young professionals"],
};

describe("product files", () => {
  it("writes readable Markdown and reads it back", () => {
    const md = productToMarkdown(grocery);
    expect(md).toBe(
      '---\nid: "pGrocery1"\nname: "Grocery app"\n---\n\n## Who it\'s for\n\nFamilies in Dubai and Abu Dhabi who shop weekly.\n\n## Context\n\n40 dark stores. Delivery in 30 minutes.\n\n## Segments\n\n- Parents\n- Young professionals\n',
    );
    expect(productFromMarkdown(md)).toEqual(grocery);
  });

  it("reads a file edited by hand: any case, other bullets, sections it doesn't know kept", () => {
    const md = `---\nid: pX\nname: Rider app\n---\nWritten before any heading.\n\n## WHO IT'S FOR\nCouriers.\n\n## Segments\n* Night riders\n1. Weekend riders\n\n## Open questions\n- Do riders want shifts?\n`;
    const p = productFromMarkdown(md)!;
    expect(p).toMatchObject({ id: "pX", name: "Rider app", audience: "Couriers.", context: "", segments: ["Night riders", "Weekend riders"] });
    expect(p.notes).toBe("Written before any heading.\n\n## Open questions\n\n- Do riders want shifts?");
    // Writing it again keeps those notes.
    expect(productFromMarkdown(productToMarkdown(p))).toEqual(p);
  });

  it("keeps the goals of a file from before goals.md as a note, for moving them there", () => {
    const md = `---\nid: pX\nname: Rider app\n---\n\n## goals\n* On-time pickup 90%\n1. Fewer cancelled orders\n\n## Open questions\n- Do riders want shifts?\n`;
    const p = productFromMarkdown(md)!;
    expect(p.notes).toContain("## goals");
    const { goals, rest } = legacyGoals(p);
    expect(goals).toEqual(["On-time pickup 90%", "Fewer cancelled orders"]);
    expect(rest.notes).toBe("## Open questions\n\n- Do riders want shifts?");
    expect(legacyGoals(grocery)).toEqual({ goals: [], rest: grocery });
  });

  it("refuses a file without an id", () => {
    expect(productFromMarkdown("## Goals\n- x\n")).toBeNull();
  });

  it("leaves out empty sections", () => {
    expect(productToMarkdown({ id: "p1", name: "New", audience: "", context: "", segments: [] })).toBe('---\nid: "p1"\nname: "New"\n---\n\n');
  });
});

describe("about.md", () => {
  it("uses the organization's headings", () => {
    const md = aboutToMarkdown({ audience: "Shoppers and riders.", context: "Grocery delivery in the UAE.", segments: [] });
    expect(md).toContain("## Who we serve");
    expect(md).toContain("## What we do");
    expect(aboutFromMarkdown(md)).toEqual({ audience: "Shoppers and riders.", context: "Grocery delivery in the UAE.", segments: [] });
  });
});

describe("contextText", () => {
  it("gives Qalam AI the lines that have something", () => {
    expect(contextText(grocery, "The product (Grocery app):")).toBe(
      "The product (Grocery app):\nWho it's for: Families in Dubai and Abu Dhabi who shop weekly.\nContext: 40 dark stores. Delivery in 30 minutes.\nSegments: Parents; Young professionals",
    );
    expect(contextText({ audience: "", context: "", segments: [] }, "x")).toBe("");
    expect(contextText(null, "x")).toBe("");
  });
});
