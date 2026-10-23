import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import type { Doc } from "@/doc/schema";
import { compilePrototype } from "@/codegen/compile";
import { evaluate, transpile } from "@/ui/prototype/runtime";
import { foodMenuDoc } from "./fixtures/food-menu";
import { rideFixture, RIDES } from "./fixtures/ride";
import { bankFixture } from "./fixtures/bank";
import { dashboardFixture } from "./fixtures/dashboard";
import { shopFixture } from "./fixtures/shop";
import { groceryFixture } from "./fixtures/grocery";
import { ordersFixture } from "./fixtures/orders";
import { walkthrough, type Machine } from "./walk";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);

/** A document's compiled machine, and the key of the screen whose route it walks. */
function machine(doc: Doc, screen: string) {
  const r = compilePrototype(doc, { typography });
  const mod = evaluate(transpile(r.code)) as unknown as Machine;
  return { mod, key: r.screens.find((s) => s.id === screen)!.key };
}

const FIXTURES: Record<string, () => { doc: Doc; screen: string }> = {
  food: () => {
    const { doc, ids } = foodMenuDoc();
    return { doc, screen: ids.menu };
  },
  shop: shopFixture,
  grocery: groceryFixture,
  ride: rideFixture,
  bank: bankFixture,
  dashboard: dashboardFixture,
  orders: ordersFixture,
};

describe("walkthroughs", () => {
  it.each(Object.keys(FIXTURES))("%s: every step has a clip, and every tap in it does something", (k) => {
    const f = FIXTURES[k]();
    const { mod, key } = machine(f.doc, f.screen);
    const w = walkthrough(mod, f.doc, f.screen, key, { max: 900 });
    expect(w.clips.map((c) => c.step.id)).toEqual(f.doc.proto!.routes![f.screen].steps!.map((s) => s.id));
    expect(w.dead).toEqual([]);
  });

  it("menu: the walkthrough ends with a dish in the basket, configured, and each clip starts where the last one ended", () => {
    const f = FIXTURES.food();
    const { mod, key } = machine(f.doc, f.screen);
    const w = walkthrough(mod, f.doc, f.screen, key, { max: 900 });
    expect(w.clips.map((c) => c.step.recipe)).toEqual(["headerOnScroll", "stickySections", "configureAndAdd", "collectionBar"]);
    expect(w.end.state.app.basket).toEqual([expect.objectContaining({ title: "Chicken shawarma", qty: 2 })]);
    // The basket bar's clip starts with the dish added; the dish's, back on the first section.
    expect((w.clips[3].from.state.app as { basket: unknown[] }).basket).toHaveLength(1);
    expect(w.clips[2].from.state.data.section).toBe("body.2");
  });

  it("dashboard: picking a plan first shows the tab its section is under", () => {
    const f = dashboardFixture();
    const { mod, key } = machine(f.doc, f.screen);
    const w = walkthrough(mod, f.doc, f.screen, key, { max: 400 });
    const pick = w.clips.find((c) => c.step.recipe === "chooseOne")!;
    expect(pick.actions[0]).toEqual({ do: "tap", ref: { path: "body.0", sub: { role: "option", nth: 2 } } });
    // Deleting asks from General, so that clip shows General first.
    const del = w.clips.find((c) => c.step.recipe === "confirmFirst")!;
    expect(del.actions[0]).toEqual({ do: "tap", ref: { path: "body.0", sub: { role: "option", nth: 0 } } });
    expect(w.end.state.open).toEqual(["deleted"]);
  });

  it("ride: the pick, the confirm and the toast play in order", () => {
    const f = rideFixture();
    const { mod, key } = machine(f.doc, f.screen);
    const w = walkthrough(mod, f.doc, f.screen, key, { max: 400 });
    expect(w.clips.map((c) => c.step.label)).toEqual([`Picking an option makes "Book ${RIDES[0][0]} · ${RIDES[0][2]}" say which`, `"Book ${RIDES[0][0]} · ${RIDES[0][2]}" asks first, in a dialog`, "A toast says it's done"]);
    expect(w.clips[2].from.state.open).toEqual(["finding"]);
    expect(w.end.state.data.ride).toBe("body.2.children.1");
  });
});
