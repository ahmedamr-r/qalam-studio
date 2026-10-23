import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import type { ScreenSpec } from "@/design-system/builders";
import { BUILTIN } from "@/design-system/resolve";
import { candidates } from "./agent/candidates";
import { blockDelta, blockIssues } from "./agent/blocks";
import { describeScreen } from "./agent/describe";
import { layerIndex } from "./agent/layers";
import { fixture } from "./fixtures/build";
import { BASKET_BAR, OPTIONS_SHEET } from "./fixtures/food-menu";
import { OWN_MENU, OWN_SHOP, TAP_MENU } from "./fixtures/own";
import { FASHION_BAG } from "./fixtures/baskets";
import { BAG_BAR, PRODUCT_SHEET } from "./fixtures/shop";
import { applyDelta, collectionBar, configureAndAdd, stickySections } from "./recipes";
import { lintRoute } from "./lint";
import { playPrototype } from "./runner";
import { addRef, scanFrame } from "./scan";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);

// What Generate draws when the design system has no dish row or product card: components of the screen's own.
describe("screens made of their own components", () => {
  it("menu: the dishes are items whose + is found by role, and headings over rows are sections the tabs name", () => {
    const f = fixture({ screen: OWN_MENU, parts: {}, steps: [] });
    const [col] = f.scan.collections;
    // The carousel's tiles and the sections' rows: every dish, the + the first of its actions.
    expect(col).toMatchObject({ pattern: "body.*.children.*", component: "Custom", action: "", nth: 0 });
    expect(col.items).toHaveLength(8);
    expect(f.scan.sections.map((s) => [s.title, s.component])).toEqual([
      ["Popular", "Carousel"],
      ["Sandwiches", "Stack"],
      ["Plates", "Stack"],
    ]);
    expect(f.scan.optionRows[0].sections).toEqual(["body.2", "body.3", "body.4"]);
    const cs = candidates(f.doc, f.screen);
    expect(cs.map((c) => c.recipe)).toEqual(expect.arrayContaining(["stickySections", "configureAndAdd", "collectionBar"]));
    expect(cs.find((c) => c.recipe === "configureAndAdd")!.what).toBe("8 items, each with a + (a Dish Tile or a Dish Row per item)");
    // Money as the dishes write it, not as the delivery fee does.
    expect(describeScreen(f.doc, f.screen)).toContain('- money is written like "AED 29.00"');
  });

  it("menu: a row's + further down opens its own options, Add fills the bar, and the tabs follow the sections", () => {
    const f = fixture({
      screen: OWN_MENU,
      parts: { options: OPTIONS_SHEET, basket: BASKET_BAR },
      steps: [(_, x) => stickySections(x.scan), (_, x) => configureAndAdd(x.scan, x.scanOf("options"), { part: "options" }), (_, x) => collectionBar(x.scan, x.scanOf("basket"), { part: "basket" })],
    });
    expect(f.skipped).toEqual([]);
    const col = f.scan.collections[0];
    const p = playPrototype(f.doc, { typography });
    expect(p.warnings).toEqual([]);
    // The 5th dish: Beef shawarma, in Sandwiches.
    expect(p.tap({ ...addRef(col, col.items[4]) })).toBe(true);
    expect(p.state.open).toEqual(["options"]);
    expect(p.textOf("options")).toContain("Beef shawarma");
    expect(p.textOf("options")).toContain("Add · AED 17.00");
    p.tap({ part: "options", name: "Button/Primary" });
    expect(p.text()).toContain("View basket · AED 17.00");
    // Its + shows how many are in, and only its own.
    expect(p.tap({ ...addRef(col, col.items[3]) })).toBe(true);
    expect(p.textOf("options")).toContain("Chicken shawarma");
  });

  it("menu: tiles with no + of their own aren't items; the rows' + still opens their options, and the route checks out", () => {
    // The carousel's tiles show a dish without a + (tapping the tile is the product's call, not an add).
    const bare: ScreenSpec = {
      ...OWN_MENU,
      components: OWN_MENU.components!.map((d) => (d.name === "Dish Tile" ? { ...d, composition: { ...d.composition, children: d.composition.children!.slice(0, 2) } } : d)),
    };
    const f = fixture({ screen: bare, parts: { options: OPTIONS_SHEET, basket: BASKET_BAR }, steps: [(_, x) => configureAndAdd(x.scan, x.scanOf("options"), { part: "options" }), (_, x) => collectionBar(x.scan, x.scanOf("basket"), { part: "basket" })] });
    const [col] = f.scan.collections;
    expect(col).toMatchObject({ component: "Custom/Dish Row", nth: 0 });
    expect(col.items).toHaveLength(5);
    expect(lintRoute(f.doc, f.screen)).toEqual([]);
    const p = playPrototype(f.doc, { typography });
    expect(p.warnings).toEqual([]);
    expect(p.tap({ ...addRef(col, col.items[0]) })).toBe(true);
    expect(p.textOf("options")).toContain("Chicken shawarma");
  });

  it("menu tapped by dish: items with a price and no + are chosen by tapping them, and a basket isn't taken for a menu", () => {
    const f = fixture({ screen: TAP_MENU, parts: { options: OPTIONS_SHEET, basket: BASKET_BAR }, steps: [(_, x) => configureAndAdd(x.scan, x.scanOf("options"), { part: "options" }), (_, x) => collectionBar(x.scan, x.scanOf("basket"), { part: "basket" })] });
    const [col] = f.scan.collections;
    expect(col).toMatchObject({ component: "ListItem", action: "", items: ["body.1.children.0", "body.1.children.2", "body.2.children.0", "body.2.children.2"] });
    expect(col.nth).toBeUndefined();
    const bareMenu = fixture({ screen: TAP_MENU, parts: {}, steps: [] });
    expect(candidates(bareMenu.doc, bareMenu.screen).find((c) => c.recipe === "configureAndAdd")!.what).toBe("4 items with a price, each tapped to choose it (a listitem per item)");
    expect(lintRoute(f.doc, f.screen).filter((x) => x.severity === "error")).toEqual([]);
    const p = playPrototype(f.doc, { typography });
    expect(p.warnings).toEqual([]);
    expect(p.tap({ path: col.items[2] })).toBe(true);
    expect(p.textOf("options")).toContain("Mixed grill");
    p.tap({ part: "options", path: "footer.0.children.1" });
    expect(p.text()).toContain("View basket · AED 46.00");
    // No + to show the count on: the dish stays as it is.
    expect(p.textOf()).toContain("Mixed grill Kofta, tawook, rice AED 46.00");
    // A basket's priced rows sum up to a total: not a menu.
    expect(scanFrame(fixture({ screen: FASHION_BAG, parts: {}, steps: [] }).doc, fixture({ screen: FASHION_BAG, parts: {}, steps: [] }).screen).collections).toEqual([]);
  });

  it("shop: the card's Add is found past its heart; a heart asked for flips per product", () => {
    const f = fixture({ screen: OWN_SHOP, parts: { options: PRODUCT_SHEET, bag: BAG_BAR }, steps: [(_, x) => configureAndAdd(x.scan, x.scanOf("options"), { part: "options", list: "bag" })] });
    const [col] = f.scan.collections;
    expect(col).toMatchObject({ component: "Custom/Product Card", action: "", nth: 1, items: ["body.0.children.0", "body.0.children.1", "body.1.children.0", "body.1.children.1"] });
    // What an ask can point at: each card, and the buttons in it with the props its definition gives them.
    const layers = layerIndex(f.doc, f.screen);
    const heart = layers.find((l) => l.what.startsWith('IconButton "Save" (icon heart) in Product Card'))!;
    expect(heart).toMatchObject({ each: true, component: "IconButton", ref: { path: col.pattern, sub: { role: "action", nth: 0 } }, props: { icon: "heart", variant: "ghost" } });
    expect(layers.find((l) => l.component === "Custom")).toMatchObject({ what: 'Product Card "Linen shirt", in each item', each: true });
    const byId = new Map(layers.map((l) => [l.id, l]));
    const block = { kind: "toggle-look" as const, on: heart.id, look: [{ prop: "variant", value: "brand" }] };
    expect(blockIssues(block, byId)).toEqual([]);
    const { delta } = blockDelta(block, f.doc.proto!.routes![f.screen], byId, f.scan);
    f.doc.proto!.routes![f.screen] = applyDelta(f.doc.proto!.routes![f.screen], delta);
    const p = playPrototype(f.doc, { typography });
    expect(p.warnings).toEqual([]);
    expect(p.tap({ path: col.items[2], sub: { role: "action", nth: 0 } })).toBe(true);
    expect(p.state.data.toggled).toEqual(["body.1.children.0"]);
    // Add opens the product's own options.
    expect(p.tap({ ...addRef(col, col.items[1]) })).toBe(true);
    expect(p.textOf("options")).toContain("Wide trousers");
    expect(scanFrame(f.doc, f.screen).collections).toHaveLength(1);
  });
});
