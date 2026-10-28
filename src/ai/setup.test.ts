import { describe, expect, it } from "vitest";
import { SETUP_PLACE_SYSTEM, SETUP_READ_SYSTEM, SetupBody, setupCall, setupContent, setupPlaceSchema, setupReadSchema } from "./setup";

/** Objects whose properties aren't all required, or that take more than they name. */
function openRequired(node: unknown, path = "#"): string[] {
  if (!node || typeof node !== "object") return [];
  const o = node as Record<string, unknown>;
  const out: string[] = [];
  if (o.type === "object") {
    const keys = Object.keys(o.properties as object).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...(o.required as string[])].sort()) || o.additionalProperties !== false) out.push(path);
  }
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...openRequired(x, `${path}.${k}[${i}]`)));
    else out.push(...openRequired(v, `${path}.${k}`));
  }
  return out;
}

const empty = { audience: "", goals: [], context: "", segments: [] };
const dump = "Basket is a grocery delivery app in Dubai, mostly parents with young kids. We also run Basket for Business for offices.";
const base = { name: "Basket", about: { ...empty, context: "Groceries, fast." }, products: [{ id: "p1", name: "Basket", ...empty, goals: ["More customers reorder every week"] }], dump };
const read = { understanding: "A grocery app.", fragments: [{ id: "f1", quote: "mostly parents with young kids", role: "context" as const }], challenges: [{ kind: "vague" as const, fragmentId: "f1", text: "Which parents?" }] };

describe("setting an organization up", () => {
  it("takes each stage's request, and refuses what isn't one", () => {
    expect(SetupBody.safeParse({ stage: "read", ...base }).success).toBe(true);
    expect(SetupBody.safeParse({ stage: "followup", ...base, ...read, rounds: [{ answers: [{ question: "Which parents?", answer: "Young kids" }] }], last: false }).success).toBe(true);
    expect(SetupBody.safeParse({ stage: "place", ...base, ...read, answers: [{ id: "a1", question: "Which parents?", answer: "Young kids" }] }).success).toBe(true);
    expect(SetupBody.safeParse({ stage: "read", ...base, dump: "too short" }).success).toBe(false);
    expect(SetupBody.safeParse({ stage: "place", ...base, ...read, fragments: [{ id: "f1", quote: "x", role: "product" }], answers: [] }).success).toBe(false);
  });

  it("asks for closed objects with every property, the About before the products", () => {
    expect(openRequired(setupReadSchema())).toEqual([]);
    const place = setupPlaceSchema({ fragments: ["f1"], answers: [], products: ["p1"] });
    expect(openRequired(place)).toEqual([]);
    expect(Object.keys(place.properties)).toEqual(["summary", "about", "products"]);
    // A product is one there already, or a new one; lines cite only what was sent.
    const product = (place.properties.products as { items: { properties: Record<string, { enum?: string[]; items?: { properties: Record<string, { items: { enum: string[] } }> } }> } }).items.properties;
    expect(product.id.enum).toEqual(["p1", "n1", "n2", "n3", "n4", "n5", "n6"]);
    expect(product.goals.items!.properties.fragmentIds.items.enum).toEqual(["f1"]);
    expect(product.goals.items!.properties.answerIds.items.enum).toEqual(["none"]);
  });

  it("gives the model the organization as it is, the dump, and what it took from it", () => {
    const text = setupContent({ stage: "place", ...base, ...read, answers: [{ id: "a1", question: "Which parents?", answer: "Young kids" }] });
    expect(text).toContain("The organization: Basket");
    expect(text).toContain("  What it does: Groceries, fast.");
    expect(text).toContain("- p1 · Basket\n  Goals: More customers reorder every week");
    expect(text).toContain(`<brain_dump>\n${dump}\n</brain_dump>`);
    expect(text).toContain("- f1 · context: “mostly parents with young kids”");
    expect(text).toContain("- vague · f1: Which parents?");
    expect(text).toContain("- a1: Which parents?\n  Young kids");
    expect(setupContent({ stage: "read", ...base, about: empty, products: [] })).toContain("Its About says nothing yet.\n\nIt has no products yet.");
  });

  it("reads and proposes with care, reads answers quicker", () => {
    expect(setupCall({ stage: "read", ...base })).toMatchObject({ system: SETUP_READ_SYSTEM, effort: "high" });
    expect(setupCall({ stage: "followup", ...base, ...read, rounds: [{ answers: [] }], last: true }).effort).toBe("medium");
    expect(setupCall({ stage: "place", ...base, ...read, answers: [] })).toMatchObject({ system: SETUP_PLACE_SYSTEM, effort: "high" });
    // UI copy names Qalam AI; the prompt's rules hold the model to their words.
    expect(SETUP_PLACE_SYSTEM).toContain("a new product only under a name they used");
  });
});
