import { describe, expect, it } from "vitest";
import tokens from "./tokens.json";
import { ROLE_PATHS, upgradeTree } from "./contract";
import { RECIPES } from "./recipes";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { setValue } from "./edit";
import { STYLE_AXES, isStylePath, structureLines, styleOf } from "./styles";

describe("component structure axes", () => {
  it("are string tokens in the built-in system, set to their default, and nothing else is", () => {
    for (const a of STYLE_AXES) {
      const t = BUILTIN.get(a.path);
      expect(t?.type, a.path).toBe("string");
      expect(t?.value, a.path).toBe(a.default);
      expect(a.values).toContain(a.default);
      expect(ROLE_PATHS.has(a.path)).toBe(true);
    }
    const strings = BUILTIN.tokens.filter((t) => t.type === "string").map((t) => t.path);
    expect(strings.every(isStylePath)).toBe(true);
  });

  it("belong to a recipe group the component is drawn with", () => {
    for (const a of STYLE_AXES) expect(RECIPES[a.component], a.component).toContain(a.group);
  });

  it("fall back to the default when a value is missing or not allowed", () => {
    const tree = structuredClone(tokens) as unknown as Tree;
    const nav = ((tree.component as Tree)["nav-bar"] as Tree).style as Tree;
    (nav.placement as Tree).$value = "floating";
    (nav.labels as Tree).$value = "sideways";
    const ts = new TokenSet(tree);
    expect(styleOf(ts, "component.nav-bar.style.placement")).toBe("floating");
    expect(styleOf(ts, "component.nav-bar.style.labels")).toBe("all");
    delete (nav as Record<string, unknown>).indicator;
    expect(styleOf(new TokenSet(tree), "component.nav-bar.style.indicator")).toBe("none");
  });

  it("are filled into systems saved before they existed", () => {
    const old = structuredClone(tokens) as unknown as Tree;
    delete ((old.component as Tree)["nav-bar"] as Record<string, unknown>).style;
    delete (old.component as Record<string, unknown>)["list-item"];
    const up = new TokenSet(upgradeTree(old));
    for (const a of STYLE_AXES) expect(styleOf(up, a.path)).toBe(a.default);
    expect(up.dimension("component.list-item.leading-size")).toBe(40);
  });

  it("only take a listed value when edited, never a reference", () => {
    const tree = structuredClone(tokens) as unknown as Tree;
    const ok = setValue(tree, "component.nav-bar.style.placement", "floating");
    expect("tree" in ok && styleOf(new TokenSet(ok.tree), "component.nav-bar.style.placement")).toBe("floating");
    expect(setValue(tree, "component.nav-bar.style.placement", "sideways")).toHaveProperty("error");
    expect(setValue(tree, "component.nav-bar.style.placement", "{component.top-bar.style.title}")).toHaveProperty("error");
  });

  it("describe what a system draws differently, in plain words", () => {
    const value = (p: string) => (p === "component.nav-bar.style.placement" ? "floating" : p === "component.nav-bar.style.labels" ? "none" : STYLE_AXES.find((a) => a.path === p)!.default);
    const lines = structureLines(value);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^BottomNav: placement: a rounded pill.*labels: icons only/);
    expect(structureLines(value, true).length).toBeGreaterThan(1);
  });
});
