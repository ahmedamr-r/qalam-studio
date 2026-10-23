import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import type { ScreenSpec } from "@/design-system/builders";
import { fixture } from "../fixtures/build";
import { MENU_SCREEN, OPTIONS_SHEET } from "../fixtures/food-menu";
import { RIDE_SCREEN } from "../fixtures/ride";
import { TRANSFER_SCREEN } from "../fixtures/bank";
import { SETTINGS_SCREEN } from "../fixtures/dashboard";
import { GROCERY_SCREEN, ITEM_SHEET } from "../fixtures/grocery";
import { playPrototype } from "../runner";
import { candidates } from "./candidates";
import { buildSteps, partIssues } from "./build";
import { scanFrame } from "../scan";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);
const bare = (screen: ScreenSpec) => fixture({ screen, parts: {}, steps: [] });

/** Every recommended candidate, built with what code writes. */
function buildAll(screen: ScreenSpec) {
  const f = bare(screen);
  const cs = candidates(f.doc, f.screen).filter((c) => c.recommended);
  const out = buildSteps(f.doc, f.screen, cs.map((candidate) => ({ candidate })), { typography });
  return { ...out, f, cs };
}

describe("building picked steps", () => {
  it.each([
    ["menu", MENU_SCREEN],
    ["ride", RIDE_SCREEN],
    ["bank", TRANSFER_SCREEN],
    ["dashboard", SETTINGS_SCREEN],
    ["grocery", GROCERY_SCREEN],
  ] as const)("%s: every recommended step builds, with parts code writes, and the route passes", (_, screen) => {
    const { results, doc, f, cs } = buildAll(screen);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    const route = doc.proto!.routes![f.screen];
    // In the order offered, the steps that leave the screen last.
    const leaving = (r: string) => r === "nextPage";
    expect(route.steps!.map((s) => s.recipe)).toEqual([...cs.filter((c) => !leaving(c.recipe)), ...cs.filter((c) => leaving(c.recipe))].map((c) => c.recipe));
    expect(playPrototype(doc, { typography }).warnings).toEqual([]);
  });

  it("menu: the bar's button goes on to the basket, not designed yet, and Back comes back to the menu as it was", () => {
    const { doc, f } = buildAll(MENU_SCREEN);
    expect(doc.proto!.routes![f.screen].next).toEqual({ basket: { name: "Basket", brief: 'What "View basket" opens' } });
    const p = playPrototype(doc, { typography });
    p.tap({ path: "body.2.children.2.children.1" });
    p.tap({ part: p.state.open[0], name: "Button/Primary" });
    const menu = p.state.screen;
    const bar = Object.keys(doc.proto!.routes![f.screen].addOns)[0];
    expect(p.tap({ part: bar, name: "Button/Primary" })).toBe(true);
    expect(p.state.screen).toBe("basketPage");
    expect(p.text()).toContain("Basket Not designed yet");
    p.back();
    expect(p.state.screen).toBe(menu);
    expect(p.text()).toContain("View basket · AED 14.00");
  });

  it("ride: booking asks first, and its Confirm goes on to the next page", () => {
    const { doc, f } = buildAll(RIDE_SCREEN);
    const route = doc.proto!.routes![f.screen];
    const dialog = Object.entries(route.overlays).find(([, o]) => o.kind === "dialog")![0];
    // The page's rule moved to the dialog's confirm: Book only asks.
    const next = route.rules.find((ru) => ru.then.some((a) => a.do === "next"))!;
    expect(next.when).toMatchObject({ on: "tap", ref: { part: dialog } });
    const p = playPrototype(doc, { typography });
    const book = scanFrame(doc, f.screen).primary!;
    p.tap({ path: book.path });
    expect(p.state.open).toEqual([dialog]);
    p.tap({ part: dialog, name: "Button/Primary" });
    expect(p.state.screen).toMatch(/Page$/);
    expect(p.state.open).toEqual([]);
  });

  it("menu: the + opens a sheet code wrote about the dish tapped, and Add fills the bar code wrote", () => {
    const { doc } = buildAll(MENU_SCREEN);
    const p = playPrototype(doc, { typography });
    expect(p.tap({ path: "body.2.children.2.children.1" })).toBe(true);
    const sheet = p.state.open[0];
    expect(p.textOf(sheet)).toContain("Falafel wrap");
    expect(p.textOf(sheet)).toContain("Add · AED 14.00");
    p.tap({ part: sheet, name: "Increase" });
    expect(p.textOf(sheet)).toContain("Add · AED 28.00");
    p.tap({ part: sheet, name: "Button/Primary" });
    expect(p.text()).toContain("View basket · AED 28.00");
  });

  it("uses what the model wrote for a part, and code's words when that doesn't pass", () => {
    const f = bare(MENU_SCREEN);
    const cs = candidates(f.doc, f.screen);
    const configure = cs.find((c) => c.recipe === "configureAndAdd")!;
    const good = buildSteps(f.doc, f.screen, [{ candidate: configure, part: OPTIONS_SHEET, label: "Tap a dish to pick its size and extras" }], { typography });
    expect(good.results).toEqual([{ id: configure.id, ok: true, issues: [], wrote: "model" }]);
    expect(good.doc.proto!.routes![f.screen].steps![0].label).toBe("Tap a dish to pick its size and extras");
    // A sheet with no main action can't add anything: code's own sheet stands in.
    const broken: ScreenSpec = { ...OPTIONS_SHEET, footer: [] };
    const fallback = buildSteps(f.doc, f.screen, [{ candidate: configure, part: broken }], { typography });
    expect(fallback.results[0]).toMatchObject({ ok: true, wrote: "code" });
  });

  it("leaves out a step that can't be built, and builds the rest", () => {
    const f = bare(MENU_SCREEN);
    const cs = candidates(f.doc, f.screen);
    const bar = cs.find((c) => c.recipe === "collectionBar")!;
    const header = cs.find((c) => c.recipe === "headerOnScroll")!;
    // A bar with nothing in it to show.
    const out = buildSteps(f.doc, f.screen, [{ candidate: { ...bar, needs: undefined, part: "nowhere" } }, { candidate: header }], { typography });
    expect(out.results.map((r) => r.ok)).toEqual([false, true]);
    expect(out.doc.proto!.routes![f.screen].steps!.map((s) => s.recipe)).toEqual(["headerOnScroll"]);
  });

  it("hold a written part to its job, and to the screen's money", () => {
    const g = bare(GROCERY_SCREEN);
    const screen = scanFrame(g.doc, g.screen);
    const scanOf = (spec: ScreenSpec) => {
      const f = fixture({ screen: spec, parts: {}, steps: [] });
      return scanFrame(f.doc, f.screen);
    };
    expect(partIssues("options", scanOf(ITEM_SHEET), screen)).toEqual([]);
    // What the model wrote live: Latin digits, no riyals.
    const latin = { ...ITEM_SHEET, footer: [{ component: "Button", props: { label: "أضف إلى السلة · 12.50", variant: "primary", fullWidth: true } }] } as ScreenSpec;
    expect(partIssues("options", scanOf(latin), screen)).toEqual([`Its "أضف إلى السلة · 12.50" doesn't show the price.`]);
    const dollars = { ...ITEM_SHEET, footer: [{ component: "Button", props: { label: "أضف · $12.50", variant: "primary", fullWidth: true } }] } as ScreenSpec;
    expect(partIssues("options", scanOf(dollars), screen)[0]).toMatch(/not the way the screen does/);
    const m = bare(MENU_SCREEN);
    const ask = { ...ITEM_SHEET, dir: "ltr", lang: "en", surface: "dialog", header: [{ component: "Text", props: { text: "Send AED 100.00?", style: "title" } }], body: [], footer: [{ component: "Button", props: { label: "Send", variant: "primary", fullWidth: true } }] } as ScreenSpec;
    expect(partIssues("confirm", scanOf(ask), scanFrame(m.doc, m.screen))).toEqual(["The dialog has no button to back out."]);
  });
});
