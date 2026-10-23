import { describe, expect, it } from "vitest";
import { AUDIT_SCHEMA, EXTRACT_SCHEMA, GENERATE_SCHEMA, REPAIR_SCHEMA, sectionSchema } from "./schemas";
import { DS_FOUNDATIONS_SCHEMA, DS_GUIDE_SCHEMA, REBUILD_SCHEMA, RESTYLE_SCHEMA, foundationsSchema, guideSchema } from "./ds-schemas";
import { DEFAULT_OPTIONS, normalizeOptions } from "@/design-system/extract-options";
import { CRITIQUE_SCHEMA } from "./critique";
import { DEMO_SCREENS } from "@/ui/demo";
import { CATALOG } from "@/design-system/components";
import { RECONCILE_SCHEMA } from "./ds-reconcile";
import { FOLLOWUPS_SCHEMA, draftSchema, extractSchema, synthesizeSchema } from "./discovery";
import { componentSchema } from "./component-import";

/** Keywords structured outputs don't support (the converter/builders clamp instead). */
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"];

/** Walk a schema and check the structured-output constraints (no recursion, closed objects). */
function checkSchema(schema: Record<string, unknown>) {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const visit = (node: unknown, path: string, stack: string[]) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.type === "object" && o.additionalProperties !== false) problems.push(`${path}: object without additionalProperties:false`);
    for (const k of UNSUPPORTED) if (k in o && typeof o[k] !== "object") problems.push(`${path}: unsupported keyword ${k}`);
    if (typeof o.$ref === "string") {
      const name = o.$ref.replace("#/$defs/", "");
      if (stack.includes(name)) problems.push(`${path}: recursive $ref ${name}`);
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
  return problems;
}

describe("structured output schemas", () => {
  it.each([
    ["generate", GENERATE_SCHEMA],
    ["extract", EXTRACT_SCHEMA],
    ["audit", AUDIT_SCHEMA],
    ["design-system foundations", DS_FOUNDATIONS_SCHEMA],
    ["design-system guide", DS_GUIDE_SCHEMA],
    ["restyle", RESTYLE_SCHEMA],
    ["foundations · essentials", foundationsSchema("essentials")],
    ["foundations · standard", foundationsSchema("standard")],
    ["guide · language only", guideSchema(normalizeOptions({ ...DEFAULT_OPTIONS, components: [], patterns: "none" }))],
    ["guide · 3 components + named components", guideSchema(normalizeOptions({ ...DEFAULT_OPTIONS, language: false, components: ["Button", "Card", "TextField"], patterns: "listed", patternNames: ["Balance card"] }))],
    ["critique", CRITIQUE_SCHEMA],
    ["repair", REPAIR_SCHEMA],
    ["rebuild", REBUILD_SCHEMA],
    ["reconcile", RECONCILE_SCHEMA],
    ["section", sectionSchema(["body.1", "header.0"])],
    ["discovery follow-ups", FOLLOWUPS_SCHEMA],
    ["discovery draft", draftSchema(["product", "metric", "pains"])],
    ["discovery extract", extractSchema(["c1", "c2"])],
    ["discovery extract · no parts", extractSchema([])],
    ["discovery synthesize", synthesizeSchema(["c2", "c3"], ["c1", "c2"], ["q1", "q2"])],
    ["add component · build", componentSchema("build")],
    ["add component · check", componentSchema("check")],
    ["discovery synthesize · bare outcome", synthesizeSchema([], ["c1"], ["q1"])],
  ])("%s schema is non-recursive and closed", (_, schema) => {
    expect(checkSchema(schema)).toEqual([]);
  });

  it("enumerates every catalog component exactly once per level, plus Custom", () => {
    const defs = GENERATE_SCHEMA.$defs as Record<string, { anyOf: { properties: { component: { const: string } } }[] }>;
    const names = [...defs.Leaf.anyOf, ...defs.Container1.anyOf].map((c) => c.properties.component.const).sort();
    expect(names).toEqual([...CATALOG.map((c) => c.name), "Custom"].sort());
  });

  it("asks for new components before the screens that place them", () => {
    const keys = (s: unknown) => Object.keys((s as { properties: Record<string, unknown> }).properties);
    expect(keys(GENERATE_SCHEMA).indexOf("newComponents")).toBeLessThan(keys(GENERATE_SCHEMA).indexOf("variants"));
    const section = sectionSchema(["body.0"]);
    expect(keys(section).indexOf("newComponents")).toBeLessThan(keys(section).indexOf("edits"));
    // Path data is a plain string, bounded in code rather than by the schema.
    const leaf = (GENERATE_SCHEMA.$defs as Record<string, { anyOf: { properties: { component: { const: string }; props: { properties: Record<string, { items?: { properties: Record<string, { type: string }> } }> } } }[] }>).Leaf;
    const graphic = leaf.anyOf.find((c) => c.properties.component.const === "Graphic")!;
    expect(graphic.properties.props.properties.shapes.items!.properties.d.type).toBe("string");
  });

  it("nests body items four components deep and header, sidebar and footer items three", () => {
    const defs = GENERATE_SCHEMA.$defs as Record<string, { anyOf?: { $ref?: string; properties?: { children?: { items: { $ref: string } } } }[]; properties?: Record<string, { items?: { $ref: string } }> }>;
    const screen = defs.Screen.properties!;
    expect(screen.body.items!.$ref).toBe("#/$defs/Node3");
    for (const r of ["header", "sidebar", "hero", "footer"]) expect(screen[r].items!.$ref).toBe("#/$defs/Node2");
    // Node3 → Container3 → Node2 → Container2 → Node1 → Container1 → Leaf: four levels of components.
    expect(defs.Container3.anyOf![0].properties!.children!.items.$ref).toBe("#/$defs/Node2");
    expect(defs.Container2.anyOf![0].properties!.children!.items.$ref).toBe("#/$defs/Node1");
    expect(defs.Container1.anyOf![0].properties!.children!.items.$ref).toBe("#/$defs/Leaf");
  });

  it("lets margin be null, meaning the system's default", () => {
    const margin = (GENERATE_SCHEMA.$defs as Record<string, { properties: Record<string, { anyOf?: unknown[] }> }>).Screen.properties.margin;
    expect(margin.anyOf).toEqual([{ type: "number" }, { type: "null" }]);
  });

  it("demo screens use only schema-known components", () => {
    const known = new Set(CATALOG.map((c) => c.name));
    const walk = (i: { component: string; children?: unknown[] }): void => {
      expect(known.has(i.component)).toBe(true);
      (i.children as { component: string }[] | undefined)?.forEach(walk);
    };
    for (const s of DEMO_SCREENS) [...(s.header ?? []), ...s.body, ...(s.footer ?? [])].forEach(walk);
  });
});

describe("generate schema streaming order", () => {
  // The studio builds screens while the model writes them, so what it can show early comes first.
  it("asks for the approach first, then each screen's name and rationale before its regions", () => {
    expect(Object.keys(GENERATE_SCHEMA.properties as object)[0]).toBe("approach");
    expect(GENERATE_SCHEMA.required).toContain("approach");
    const screen = Object.keys((GENERATE_SCHEMA.$defs as Record<string, { properties: object }>).Screen.properties);
    expect(screen.slice(0, 2)).toEqual(["name", "rationale"]);
    for (const region of ["header", "hero", "body", "footer"]) expect(screen.indexOf(region)).toBeGreaterThan(screen.indexOf("background"));
  });
});

describe("component structure in the extraction schema", () => {
  it("asks for every structure axis as an enum of exactly the values the studio can draw, at every depth", async () => {
    const { STYLE_AXES } = await import("@/design-system/styles");
    for (const depth of ["essentials", "standard", "complete"] as const) {
      const structure = (foundationsSchema(depth).properties as Record<string, { properties: Record<string, { properties: Record<string, { enum?: string[] }> }> }>).structure;
      for (const a of STYLE_AXES) expect(structure.properties[a.group.slice(10)].properties[a.axis].enum, `${depth} ${a.path}`).toEqual([...a.values]);
    }
    // Structure isn't a free-text recipe any more.
    const recipes = JSON.stringify((DS_FOUNDATIONS_SCHEMA.properties as Record<string, unknown>).components);
    expect(recipes).not.toContain('"style"');
    expect((DS_FOUNDATIONS_SCHEMA.properties as Record<string, unknown>).componentNotes).toBeUndefined();
  });
});
