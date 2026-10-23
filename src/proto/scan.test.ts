import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import type { ScreenSpec } from "@/design-system/builders";
import { fixture } from "./fixtures/build";
import { shopFixture, SHOP_SCREEN, PRODUCTS } from "./fixtures/shop";
import { bankFixture } from "./fixtures/bank";
import { dashboardFixture } from "./fixtures/dashboard";

beforeAll(async () => {
  await ensureYoga();
});

describe("scanning a frame", () => {
  it("takes an add action's item to be the row its siblings repeat, not a stack inside it or the section around it", () => {
    const f = shopFixture();
    const [col] = f.scan.collections;
    expect(col.pattern).toBe("body.*.children.*");
    expect(col.action).toBe("children.1.children.1");
    expect(col.items).toHaveLength(Object.values(PRODUCTS).flat().length);
  });

  it("counts an item alone in its section with the items it looks like", () => {
    const lone: ScreenSpec = { ...SHOP_SCREEN, body: [...SHOP_SCREEN.body!, { ...SHOP_SCREEN.body![1], props: { title: "Sale", tone: "raised" }, children: [SHOP_SCREEN.body![1].children![0]] }] };
    const f = fixture({ screen: lone, parts: {}, steps: [] });
    expect(f.scan.collections[0].items).toContain("body.4.children.0");
  });

  it("reads pick-one options with their names and prices, the main action, the one that backs out, and copy with amounts", () => {
    const f = dashboardFixture();
    const [plans] = f.scan.groups;
    expect(plans).toMatchObject({ pick: "one", titles: ["Starter", "Pro", "Team"], picked: "body.3.children.1" });
    expect(plans.prices.map((p) => p?.amount)).toEqual([0, 2000, 4500]);
    expect(f.scan.primary).toMatchObject({ label: "Upgrade to Pro · $20.00", money: true });
    expect(f.scan.actions.map((a) => a.variant)).toEqual(["danger", "primary"]);
    expect(f.scanOf("delete").secondary?.label).toBe("Cancel");
    const bank = bankFixture();
    expect(bank.scan.optionRows.map((r) => [r.component, r.selected, r.sections.filter(Boolean).length])).toEqual([
      ["SegmentedControl", 0, 2],
      ["ChipGroup", 1, 0],
    ]);
    expect(bank.scanOf("confirm").amounts.map((a) => a.text)).toEqual(["Send AED 100.00 to Lina?"]);
  });
});
