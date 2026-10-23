import { beforeAll, describe, expect, it } from "vitest";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga } from "@/engine/layout";
import { setAutoLayoutEnabled } from "@/doc/autolayout";
import tokens from "./tokens.json";
import { TokenSet, type Tree } from "./resolve";
import { CATALOG } from "./components";
import { buildShowcase, cardId, cellId, sectionId, SHOWCASE_GROUPS, variantAxis } from "./showcase";
import type { Pattern } from "./docs";
import { emptyGuide } from "./docs";

const ts = new TokenSet(tokens as unknown as Tree);
const system = (patterns: Pattern[] = []) => ({ id: "builtin", name: "Qalam", updatedAt: 7, patterns });

const byId = (nodes: SceneNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe("the Components page", () => {
  beforeAll(async () => {
    await ensureYoga();
    setAutoLayoutEnabled(true);
  });

  it("draws every catalog component in its group, in the Assets order", () => {
    const page = buildShowcase(system(), ts);
    const nodes = byId(page.nodes);
    const groups = SHOWCASE_GROUPS.filter((g) => CATALOG.some((c) => c.category === g.category));
    expect(page.roots).toEqual(groups.map((g) => sectionId(g.label)));
    for (const spec of CATALOG) {
      const card = nodes.get(cardId(spec.name));
      expect(card, spec.name).toBeDefined();
      expect(card!.meta.showcase).toEqual({ kind: "card", component: spec.name });
      // The card sits in its group's section.
      let top = card!;
      while (top.parentId) top = nodes.get(top.parentId)!;
      const label = SHOWCASE_GROUPS.find((g) => g.category === spec.category)!.label;
      expect(top.id).toBe(sectionId(label));
    }
    expect(page.sig).toBe("builtin@7");
    expect(nodes.get(page.roots[0])!.meta.showcase?.sig).toBe("builtin@7");
  });

  it("gives a cell to each option of the component's main property", () => {
    const button = CATALOG.find((c) => c.name === "Button")!;
    const axis = variantAxis(button)!;
    expect(axis.values.length).toBeGreaterThan(1);
    const page = buildShowcase(system(), ts, { only: ["Button", "Divider"] });
    const nodes = byId(page.nodes);
    for (const v of axis.values) expect(nodes.get(cellId("Button", v))?.meta.showcase).toEqual({ kind: "cell", component: "Button", prop: axis.prop, value: v });
    // No such property: one cell with the example.
    const divider = CATALOG.find((c) => c.name === "Divider")!;
    if (!variantAxis(divider)) expect(nodes.get(cellId("Divider", undefined))?.meta.showcase).toEqual({ kind: "cell", component: "Divider" });
  });

  it("puts the system's own components first", () => {
    const own: Pattern = {
      name: "Dish Row",
      purpose: "A dish with its price",
      composition: { component: "Stack", props: { direction: "row" }, children: [{ component: "Text", props: { text: "Falafel" } }] },
      guide: emptyGuide("Dish Row", "A dish with its price"),
    };
    const page = buildShowcase(system([own]), ts);
    expect(page.roots[0]).toBe(sectionId("Qalam components"));
    const nodes = byId(page.nodes);
    expect(nodes.get(cardId("Dish Row", true))?.meta.showcase).toEqual({ kind: "card", component: "Dish Row", own: true });
    expect(nodes.get(cellId("Dish Row", undefined, true))).toBeDefined();
  });

  it("keeps ids, parents and children consistent, with no instance links or lint marks", () => {
    const page = buildShowcase(system(), ts);
    const nodes = byId(page.nodes);
    expect(nodes.size).toBe(page.nodes.length);
    for (const n of page.nodes) {
      if (n.parentId) expect(nodes.get(n.parentId)?.children).toContain(n.id);
      for (const c of n.children) expect(nodes.get(c)?.parentId).toBe(n.id);
      expect(n.meta.inst).toBeUndefined();
      expect(n.meta.flags).toBeUndefined();
    }
    // Sections are stacked without overlapping.
    const sections = page.roots.map((id) => nodes.get(id)!);
    for (let i = 1; i < sections.length; i++) expect(sections[i].y).toBeGreaterThan(sections[i - 1].y + sections[i - 1].h);
    // The same build twice: the same ids (a rebuild keeps the selection).
    expect(buildShowcase(system(), ts).nodes.filter((n) => n.meta.showcase).map((n) => n.id)).toEqual(page.nodes.filter((n) => n.meta.showcase).map((n) => n.id));
  });
});
