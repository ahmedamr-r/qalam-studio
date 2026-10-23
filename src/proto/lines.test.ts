import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import type { ScreenSpec } from "@/design-system/builders";
import { buildScreenNodes } from "@/design-system/place";
import type { Doc } from "@/doc/schema";
import { compilePrototype } from "@/codegen/compile";
import { candidates } from "./agent/candidates";
import { buildSteps } from "./agent/build";
import { foodMenuDoc } from "./fixtures/food-menu";
import { shopFixture } from "./fixtures/shop";
import { FASHION_BAG, FOOD_BASKET, GROCERY_BASKET } from "./fixtures/baskets";
import { fixture, text } from "./fixtures/build";
import { lintRoute } from "./lint";
import { newRuleId } from "./routes";
import { playPrototype } from "./runner";
import { scanFrame } from "./scan";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);

/** A screen whose bar goes to `page` (drawn from `spec`), and the page's lines built from the list the screen fills. */
function journey(source: { doc: Doc; screen: string; bar: string }, spec: ScreenSpec) {
  const doc = source.doc;
  const nodes = buildScreenNodes(spec, "builtin", { x: 4000, y: 0 }, "ai");
  for (const n of nodes) doc.nodes[n.id] = n;
  doc.roots.push(nodes[0].id);
  const page = nodes[0].id;
  const route = doc.proto!.routes![source.screen];
  route.rules.push({ id: newRuleId(route), when: { on: "tap", ref: { part: source.bar, path: "body.0" } }, then: [{ do: "go", screen: page, transition: { kind: "push", motion: "native" } }] });
  const cs = candidates(doc, page).filter((c) => c.recipe === "fromList");
  const out = buildSteps(doc, page, cs.map((candidate) => ({ candidate })), { typography });
  const keys = compilePrototype(out.doc, { typography }).screens;
  return { ...out, page, cs, key: (id: string) => keys.find((s) => s.id === id)!.key };
}

const food = () => {
  const { doc, ids } = foodMenuDoc();
  return journey({ doc, screen: ids.menu, bar: "basket" }, FOOD_BASKET);
};

describe("lines from a list", () => {
  it("are found by role: rows with a title and an amount, a note, how many — not items to add", () => {
    const at = (spec: ScreenSpec) => {
      const f = fixture({ screen: spec, parts: {}, steps: [] });
      return scanFrame(f.doc, f.screen).lines;
    };
    expect(at(FOOD_BASKET)).toMatchObject({ rows: ["body.0.children.1", "body.0.children.3"], component: "Stack", title: "Chicken Arabic platter", note: "Large · Garlic sauce", qty: "body.0.children.1.children.2" });
    expect(at(FASHION_BAG)).toMatchObject({ rows: ["body.0.children.0", "body.0.children.2"], component: "ListItem", title: "Linen shirt", note: "Size M · Sand", qty: null });
    expect(at(GROCERY_BASKET)).toMatchObject({ rows: ["body.0.children.0", "body.0.children.2"], title: "تفاح أحمر", note: "كيس ٢ كغ" });
    // A menu's dishes are items to add, not lines.
    const { doc, ids } = foodMenuDoc();
    expect(scanFrame(doc, ids.menu).lines).toBeNull();
  });

  it("food: what was added on the menu is the basket's lines, noted with what was picked; totals follow, and a line's stepper changes it", () => {
    const j = food();
    expect(j.cs.map((c) => c.opts)).toEqual([{ list: "app.basket", label: "basket" }]);
    expect(j.results.filter((r) => !r.ok)).toEqual([]);
    expect(lintRoute(j.doc, j.page).filter((x) => x.severity === "error")).toEqual([]);
    const p = playPrototype(j.doc, { typography });
    expect(p.warnings).toEqual([]);
    // Two large Chicken shawarmas with cheese; a regular Falafel wrap.
    p.tap({ path: "body.2.children.0.children.1" });
    p.tap({ part: "options", path: "body.1.children.1" });
    p.tap({ part: "options", path: "body.2.children.1" });
    p.tap({ part: "options", name: "Increase" });
    p.tap({ part: "options", path: "footer.0.children.1" });
    p.tap({ path: "body.2.children.2.children.1" });
    p.tap({ part: "options", path: "footer.0.children.1" });
    expect(p.tap({ part: "basket", path: "body.0" })).toBe(true);
    expect(p.state.screen).toBe(j.key(j.page));
    const t = p.text();
    expect(t).toContain("Chicken shawarma Large · Cheese AED 54.00 2");
    expect(t).toContain("Falafel wrap Regular AED 14.00 1");
    // The design's own sample lines made way.
    expect(t).not.toContain("Chicken Arabic platter");
    expect(t).toContain("Subtotal AED 68.00");
    expect(t).toContain("Delivery fee AED 5.00");
    expect(t).toContain("Total AED 73.00");
    expect(t).toContain("Checkout · AED 73.00");
    // The first line's +: three of them now.
    const qty = scanFrame(j.doc, j.page).lines!.qty!;
    p.tap({ path: qty, sub: { role: "increase" } });
    expect(p.text()).toContain("Chicken shawarma Large · Cheese AED 81.00 3");
    expect(p.text()).toContain("Total AED 100.00");
    // Down below one, it leaves the basket.
    for (let i = 0; i < 3; i++) p.tap({ path: qty, sub: { role: "decrease" } });
    expect(p.text()).not.toContain("Chicken shawarma");
    expect(p.text()).toContain("Total AED 19.00");
  });

  it("sum up by the summary's rows: prices of what's suggested between the lines and the summary aren't fees", () => {
    const suggest = (title: string, price: string) => ({ component: "Card", props: { tone: "raised" }, children: [text(title, "body-strong"), text(price, "label")] });
    const withSuggestions: ScreenSpec = {
      ...FOOD_BASKET,
      body: [FOOD_BASKET.body![0], { component: "Text", props: { text: "Popular with this order", style: "headline" } }, { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [suggest("Hummus", "AED 28.00"), suggest("Spicy fries", "AED 8.00")] }, FOOD_BASKET.body![1]],
    };
    // One line with a stepper, three priced rows suggested under it: the line is the line.
    const one: ScreenSpec = {
      ...FOOD_BASKET,
      body: [
        { ...FOOD_BASKET.body![0], children: FOOD_BASKET.body![0].children!.slice(0, 2) },
        { component: "Stack", props: { direction: "vertical", gap: "200" }, children: ["Fries with toum", "Hummus", "Fattoush"].map((t, i) => ({ component: "Stack", props: { direction: "horizontal", gap: "200" }, children: [text(t, "body-strong"), text(`AED ${11 + i * 3}.00`, "label")] })) },
        FOOD_BASKET.body![1],
      ],
    };
    const f1 = fixture({ screen: one, parts: {}, steps: [] });
    expect(scanFrame(f1.doc, f1.screen).lines).toMatchObject({ rows: ["body.0.children.1"], title: "Chicken Arabic platter" });
    const { doc, ids } = foodMenuDoc();
    const j = journey({ doc, screen: ids.menu, bar: "basket" }, withSuggestions);
    expect(j.results.filter((r) => !r.ok)).toEqual([]);
    const t = playPrototype(j.doc, { typography, start: j.key(j.page) }).text();
    expect(t).toContain("Hummus AED 28.00");
    expect(t).toContain("Spicy fries AED 8.00");
    expect(t).toContain("Subtotal AED 88.00");
    expect(t).toContain("Total AED 93.00");
    expect(t).toContain("Checkout · AED 93.00");
  });

  it("starts with the lines the design shows when the prototype starts on the basket", () => {
    const j = food();
    const p = playPrototype(j.doc, { typography, start: j.key(j.page) });
    const t = p.text();
    expect(t).toContain("Chicken Arabic platter Large · Garlic sauce AED 74.00 2");
    expect(t).toContain("Falafel wrap Regular AED 14.00 1");
    expect(t).toContain("Subtotal AED 88.00");
    expect(t).toContain("Total AED 93.00");
  });

  it("shop: list rows in euros, shipping free, no steppers", () => {
    const f = shopFixture();
    const j = journey({ doc: f.doc, screen: f.screen, bar: "bag" }, FASHION_BAG);
    expect(j.results.filter((r) => !r.ok)).toEqual([]);
    const p = playPrototype(j.doc, { typography });
    p.tap({ path: scanFrame(f.doc, f.screen).collections[0].items[0] + "." + scanFrame(f.doc, f.screen).collections[0].action });
    p.tap({ part: "options", path: "body.1.children.1" });
    p.tap({ part: "options", path: "footer.0.children.1" });
    p.tap({ part: "bag", path: "body.0" });
    const t = p.text();
    expect(t).toContain("Linen shirt M · Sand 39,90 €");
    expect(t).not.toContain("Wide jeans");
    expect(t).toContain("Subtotal 39,90 €");
    expect(t).toContain("Shipping Free");
    expect(t).toContain("Total 39,90 €");
  });

  it("grocery: right to left, in riyals and Arabic digits, from the design when it starts there", () => {
    const f = fixture({ screen: GROCERY_BASKET, parts: {}, steps: [] });
    // The basket a grocery fills (as its own route would), and this basket reading it.
    f.doc.proto = { links: [], states: {}, tracks: [], routes: { [f.screen]: { overlays: {}, addOns: {}, rules: [] } }, vars: { basket: { type: { t: "list", fields: { item: "text", title: "text", note: "text", qty: "int", unit: "money" } }, init: [], label: "Basket" } } };
    const out = buildSteps(f.doc, f.screen, [{ candidate: { id: "c1", recipe: "fromList", what: "lines", at: { path: "body.0.children.0" }, opts: { list: "app.basket", label: "basket" }, main: true, recommended: true } }], { typography });
    expect(out.results.filter((r) => !r.ok)).toEqual([]);
    const t = playPrototype(out.doc, { typography }).text();
    expect(t).toContain("تفاح أحمر كيس ٢ كغ ٢٥٫٠٠ ر.س");
    expect(t).toContain("طماطم ١ كغ ١١٫٠٠ ر.س");
    expect(t).toContain("الإجمالي ٤١٫٠٠ ر.س");
  });
});
