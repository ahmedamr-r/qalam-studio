import { beforeAll, describe, expect, it } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import { evaluate, transpile } from "@/ui/prototype/runtime";
import { foodMenuDoc } from "@/proto/fixtures/food-menu";
import { FOOD_BASKET } from "@/proto/fixtures/baskets";
import { applyDelta, fromList } from "@/proto/recipes";
import { scanFrame } from "@/proto/scan";
import { buildScreenNodes } from "@/design-system/place";
import { compilePrototype } from "./compile";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);

function compileMenu() {
  const { doc, ids } = foodMenuDoc();
  return { ...compilePrototype(doc, { typography, title: "Al Mallah" }), ids };
}

/** The menu and the basket it pushes to (its bar's button), the basket drawing the menu's lines. */
function compileBasket() {
  const { doc, ids } = foodMenuDoc();
  const nodes = buildScreenNodes(FOOD_BASKET, "builtin", { x: 4000, y: 0 }, "ai");
  for (const n of nodes) doc.nodes[n.id] = n;
  doc.roots.push(nodes[0].id);
  const menu = doc.proto!.routes![ids.menu];
  menu.rules.push({ id: "rGo", when: { on: "tap", ref: { part: "basket", path: "body.0" } }, then: [{ do: "go", screen: nodes[0].id, transition: { kind: "push", motion: "native" } }] });
  const lines = fromList(scanFrame(doc, nodes[0].id), { list: "app.basket", label: "basket" });
  doc.proto!.routes![nodes[0].id] = applyDelta({ overlays: {}, addOns: {}, rules: [] }, lines);
  return compilePrototype(doc, { typography, title: "Al Mallah, to the basket" });
}

type Entry = { screen: string; open: string[]; came?: string };
type Nav = Entry & { visit: number; history: Entry[]; group: number; anchors: Record<string, unknown>; data: Record<string, unknown> };
type Step = (n: Nav, a: Record<string, unknown>, anchor?: object) => Nav;
type Initial = (screen: string) => Nav;

describe("routes in the compiled prototype", () => {
  it("compiles a screen with a sheet and a bar: parts as components, rules as handlers, data as bindings", async () => {
    const r = compileMenu();
    expect(r.warnings).toEqual([]);
    // The parts play inside their screen, never as screens of their own.
    expect(r.screens.map((s) => s.name)).toEqual(["Al Mallah · Menu"]);
    expect(r.code).toContain("export function AlMallahMenuDishOptions({ act, s }: PartProps)");
    expect(r.code).toContain("export function AlMallahMenuBasketBar({ s }: PartProps)");
    expect(r.code).toContain(`options: { Part: AlMallahMenuDishOptions, kind: "sheet", dismiss: ["scrim", "drag", "back"], width: 390 }`);
    // A dish's + runs the rule that opens its options, about that dish (its own item id, not the section's).
    expect(r.code).toMatch(/\{\.\.\.tap\(\(e\) => act\(\{ do: "run", rule: "r\d+", it: "body\.2\.children\.0" \}, e\)\)\}/);
    expect(r.code).toContain(`s = openPart(s, "options", anchor, String(ITEMS.alMallahMenu.items[it ?? ""]?.id ?? ""));`);
    // Totals are built by the recipe and formatted the way the design writes money.
    expect(r.code).toContain("const money_alMallahMenu = (n: number) =>");
    // The bar shows once something's in the basket; the + becomes the count of that dish.
    expect(r.code).toContain("(s.app.basket ?? []).length > 0)) && (");
    expect(r.code).toContain(`<AnimatePresence initial={false} mode="popLayout">`);
    await expect(r.code).toMatchFileSnapshot("./__golden__/menu-overlays.tsx");
  });

  it("compiles a basket that draws the menu's basket: a row per line, its stepper changing that line, seeded from its design", async () => {
    const r = compileBasket();
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain("{(s.app.basket ?? []).map((el, i) => (");
    expect(r.code).toContain(`act({ do: "run", rule: "r1", it: String(i) }, e)`);
    expect(r.code).toContain("basketAlMallah: () => ({");
    await expect(r.code).toMatchFileSnapshot("./__golden__/basket-lines.tsx");
  });

  it("opens and closes parts, and Back closes the topmost overlay before it leaves", () => {
    const { code } = compileMenu();
    const { step, initial } = evaluate(transpile(code)) as { step: Step; initial: Initial };
    const start = initial("alMallahMenu");
    const sheet = step(start, { do: "open", part: "options" });
    expect(sheet.open).toEqual(["options"]);
    // Opening it twice, or a part the screen doesn't have, changes nothing.
    expect(step(sheet, { do: "open", part: "options" })).toBe(sheet);
    expect(step(start, { do: "open", part: "nowhere" })).toBe(start);
    // Back closes the sheet and stays on the screen.
    const back = step(sheet, { do: "back" });
    expect(back.open).toEqual([]);
    expect(back.visit).toBe(0);
    // A bar isn't an overlay: Back from a screen with only its bar open leaves (nowhere to go here).
    const bar = step(start, { do: "open", part: "basket" });
    expect(step(bar, { do: "close" })).toBe(bar);
    expect(step(bar, { do: "back" })).toBe(bar);
    // "close" without a part closes the topmost overlay.
    expect(step(step(bar, { do: "open", part: "options" }), { do: "close" }).open).toEqual(["basket"]);
  });

  it("remembers how each screen was gone to, so on iOS a pushed one swipes back to the one before, as it was left", () => {
    const { code } = compileBasket();
    // React Navigation's gesture numbers, and the screen under it worked out as Back leaves it.
    expect(code).toContain("const SWIPE = { edge: 50, start: 5, slack: 20, impact: 0.3 };");
    expect(code).toContain(`const back = nav.history.length ? move(nav, "back", BACK) : null;`);
    expect(code).toContain(`() => !!back && nav.came === "push" && arrived.current === nav.visit && !topOverlay(nav),`);
    const { step, initial } = evaluate(transpile(code)) as { step: Step; initial: Initial };
    const menu = step(initial("alMallahMenu"), { do: "open", part: "basket" });
    expect(menu.came).toBeUndefined();
    const basket = step(menu, { do: "go", to: "basketAlMallah", via: { kind: "push" } });
    expect(basket.came).toBe("push");
    // The menu is left with its bar up, and how it was gone to (it wasn't: it's where the prototype starts).
    expect(basket.history).toEqual([expect.objectContaining({ screen: "alMallahMenu", open: ["basket"], came: undefined })]);
    expect(step(basket, { do: "back" })).toMatchObject({ screen: "alMallahMenu", open: ["basket"], came: undefined });
    // On to the menu again and back: the basket was pushed, and still swipes back.
    const again = step(basket, { do: "go", to: "alMallahMenu", via: { kind: "push" } });
    expect(step(again, { do: "back" })).toMatchObject({ screen: "basketAlMallah", came: "push" });
    // Gone to as a sheet, it isn't a push.
    expect(step(menu, { do: "go", to: "basketAlMallah", via: { kind: "sheet" } }).came).toBe("sheet");
  });

  it("renders the menu with nothing open, and runs as Prototype mode runs it", () => {
    const { code } = compileMenu();
    const Played = (evaluate(transpile(code)) as { default: ComponentType }).default;
    const html = renderToString(createElement(Played));
    expect(html).toContain("Al Mallah");
    expect(html).toContain("Chicken shawarma");
    expect(html).not.toContain("Size · Required");
    expect(html).not.toContain("View basket");
  });
});
