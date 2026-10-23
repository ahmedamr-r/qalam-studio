import { describe, expect, it } from "vitest";
import foundations from "@/ai/fixtures/ds-foundations.json";
import guide from "@/ai/fixtures/ds-guide.json";
import type { FoundationsResult, GuideResult } from "@/ai/ds-schemas";
import { foundationsSchema, guideSchema } from "@/ai/ds-schemas";
import { ALL_COMPONENTS, DEFAULT_OPTIONS, describeRun, foundationsInstructions, guideInstructions, normalizeOptions, trimFoundations, trimGuide, wantsGuide } from "./extract-options";
import { designSystemFromExtraction, docsFromFoundations, docsFromGuide } from "./fromExtraction";
import { isValid, validateTree } from "./contract";
import { BUILTIN, TokenSet } from "./resolve";

const F = foundations as unknown as FoundationsResult;
const G = guide as unknown as GuideResult;
const props = (s: Record<string, unknown>) => Object.keys(s.properties as object);

describe("extraction options", () => {
  it("keeps what the first look saw and the designer's answers", () => {
    const o = normalizeOptions({ observed: ["Button", "Nope"], recipes: "chosen", notes: [{ question: "Q", answer: "  A  " }, { question: "Empty", answer: "" }, ...Array.from({ length: 6 }, () => ({ question: "x", answer: "y" }))] });
    expect(o.observed).toEqual(["Button"]);
    expect(o.recipes).toBe("chosen");
    expect(o.notes[0]).toEqual({ question: "Q", answer: "A" });
    expect(o.notes).toHaveLength(4);
    expect(normalizeOptions({ recipes: "some" as never }).recipes).toBe("all");
    expect(normalizeOptions(undefined)).toEqual(DEFAULT_OPTIONS);
  });

  it("tells the first pass which recipes to style", () => {
    const o = normalizeOptions({ depth: "complete", components: ["Button", "Tabs"], observed: ["Button", "Card"], recipes: "chosen", notes: [{ question: "Primary?", answer: "Violet" }] });
    const text = foundationsInstructions(o);
    expect(text).toMatch(/found these catalog components in the screenshots: Button, Card/);
    expect(text).toMatch(/Style the recipes of these components only: Button, Tabs\. Tabs isn't in the screenshots/);
    expect(text).toMatch(/Primary\? → Violet/);
    expect(foundationsInstructions({ ...o, recipes: "all" })).not.toMatch(/Style the recipes/);
    expect(foundationsInstructions({ ...o, depth: "standard" })).not.toMatch(/Style the recipes/);
    expect(foundationsInstructions({ ...o, components: [] })).toMatch(/tokens only/);
    expect(describeRun(o)).toMatch(/styling for 2 components/);
  });

  it("tells the second pass what was seen and what the designer answered", () => {
    const o = normalizeOptions({ components: ["Button", "Tabs"], observed: ["Button"], notes: [{ question: "Dark?", answer: "Theme" }] });
    const text = guideInstructions(o);
    expect(text).toMatch(/saw Button in the screenshots: mark it observed/);
    expect(text).toMatch(/Tabs isn't in the screenshots: .* mark it inferred/);
    expect(text).toMatch(/Dark\? → Theme/);
  });

  it("replays only the named new components from the recording", () => {
    const g = trimGuide(G, { ...DEFAULT_OPTIONS, patterns: "listed", patternNames: ["Balance hero card", "Stats strip"] });
    expect(g.patterns?.map((p) => p.name)).toEqual(["BalanceHeroCard"]);
  });

  it("sanitises stored or posted options", () => {
    const o = normalizeOptions({ depth: "deep" as never, components: ["Button", "VideoPlayer"], patterns: "listed", patternNames: ["  Balance card ", "Balance card", ""] });
    expect(o.depth).toBe("complete");
    expect(o.components).toEqual(["Button"]);
    expect(o.patternNames).toEqual(["Balance card"]);
    expect(normalizeOptions({ patterns: "listed", patternNames: [] }).patterns).toBe("none");
  });

  it("knows when the docs pass has nothing to do", () => {
    expect(wantsGuide(DEFAULT_OPTIONS)).toBe(true);
    expect(wantsGuide({ ...DEFAULT_OPTIONS, docs: false })).toBe(false);
    expect(wantsGuide({ ...DEFAULT_OPTIONS, language: false, components: [], patterns: "none" })).toBe(false);
  });

  it("asks only for the chosen depth", () => {
    expect(props(foundationsSchema("essentials"))).not.toContain("shadows");
    expect(props(foundationsSchema("essentials"))).not.toContain("components");
    expect(props(foundationsSchema("standard"))).toEqual(expect.arrayContaining(["shadows", "gradients", "borderWidth", "layout"]));
    expect(props(foundationsSchema("standard"))).not.toContain("components");
    expect(props(foundationsSchema("complete"))).toContain("components");
  });

  it("asks only for the chosen docs and components", () => {
    const o = normalizeOptions({ ...DEFAULT_OPTIONS, language: false, components: ["Button", "Card"], patterns: "listed", patternNames: ["Balance card", "Ride option row"] });
    const s = guideSchema(o);
    expect(props(s)).toEqual(["components", "patterns"]);
    const items = (s.properties as Record<string, { items: { properties: { component: { enum: string[] } } } }>).components.items;
    expect(items.properties.component.enum).toEqual(["Button", "Card"]);
    expect(guideInstructions(o)).toMatch(/"Balance card", "Ride option row"/);
    expect(guideInstructions(o)).not.toMatch(/defaults, not observations/);
    expect(guideInstructions({ ...o, depth: "essentials" })).toMatch(/defaults, not observations/);
    expect(props(guideSchema({ ...o, patterns: "none", components: [] , language: true }))).toEqual(["language", "layout"]);
  });

  it("replays the recorded sample at a lower depth and with fewer docs", () => {
    const f = trimFoundations(F as unknown as Record<string, unknown>, "essentials");
    expect(f.shadows).toBeUndefined();
    expect(f.components).toBeUndefined();
    const g = trimGuide(G, { ...DEFAULT_OPTIONS, language: false, components: ["Button"], patterns: "none" });
    expect(g.language).toBeUndefined();
    expect(g.components?.map((c) => c.component)).toEqual(["Button"]);
    expect(g.patterns).toEqual([]);
  });
});

describe("converting a shallow extraction", () => {
  const ds = designSystemFromExtraction({ foundations: trimFoundations(F as unknown as Record<string, unknown>, "essentials") as unknown as FoundationsResult });
  const ts = new TokenSet(ds.tree);

  it("still fills the whole contract", () => {
    expect(isValid(validateTree(ds.tree))).toBe(true);
  });

  it("tints default shadows with the system's own ink, not the built-in navy", () => {
    const ink = ts.color("text.primary")!;
    const layers = ts.shadowLayers("shadow.sm")!;
    expect(layers.length).toBe(BUILTIN.shadowLayers("shadow.sm")!.length);
    expect(layers[0].color.slice(0, 7)).toBe(ink.slice(0, 7));
    expect(ds.notes?.join(" ")).toMatch(/Not extracted at this depth/);
    expect(ds.notes?.join(" ")).toMatch(/default recipes/);
  });

  it("keeps skipped doc sections from the base docs", () => {
    const base = docsFromFoundations(F);
    const docs = docsFromGuide({ components: G.components?.filter((c) => c.component === "Button") }, [], base);
    expect(docs.language).toBe(base.language);
    expect(docs.components.find((c) => c.component === "Button")?.whenToUse.length).toBeGreaterThan(0);
    expect(docs.components).toHaveLength(ALL_COMPONENTS.length);
  });
});
