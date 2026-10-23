import { afterAll, beforeAll, describe, expect, it } from "vitest";
import raw from "./tokens.json";
import { buildScreen, OVERLAP_PX, type ScreenSpec } from "./builders";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { completeTree, setToken } from "./contract";
import { lintSpec } from "./spec-lint";
import { BUILTIN_DOCS } from "./docs";
import { BUILTIN_ID, useSystems, type DesignSystem } from "./registry";
import { insertScreens } from "./place";
import { refreshRoot, staleRoots } from "./refresh";
import { isEdited } from "./apply";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { setAutoLayoutEnabled } from "@/doc/autolayout";
import { studio } from "@/doc/store";
import { descendants } from "@/doc/geometry";
import type { SceneNode } from "@/doc/schema";
import { HERO_DEMO_SCREENS } from "@/ui/demo";
import { HERO_FIXTURES } from "@/doc/autolayout.fixtures";

const WALLET = HERO_DEMO_SCREENS[0];
const lay = (spec: ScreenSpec, ts: TokenSet = BUILTIN) => layoutToNodes(buildScreen(spec, ts), { dir: spec.dir ?? "ltr", lang: spec.lang ?? "en", ts }, { x: 0, y: 0 });
const named = (nodes: SceneNode[], name: string) => nodes.find((n) => n.name === name);
/** A system whose backdrop fades into its canvas (the neutral default for systems other than the built-in). */
const FADE = (() => {
  const tree = structuredClone(raw) as Tree;
  delete ((tree.component as Tree).backdrop as Record<string, unknown>)["sheet-radius"];
  delete ((tree.component as Tree).backdrop as Record<string, unknown>).fill;
  return new TokenSet(completeTree(tree).tree);
})();
const bottom = (n: SceneNode) => n.y + n.h;

describe("hero on the backdrop, with an overlapping first section", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("puts the status bar, header and hero on the built-in header band, in light text, with the content as a sheet", () => {
    const nodes = lay(WALLET);
    const root = nodes[0];
    const backdrop = named(nodes, "Backdrop")!;
    expect(backdrop.parentId).toBe(root.id);
    expect(root.children[0]).toBe(backdrop.id);
    expect(backdrop.fill?.token).toBe("component.backdrop.fill");
    const stops = backdrop.fill?.gradient?.stops ?? [];
    expect(stops[0].color).toBe(BUILTIN.color("color.ink.600"));
    expect(stops[stops.length - 1].color).toBe(BUILTIN.color("color.ink.975"));
    expect(backdrop.children.map((id) => nodes.find((n) => n.id === id)!.name)).toEqual(["Status bar", "TopBar", "Hero"]);
    // The bar is see-through on the band, and what sits on the band is light.
    const bar = nodes.find((n) => n.meta.component === "TopBar")!;
    expect(bar.fill).toBeFalsy();
    expect(nodes.find((n) => n.name === "9:41")!.fill?.token).toBe("text.inverse");
    // The content rises over the band as a sheet with rounded top corners.
    const content = named(nodes, "Content")!;
    expect(content.fill?.token).toBe("bg.canvas");
    expect(content.radius?.tl.rx).toBe(BUILTIN.dimension("component.backdrop.sheet-radius"));
    expect(content.radius?.bl.rx).toBe(0);
  });

  it("fades into the canvas, with no sheet, in a system without a sheet radius", () => {
    const nodes = lay(WALLET, FADE);
    const backdrop = named(nodes, "Backdrop")!;
    const stops = backdrop.fill?.gradient?.stops ?? [];
    expect(stops[0].color).toBe(FADE.color("bg.brand-subtle"));
    expect(stops[stops.length - 1].color).toBe(FADE.color("bg.canvas"));
    expect(named(nodes, "Content")!.fill).toBeFalsy();
    expect(nodes.find((n) => n.name === "9:41")!.fill?.token).toBe("text.primary");
  });

  it("lifts the body over the backdrop's bottom edge, drawn on top of it", () => {
    for (const [ts, pad] of [[FADE, 0], [BUILTIN, 16]] as const) {
      const nodes = lay(WALLET, ts);
      const backdrop = named(nodes, "Backdrop")!;
      const content = named(nodes, "Content")!;
      const root = nodes[0];
      expect(root.children.indexOf(content.id)).toBeGreaterThan(root.children.indexOf(backdrop.id));
      expect(bottom(backdrop) - content.y).toBeCloseTo(OVERLAP_PX.md, 1);
      const card = nodes.find((n) => n.meta.specPath === "body.0")!;
      expect(card.y).toBeCloseTo(pad, 1); // the sheet keeps a padding above its first section
    }
  });

  it("stays flat without a hero, whatever overlap says", () => {
    const flat: ScreenSpec = { ...WALLET, hero: [], overlap: "lg" };
    const nodes = lay(flat);
    expect(named(nodes, "Backdrop")).toBeUndefined();
    expect(nodes.find((n) => n.meta.component === "TopBar")!.fill?.token).toBe("component.top-bar.fill");
    expect(named(nodes, "Status bar")!.parentId).toBe(nodes[0].id);
  });

  it("draws web heroes behind the navigation, and gives dashboards none", () => {
    const [web] = HERO_FIXTURES;
    const nodes = lay(web);
    const backdrop = named(nodes, "Backdrop")!;
    const nav = named(nodes, "Navigation")!;
    expect(nav.parentId).toBe(backdrop.id);
    expect(nav.fill).toBeFalsy();
    expect(bottom(backdrop) - named(nodes, "Content")!.y).toBeCloseTo(OVERLAP_PX.lg, 1);

    const dash = lay({ ...web, platform: "dashboard", header: [], footer: [] });
    expect(named(dash, "Backdrop")).toBeUndefined();
    expect(dash.some((n) => n.meta.specPath === "hero.0")).toBe(true); // the hero leads the body instead
  });

  it("fades into a dark system's own canvas when the system predates the backdrop", () => {
    const tree = structuredClone(raw) as Tree;
    delete (tree.component as Tree).backdrop;
    setToken(tree, "bg.canvas", { $type: "color", $value: "#101418" });
    setToken(tree, "bg.brand-subtle", { $type: "color", $value: "#123B2E" });
    const ts = new TokenSet(completeTree(tree).tree);
    expect(ts.gradient("component.backdrop.fill")?.stops.map((s) => s.color)).toEqual(["#123B2E", "#101418"]);
  });
});

describe("self-check of heroes and overlaps", () => {
  const rules = (spec: ScreenSpec) => lintSpec(spec).map((i) => i.rule);

  it("passes the demo screens", () => {
    for (const s of HERO_DEMO_SCREENS) expect(rules(s).filter((r) => /hero|overlap|region/.test(r)), s.name).toEqual([]);
  });

  it("flags an overlap with no hero, or onto a section without a surface", () => {
    expect(rules({ ...WALLET, hero: [] })).toContain("overlap-without-hero");
    expect(rules({ ...WALLET, body: [{ component: "Text", props: { text: "Recent activity", style: "headline" } }, ...WALLET.body] })).toContain("overlap-surface");
    // Tiles are surfaces of their own.
    expect(rules({ ...WALLET, body: [WALLET.body[0].children![0], WALLET.body[1]] })).not.toContain("overlap-surface");
  });

  it("flags heroes on dashboards, crowded heroes and footer chrome in the hero", () => {
    expect(rules({ ...HERO_FIXTURES[0], platform: "dashboard" })).toContain("wrong-platform");
    const text = (t: string) => ({ component: "Text", props: { text: t, style: "body" } });
    expect(rules({ ...WALLET, hero: [text("One"), text("Two more"), text("Three"), text("Four"), text("Five")] })).toContain("hero-size");
    expect(rules({ ...WALLET, hero: [...WALLET.hero!, WALLET.footer![0]] })).toContain("wrong-region");
  });
});

describe("instances on a backdrop", () => {
  const SYS: DesignSystem = { id: "hero-sys", name: "Hero", source: "imported", tree: structuredClone(raw) as Tree, docs: BUILTIN_DOCS, fonts: [], createdAt: 1, updatedAt: 1 };
  beforeAll(async () => {
    await ensureYoga();
    setAutoLayoutEnabled(true);
    useSystems.getState().add(SYS, false);
  });
  afterAll(() => {
    setAutoLayoutEnabled(false);
    useSystems.setState({ activeId: BUILTIN_ID });
  });

  it("keeps the TopBar see-through when an edited screen's instances are rebuilt", async () => {
    const [id] = await insertScreens([WALLET], "ai", "hero-sys");
    const doc = () => studio().doc;
    const balance = descendants(doc(), id).find((k) => doc().nodes[k].name === "Available balance")!;
    studio().mutate((d) => {
      const n = d.nodes[balance];
      if (n.type === "text") n.text.content = "Balance today";
    });
    expect(isEdited(doc(), id)).toBe(true);

    const ds = useSystems.getState().systems.find((s) => s.id === "hero-sys")!;
    const tree = structuredClone(ds.tree);
    setToken(tree, "component.top-bar.height", { $type: "dimension", $value: "64px" });
    useSystems.getState().update("hero-sys", { tree, updatedAt: ds.updatedAt + 1 });
    studio().mutate((d) => staleRoots(d).forEach((r) => refreshRoot(d, r)), { history: false });

    const bar = descendants(doc(), id).map((k) => doc().nodes[k]).find((n) => n.meta.component === "TopBar")!;
    expect(bar.h).toBe(64);
    expect(bar.fill).toBeFalsy();
  });
});
