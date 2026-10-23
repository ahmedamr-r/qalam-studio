import { describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { isValid, validateTree } from "./contract";
import { TokenSet, type Tree } from "./resolve";
import { aliasTargets, createToken, deleteToken, duplicateToken, groupsOf, pathProblem, referencesTo, renameToken, setDescription, setValue, tierOf, tokensIn } from "./edit";

const tree = raw as Tree;
const ts = new TokenSet(tree);
const ok = (r: { tree: Tree } | { error: string }): Tree => {
  if ("error" in r) throw new Error(r.error);
  return r.tree;
};

describe("token tiers and groups", () => {
  it("sorts the built-in tree into primitives, semantic roles and component recipes", () => {
    expect(tierOf(tree, "color.ink.500")).toBe("primitive");
    expect(tierOf(tree, "space.400")).toBe("primitive");
    expect(tierOf(tree, "font.family.latin")).toBe("primitive");
    expect(tierOf(tree, "bg.brand")).toBe("semantic");
    expect(tierOf(tree, "type.body")).toBe("semantic");
    expect(tierOf(tree, "component.button.radius")).toBe("component");
  });

  it("builds a group tree per tier, skipping the shared component level", () => {
    const prim = groupsOf(tree, ts, "primitive");
    expect(prim.map((g) => g.name)).toContain("color");
    expect(prim.find((g) => g.name === "color")!.children.map((g) => g.name)).toContain("ink");
    const comp = groupsOf(tree, ts, "component");
    expect(comp.map((g) => g.path)).toContain("component.button");
    const button = comp.find((g) => g.path === "component.button")!;
    expect(button.count).toBe(tokensIn(tree, ts, { group: "component.button" }).length);
    const all = (["primitive", "semantic", "component"] as const).reduce((n, t) => n + tokensIn(tree, ts, { tier: t }).length, 0);
    expect(all).toBe(ts.tokens.length);
  });
});

describe("editing values", () => {
  it("normalises literals in the token's type", () => {
    const t = new TokenSet(ok(setValue(tree, "radius.lg", "20")));
    expect(t.get("radius.lg")!.authored).toBe("20px");
    expect(new TokenSet(ok(setValue(tree, "color.ink.500", "#0f0"))).color("color.ink.500")).toBe("#00FF00");
    expect(setValue(tree, "radius.lg", "big")).toHaveProperty("error");
    expect(setValue(tree, "color.ink.500", "not a colour")).toHaveProperty("error");
  });

  it("turns a literal into an alias and back", () => {
    const aliased = ok(setValue(tree, "bg.surface", "{color.ink.100}"));
    const t = new TokenSet(aliased);
    expect(t.get("bg.surface")!.aliasOf).toBe("color.ink.100");
    expect(t.color("bg.surface")).toBe(ts.color("color.ink.100"));
    // A component recipe (untyped alias) keeps a proper type when it becomes a literal.
    const lit = new TokenSet(ok(setValue(tree, "component.button.radius", "10px")));
    expect(lit.dimension("component.button.radius")).toBe(10);
    expect(isValid(validateTree(ok(setValue(tree, "component.button.radius", "10px"))))).toBe(true);
  });

  it("refuses aliases of the wrong type, to itself or in a loop", () => {
    expect(setValue(tree, "bg.surface", "{radius.lg}")).toHaveProperty("error");
    expect(setValue(tree, "bg.surface", "{bg.surface}")).toHaveProperty("error");
    expect(setValue(tree, "bg.surface", "{nope.nothing}")).toHaveProperty("error");
    // bg.brand → color.ink.500; pointing the primitive at bg.brand would loop.
    expect(setValue(tree, "color.ink.500", "{bg.brand}")).toHaveProperty("error");
    expect(aliasTargets(ts, "color.ink.500", "color").map((t) => t.path)).not.toContain("bg.brand");
    expect(aliasTargets(ts, "bg.surface", "color").map((t) => t.path)).toContain("color.ink.100");
    // Down the tiers only: a role can't point at a component recipe, a primitive only at primitives.
    expect(aliasTargets(ts, "bg.surface", "color", tree).map((t) => t.path)).not.toContain("component.button.primary.fill");
    expect(aliasTargets(ts, "bg.surface", "color", tree).map((t) => t.path)).toContain("bg.canvas");
    expect(aliasTargets(ts, "color.ink.50", "color", tree).every((t) => t.path.startsWith("color."))).toBe(true);
    expect(aliasTargets(ts, "component.button.primary.fill", "color", tree).map((t) => t.path)).toContain("gradient.brand");
  });

  it("lets a component fill point at a gradient", () => {
    const t = new TokenSet(ok(setValue(tree, "component.button.primary.fill", "{gradient.brand}")));
    expect(t.paint("component.button.primary.fill")?.gradient).toBeTruthy();
    expect(setValue(tree, "bg.surface", "{gradient.brand}")).toHaveProperty("error");
  });

  it("edits composite values", () => {
    const t = new TokenSet(ok(setValue(tree, "type.body", { fontFamily: "{font.family.latin}", fontWeight: 650, fontSize: 17, lineHeight: "24", letterSpacing: 0 })));
    expect(t.typography("type.body")).toMatchObject({ fontFamily: "Inter", fontWeight: 700, fontSize: 17, lineHeight: 24 });
    const s = new TokenSet(ok(setValue(tree, "shadow.sm", [{ color: "#00000033", offsetX: 0, offsetY: 4, blur: 12, spread: 0, inset: true }])));
    expect(s.shadowLayers("shadow.sm")).toEqual([{ kind: "inner", x: 0, y: 4, blur: 12, spread: 0, color: "#00000033" }]);
    expect(setValue(tree, "shadow.sm", [{ offsetX: 0 }])).toHaveProperty("error");
  });

  it("sets and clears descriptions", () => {
    expect(new TokenSet(ok(setDescription(tree, "radius.lg", "  Cards  "))).get("radius.lg")!.description).toBe("Cards");
    expect(new TokenSet(ok(setDescription(tree, "radius.md", ""))).get("radius.md")!.description).toBeUndefined();
  });
});

describe("creating, renaming and deleting", () => {
  it("creates a token next to its siblings, copying the last one", () => {
    const r = createToken(tree, { type: "color", tier: "primitive", group: "color.ink" });
    expect(r.path).toBe("color.ink.new-color");
    const t = new TokenSet(r.tree);
    expect(t.color(r.path)).toBe(ts.color("color.ink.975"));
    const again = createToken(r.tree, { type: "color", tier: "primitive", group: "color.ink" });
    expect(again.path).toBe("color.ink.new-color-2");
  });

  it("puts tokens without a group in the tier's usual group", () => {
    expect(createToken(tree, { type: "dimension", tier: "primitive" }).path).toBe("space.new-size");
    const c = createToken(tree, { type: "shadow", tier: "component" });
    expect(c.path).toBe("component.custom.new-shadow");
    expect(tierOf(c.tree, c.path)).toBe("component");
  });

  it("renames a token and every reference to it", () => {
    const made = createToken(tree, { type: "color", tier: "primitive", group: "color.ink" });
    const pointed = ok(setValue(made.tree, "bg.sky", `{${made.path}}`));
    const renamed = new TokenSet(ok(renameToken(pointed, made.path, "color.ink.990")));
    expect(renamed.has(made.path)).toBe(false);
    expect(renamed.get("bg.sky")!.aliasOf).toBe("color.ink.990");
  });

  it("keeps the tier when a rename starts a new group", () => {
    const made = createToken(tree, { type: "color", tier: "primitive", group: "color.ink" });
    const moved = ok(renameToken(made.tree, made.path, "brand.accent"));
    expect(tierOf(moved, "brand.accent")).toBe("primitive");
    expect(new TokenSet(moved).color("brand.accent")).toBe(ts.color("color.ink.975"));
  });

  it("protects contract tokens and referenced tokens", () => {
    expect(renameToken(tree, "bg.brand", "bg.primary")).toHaveProperty("error");
    expect(deleteToken(tree, "bg.brand")).toHaveProperty("error");
    expect(referencesTo(ts, "color.ink.500")).toContain("bg.brand");
    expect(deleteToken(tree, "color.ink.500")).toHaveProperty("error");
    const made = createToken(tree, { type: "color", tier: "primitive", group: "color.ink" });
    expect(new TokenSet(ok(deleteToken(made.tree, made.path))).has(made.path)).toBe(false);
  });

  it("drops groups a delete empties", () => {
    const made = createToken(tree, { type: "color", tier: "semantic", group: "" });
    expect(made.path).toBe("bg.new-color");
    const moved = ok(renameToken(made.tree, made.path, "accent.one"));
    const gone = ok(deleteToken(moved, "accent.one"));
    expect("accent" in gone).toBe(false);
  });

  it("checks names", () => {
    expect(pathProblem(tree, "bg.brand")).toMatch(/exists/);
    expect(pathProblem(tree, "bg.brand.deep")).toMatch(/not a group/);
    expect(pathProblem(tree, "bg")).toMatch(/is a group/);
    expect(pathProblem(tree, "bg.new thing")).toMatch(/letters/);
    expect(pathProblem(tree, "bg.new-thing")).toBeNull();
  });

  it("duplicates with a free name", () => {
    const r = duplicateToken(tree, "radius.lg");
    if ("error" in r) throw new Error(r.error);
    expect(r.path).toBe("radius.lg-copy");
    expect(new TokenSet(r.tree).dimension("radius.lg-copy")).toBe(16);
  });
});

describe("component recipes", () => {
  it("maps catalog components to recipe groups that exist", async () => {
    const { RECIPES, recipePaths } = await import("./recipes");
    const { COMPONENT_NAMES } = await import("./components");
    const paths = ts.tokens.map((t) => t.path);
    for (const [name, groups] of Object.entries(RECIPES)) {
      expect(COMPONENT_NAMES).toContain(name);
      for (const g of groups) expect(paths.some((p) => p.startsWith(`${g}.`))).toBe(true);
    }
    expect(recipePaths("Button", paths)).toContain("component.button.primary.fill");
    expect(recipePaths("Text", paths, ["type.body", "nope.x"])).toEqual(["type.body"]);
  });
});
