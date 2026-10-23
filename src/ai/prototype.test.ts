import { describe, expect, it } from "vitest";
import { PrototypeBody, partsContent, partsSchema, partsSystem, proposeContent, proposeSchema, type PartsInput, type ProposeInput } from "./prototype";

/** What constrained decoding can't take: open objects, size keywords, recursion (as in schemas.test.ts). */
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"];
function problems(schema: Record<string, unknown>): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const visit = (node: unknown, path: string, stack: string[]) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.type === "object" && o.additionalProperties !== false) out.push(`${path}: open object`);
    for (const k of UNSUPPORTED) if (k in o && typeof o[k] !== "object") out.push(`${path}: ${k}`);
    if (typeof o.$ref === "string") {
      const name = o.$ref.replace("#/$defs/", "");
      if (stack.includes(name)) out.push(`${path}: recursive ${name}`);
      else visit(defs[name], `$defs.${name}`, [...stack, name]);
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === "$defs") continue;
      if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}.${k}[${i}]`, stack));
      else visit(v, `${path}.${k}`, stack);
    }
  };
  visit(schema, "#", []);
  return out;
}

const propose: ProposeInput = {
  stage: "propose",
  screen: 'Screen "Al Mallah · Menu" (mobile, en)\n- a row of chips: "Popular", "Plates"',
  candidates: [
    { id: "c1", recipe: "stickySections", name: "Sticky sections", what: 'the chips "Popular", "Plates"', main: true },
    { id: "c2", recipe: "configureAndAdd", name: "Configure and add", what: "6 items, each with a +", needs: { kind: "sheet", role: "options" }, main: true },
    { id: "c3", recipe: "collectionBar", name: "Collection bar", what: "what's been added", needs: { kind: "bar", role: "collection" }, after: "c2", main: true },
  ],
  ask: "and a toast when something's added",
};

const parts: PartsInput = {
  stage: "parts",
  screen: propose.screen,
  platform: "mobile",
  lang: "en",
  dir: "ltr",
  parts: [{ candidate: "c2", kind: "sheet", role: "options", label: "Tap a dish to pick its size", plan: "Size: Regular or Large +AED 6.00", about: 'The first item: "Chicken shawarma" at AED 18.00.' }],
};

describe("the prototyping agent's calls", () => {
  it("take what the client sends, and nothing else", () => {
    expect(PrototypeBody.safeParse(propose).success).toBe(true);
    expect(PrototypeBody.safeParse(parts).success).toBe(true);
    expect(PrototypeBody.safeParse({ ...propose, candidates: [{ ...propose.candidates[0], id: "body.2" }] }).success).toBe(false);
    expect(PrototypeBody.safeParse({ ...parts, parts: [{ ...parts.parts[0], candidate: "f1", role: "custom" }] }).success).toBe(true);
    // With nothing code builds, there's still the designer's ask to propose; without one, nothing.
    expect(PrototypeBody.safeParse({ ...propose, candidates: [] }).success).toBe(true);
    expect(PrototypeBody.safeParse({ ...propose, candidates: [], ask: " " }).success).toBe(false);
    expect(PrototypeBody.safeParse({ ...parts, stage: "build" }).success).toBe(false);
  });

  it("answer in schemas constrained decoding takes, pinned to the ids given", () => {
    const p = proposeSchema(["c1", "c2", "c3"]);
    expect(problems(p)).toEqual([]);
    const step = ((p.properties as Record<string, { items: { properties: Record<string, { enum?: string[] }> } }>).steps.items.properties).candidate;
    expect(step.enum).toEqual(["c1", "c2", "c3"]);
    expect(problems(proposeSchema([], ["l1"]))).toEqual([]);
    const w = partsSchema(["c2"]);
    expect(problems(w)).toEqual([]);
    expect(JSON.stringify(w)).toContain('"enum":["c2"]');
  });

  it("tell the model the screen, the candidates by id and the ask; and how each part is shaped", () => {
    const text = proposeContent(propose);
    expect(text).toContain("c2: Configure and add — 6 items, each with a +. Needs a new sheet. On the main path.");
    expect(text).toContain("c3: Collection bar — what's been added. Needs a new bar. Only after c2.");
    expect(text).toContain("The designer asks: and a toast when something's added");
    expect(partsContent(parts)).toContain('- c2: a sheet [options] for "Tap a dish to pick its size". The first item: "Chicken shawarma" at AED 18.00. It should hold: Size: Regular or Large +AED 6.00');
    expect(proposeContent({ ...propose, candidates: [], ask: "The dish's options sheet open\nThe basket bar after adding" })).toContain("Candidates:\nNone: code builds nothing on this screen by itself, so steps stays empty. Build what the designer asks from blocks.\n\nThe designer asks for:\n- The dish's options sheet open\n- The basket bar after adding");
    expect(partsSystem()).toContain('[options] An options sheet');
    expect(partsSystem()).toContain("Stepper");
  });
});
