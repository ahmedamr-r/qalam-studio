import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { fixture } from "../fixtures/build";
import { MENU_SCREEN } from "../fixtures/food-menu";
import { RIDE_SCREEN } from "../fixtures/ride";
import { TRANSFER_SCREEN } from "../fixtures/bank";
import { SETTINGS_SCREEN } from "../fixtures/dashboard";
import { SHOP_SCREEN } from "../fixtures/shop";
import { GROCERY_SCREEN } from "../fixtures/grocery";
import { ORDERS_SCREEN } from "../fixtures/orders";
import { foodMenuDoc } from "../fixtures/food-menu";
import { candidates } from "./candidates";

beforeAll(async () => {
  await ensureYoga();
});

/** A screen alone: nothing prototyped yet. */
const bare = (screen: typeof MENU_SCREEN) => {
  const f = fixture({ screen, parts: {}, steps: [] });
  return candidates(f.doc, f.screen);
};
const brief = (cs: ReturnType<typeof candidates>) => cs.map((c) => `${c.id} ${c.recipe}${c.needs ? ` needs ${c.needs.kind}` : ""}${c.after ? ` after ${c.after}` : ""}${c.instead ? ` instead of ${c.instead}` : ""}${c.recommended ? "" : " (not recommended)"}`);

describe("what could be prototyped", () => {
  it("menu: chips that scroll to their section, a + that opens a sheet, the basket bar after it and the page it opens, the header", () => {
    const cs = bare(MENU_SCREEN);
    expect(brief(cs)).toEqual(["c1 stickySections", "c2 configureAndAdd needs sheet", "c3 collectionBar needs bar after c2", "c4 nextPage after c3", "c5 headerOnScroll"]);
    expect(cs[3]).toMatchObject({ what: "the bar's button, to the page it opens", opts: { from: "bar" } });
  });

  it("shop and grocery: the same, on other products", () => {
    for (const s of [SHOP_SCREEN, GROCERY_SCREEN]) expect(bare(s).map((c) => c.recipe)).toEqual(["stickySections", "configureAndAdd", "collectionBar", "nextPage", "headerOnScroll"]);
  });

  it("ride: a ride type to pick; booking moves money, so it may ask first, then the page it leads to (a toast as well isn't needed)", () => {
    expect(brief(bare(RIDE_SCREEN))).toEqual(["c1 chooseOne", "c2 confirmFirst needs dialog", "c3 toastAfter needs toast after c2 (not recommended)", "c4 nextPage"]);
  });

  it("bank: tabs that show their section, an amount to pick, a send that asks first, then where it leads", () => {
    expect(brief(bare(TRANSFER_SCREEN))).toEqual(["c1 tabPanels", "c2 chooseOne", "c3 confirmFirst needs dialog", "c4 toastAfter needs toast after c3 (not recommended)", "c5 nextPage"]);
  });

  it("dashboard: tabs (switching, or scrolling, as an alternative), a plan, an upgrade and a delete that ask first", () => {
    const cs = bare(SETTINGS_SCREEN);
    expect(brief(cs)).toEqual([
      "c1 stickySections instead of c2 (not recommended)",
      "c2 tabPanels instead of c1",
      "c3 chooseOne",
      "c4 confirmFirst needs dialog",
      "c5 toastAfter needs toast after c4 (not recommended)",
      "c6 nextPage",
      "c7 confirmFirst needs dialog",
      "c8 toastAfter needs toast after c7",
    ]);
    expect(cs.find((c) => c.id === "c4")!.what).toContain("moves money");
    expect(cs.find((c) => c.id === "c7")!.what).toContain("can't be undone");
  });

  it("orders: tabs", () => {
    expect(bare(ORDERS_SCREEN).filter((c) => c.recommended).map((c) => c.recipe)).toEqual(["tabPanels"]);
  });

  it("leaves out what's built, and uses the parts the route has", () => {
    const { doc, ids } = foodMenuDoc();
    // The menu's route has its four steps: what's left is where its bar leads.
    expect(candidates(doc, ids.menu).map((c) => [c.recipe, c.at])).toEqual([["nextPage", { part: "basket", path: "body.0" }]]);
    const bareRoute = { ...doc, proto: { ...doc.proto!, routes: { [ids.menu]: { ...doc.proto!.routes![ids.menu], steps: [] } } } };
    const cs = candidates(bareRoute, ids.menu);
    expect(cs.find((c) => c.recipe === "configureAndAdd")).toMatchObject({ part: "options" });
    expect(cs.find((c) => c.recipe === "collectionBar")).toMatchObject({ part: "basket" });
  });
});
