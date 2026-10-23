import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import type { Doc } from "@/doc/schema";
import { lintRoute } from "./lint";
import { findMoney, formatMoney } from "./money";
import { playPrototype } from "./runner";
import { scanFrame } from "./scan";
import { foodMenuDoc } from "./fixtures/food-menu";
import { rideFixture, RIDES } from "./fixtures/ride";
import { bankFixture, AMOUNTS } from "./fixtures/bank";
import { dashboardFixture, PLANS } from "./fixtures/dashboard";
import { shopFixture, PRODUCTS } from "./fixtures/shop";
import { groceryFixture, GROCERY, ITEM_SHEET, PRODUCE } from "./fixtures/grocery";
import { fixture } from "./fixtures/build";
import type { ScreenSpec } from "@/design-system/builders";
import { ordersFixture } from "./fixtures/orders";

/*
 * Every recipe, on at least three kinds of product: what it does is checked by playing the
 * compiled prototype, and what each screen should say is worked out from the fixture's own copy.
 */

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);
type Built = { doc: Doc; screen: string; skipped?: string[] };
const FIXTURES: Record<string, () => Built> = {
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
const play = (f: Built) => playPrototype(f.doc, { typography });
/** An amount written the way `like` writes one. */
const money = (minor: number, like: string, plus = false) => formatMoney(minor, findMoney(like)!.format, plus);
const amount = (text: string) => findMoney(text)!.amount;

describe("every fixture", () => {
  it.each(Object.keys(FIXTURES))("%s: its recipes all apply, it compiles cleanly and passes its checks", (k) => {
    const f = FIXTURES[k]();
    expect(f.skipped ?? []).toEqual([]);
    expect(play(f).warnings).toEqual([]);
    expect(lintRoute(f.doc, f.screen)).toEqual([]);
  });
});

describe("header on scroll", () => {
  it.each(["food", "shop", "grocery", "orders"])("%s: the top bar compacts once content scrolls under it", (k) => {
    const p = play(FIXTURES[k]());
    expect(p.state.data.scrolled).toBe(false);
    p.scroll(400);
    expect(p.state.data.scrolled).toBe(true);
    p.scroll(0);
    expect(p.state.data.scrolled).toBe(false);
  });
});

describe("sticky sections", () => {
  it.each(["food", "shop", "grocery"])("%s: a chip scrolls to its section, and scrolling gives every section its turn", (k) => {
    const f = FIXTURES[k]();
    const sections = scanFrame(f.doc, f.screen).sections;
    const chips = scanFrame(f.doc, f.screen).optionRows[0].labels;
    const p = play(f);
    expect(p.state.data.section).toBe(sections[0].path);
    const last = sections[sections.length - 1];
    expect(p.tap({ name: `Chip/${chips[chips.indexOf(last.title)]}` })).toBe(true);
    expect(p.state.data.section).toBe(last.path);
    const max = p.state.scrollTo!.y - 10;
    const walk = play(f);
    const seen: unknown[] = [];
    for (let y = 0; y <= max; y += 8) {
      walk.scroll(y, max);
      if (seen[seen.length - 1] !== walk.state.data.section) seen.push(walk.state.data.section);
    }
    walk.scroll(max, max);
    if (seen[seen.length - 1] !== walk.state.data.section) seen.push(walk.state.data.section);
    expect(seen).toEqual(sections.map((s) => s.path));
  });
});

describe("configure and add, and the collection bar", () => {
  it("food: a dish's options start at its price, and Add shows the basket bar with it", () => {
    const f = FIXTURES.food();
    const p = play(f);
    const scan = scanFrame(f.doc, f.screen);
    const first = scan.collections[0];
    expect(p.tap({ path: `${first.items[1]}.${first.action}` })).toBe(true);
    expect(p.textOf("options")).toContain("Add · AED 14.00");
    p.tap({ part: "options", path: "footer.0.children.1" });
    expect(p.text()).toContain("View basket · AED 14.00");
  });

  it("shop: Add waits for a size; a colour that costs more and a second one move the total; the bag bar and the item's count follow", () => {
    const f = shopFixture();
    const p = play(f);
    const [title, , price] = PRODUCTS.Tops[0];
    const col = f.scan.collections[0];
    const add = f.scanOf("options").primary!.path;
    p.tap({ path: `${col.items[0]}.${col.action}` });
    expect(p.state.open).toEqual(["options"]);
    expect(p.textOf("options")).toContain(title);
    expect(p.textOf("options")).toContain(`Add · ${price}`);
    // No size yet: Add does nothing.
    p.tap({ part: "options", path: add });
    expect(p.state.open).toEqual(["options"]);
    expect(p.state.app.bag).toEqual([]);
    const [size, colour] = f.scanOf("options").groups;
    p.tap({ part: "options", path: size.rows[1] });
    p.tap({ part: "options", path: colour.rows[1] });
    const unit = amount(price) + colour.prices[1]!.amount;
    expect(p.textOf("options")).toContain(`Add · ${money(unit, price)}`);
    p.tap({ part: "options", name: "Increase" });
    expect(p.textOf("options")).toContain(`Add · ${money(unit * 2, price)}`);
    p.tap({ part: "options", path: add });
    expect(p.state.open).toEqual([]);
    // The line notes what was picked, by the options' own titles.
    expect(p.state.app.bag).toEqual([{ item: col.items[0], title, note: `${size.titles[1]} · ${colour.titles[1]}`, qty: 2, unit }]);
    expect(p.text()).toContain(`View bag · ${money(unit * 2, price)}`);
  });

  it("grocery: totals are written back in Arabic digits and riyals, right to left", () => {
    const f = groceryFixture();
    const p = play(f);
    const [title, , price] = PRODUCE["فواكه"][1];
    const col = f.scan.collections[0];
    const sheet = f.scanOf("options");
    p.tap({ path: `${col.items[1]}.${col.action}` });
    expect(p.textOf("options")).toContain(title);
    expect(p.textOf("options")).toContain(`أضف · ${price}`);
    const [pack, extras] = sheet.groups;
    p.tap({ part: "options", path: pack.rows[1] });
    p.tap({ part: "options", path: extras.rows[0] });
    const unit = amount(price) + pack.prices[1]!.amount + extras.prices[0]!.amount;
    expect(p.textOf("options")).toContain(`أضف · ${money(unit, price)}`);
    p.tap({ part: "options", name: "Increase" });
    p.tap({ part: "options", path: sheet.primary!.path });
    expect(p.text()).toContain(`عرض السلة · ${money(unit * 2, price)}`);
    expect(money(unit * 2, price)).toMatch(/^[٠-٩]+٫[٠-٩]{2} ر\.س$/);
  });
});

describe("prices that take away", () => {
  it("grocery: an option written with a minus takes its amount off the total", () => {
    // Half a kilo: less than the bag as designed ("−٦٫٢٥ ر.س").
    const sheet: ScreenSpec = {
      ...ITEM_SHEET,
      body: [
        ITEM_SHEET.body![0],
        {
          component: "Card",
          props: { title: "الكمية · مطلوب", tone: "surface" },
          children: [
            { component: "ListItem", props: { title: "٥٠٠ جم", trailing: "radio", trailingText: "−٦٫٢٥ ر.س", checked: false } },
            { component: "ListItem", props: { title: "١ كجم", trailing: "radio", checked: true } },
          ],
        },
      ],
    };
    const f = fixture({ ...GROCERY, parts: { ...GROCERY.parts, options: sheet } });
    const p = playPrototype(f.doc, { typography });
    const [title, , price] = PRODUCE["فواكه"][0];
    const col = f.scan.collections[0];
    p.tap({ path: `${col.items[0]}.${col.action}` });
    expect(p.textOf("options")).toContain(title);
    p.tap({ part: "options", path: f.scanOf("options").groups[0].rows[0] });
    expect(p.textOf("options")).toContain(`أضف · ${money(amount(price) - 625, price)}`);
  });
});

describe("choose one", () => {
  it("ride: each ride type makes the book button say which, and for how much", () => {
    const f = rideFixture();
    const p = play(f);
    const group = f.scan.groups[0];
    RIDES.forEach(([title, , price], i) => {
      p.tap({ path: group.rows[i] });
      expect(p.text()).toContain(`Book ${title} · ${price}`);
    });
  });

  it("bank: each amount chip makes the send button say how much, written like the button writes it", () => {
    const p = play(bankFixture());
    for (const a of AMOUNTS) {
      expect(p.tap({ name: `Chip/${a}` })).toBe(true);
      expect(p.text()).toContain(`Send ${money(amount(a), "AED 100.00")}`);
    }
  });

  it("dashboard: each plan makes the upgrade button say which, and for how much", () => {
    const f = dashboardFixture();
    const p = play(f);
    p.tap({ name: "Tab/Billing" });
    const group = f.scan.groups[0];
    PLANS.forEach(([title, , price], i) => {
      p.tap({ path: group.rows[i] });
      expect(p.text()).toContain(`Upgrade to ${title} · ${price}`);
    });
  });
});

describe("tab panels", () => {
  it.each([
    ["bank", "Segment/Mobile", "IBAN", "Mobile number"],
    ["dashboard", "Tab/Billing", "Workspace name", PLANS[2][0]],
    ["orders", "Tab/Past", "Al Mallah", "Burger Lab"],
  ])("%s: the picked tab's section shows and the others' hide", (k, tab, first, other) => {
    const p = play(FIXTURES[k]());
    expect(p.text()).toContain(first);
    expect(p.text()).not.toContain(other);
    expect(p.tap({ name: tab })).toBe(true);
    expect(p.text()).toContain(other);
    expect(p.text()).not.toContain(first);
  });
});

describe("confirm first, then a toast", () => {
  it("ride: booking asks to confirm the pickup, naming the ride; Change backs out, Confirm finds a driver", () => {
    const f = rideFixture();
    const p = play(f);
    const dialog = f.scanOf("pickup");
    p.tap({ path: f.scan.groups[0].rows[1] });
    p.tap({ path: f.scan.primary!.path });
    expect(p.state.open).toEqual(["pickup"]);
    expect(p.textOf("pickup")).toContain(`Your ${RIDES[1][0]} driver`);
    p.tap({ part: "pickup", path: dialog.secondary!.path });
    expect(p.state.open).toEqual([]);
    p.tap({ path: f.scan.primary!.path });
    p.tap({ part: "pickup", path: dialog.primary!.path });
    expect(p.state.open).toEqual(["finding"]);
    expect(p.textOf("finding")).toContain("Finding you a driver");
  });

  it("bank: sending asks first with the amount picked; Cancel backs out, Send shows the toast", () => {
    const f = bankFixture();
    const p = play(f);
    const dialog = f.scanOf("confirm");
    p.tap({ name: `Chip/${AMOUNTS[2]}` });
    p.tap({ path: f.scan.primary!.path });
    expect(p.textOf("confirm")).toContain(`Send ${money(amount(AMOUNTS[2]), "AED 100.00")} to Lina?`);
    p.tap({ part: "confirm", path: dialog.secondary!.path });
    expect(p.state.open).toEqual([]);
    p.tap({ path: f.scan.primary!.path });
    p.tap({ part: "confirm", path: dialog.primary!.path });
    expect(p.state.open).toEqual(["sent"]);
  });

  it("dashboard: deleting the workspace asks first; Cancel backs out, Delete says it's gone", () => {
    const f = dashboardFixture();
    const p = play(f);
    const dialog = f.scanOf("delete");
    const del = f.scan.actions.find((a) => a.variant === "danger")!;
    p.tap({ path: del.path });
    expect(p.state.open).toEqual(["delete"]);
    expect(p.textOf("delete")).toContain("Delete Northwind?");
    p.tap({ part: "delete", path: dialog.secondary!.path });
    expect(p.state.open).toEqual([]);
    // The upgrade button doesn't ask: it isn't the action that was asked about.
    p.tap({ name: "Tab/Billing" });
    p.tap({ path: f.scan.primary!.path });
    expect(p.state.open).toEqual([]);
    p.tap({ name: "Tab/General" });
    p.tap({ path: del.path });
    p.tap({ part: "delete", path: dialog.primary!.path });
    expect(p.state.open).toEqual(["deleted"]);
  });
});
