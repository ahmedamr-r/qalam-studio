import { describe, expect, it } from "vitest";
import { ref } from "./fixtures";
import { seenFromMarkdown, seenToMarkdown, withSeenKeys } from "./seen-md";
import type { SeenMap, SeenScreen } from "./types";

const screen = (key: string, name: string, shots: string[], more: Partial<SeenScreen> = {}): SeenScreen => ({ key, name, shots, states: {}, kind: "detail", can: [], nav: [], by: "qalam", at: 1, ...more });

const map: SeenMap = {
  key: "grocery",
  product: "grocery",
  readAt: Date.UTC(2026, 9, 29),
  screens: [
    screen("cart", "Cart", [ref(1), ref(2)], { kind: "list", does: "Lists what's in the basket with its total", on: "Items, the total, a coupon field", can: [{ label: "Checkout", does: "goes on to pay" }, { label: "Apply coupon" }], nav: ["Home", "Cart"], states: { [ref(2)]: "With a coupon applied" }, design: "One column of rows, a fixed bar at the bottom" }),
    screen("address", "Address", [ref(3)], { kind: "form", can: [{ label: "Change" }, { label: "Continue to payment" }] }),
    screen("address-book", "Address book", [ref(4)], { kind: "list" }),
    screen("pay", "Pay", [ref(5)], { step: "acme__basket/pays", by: "you" }),
  ],
  flows: [
    {
      key: "checkout",
      name: "Checkout",
      aim: "to pay for the basket",
      goal: "g1",
      steps: ["cart", "address", "pay"],
      moves: [
        { from: "cart", to: "address", via: "Checkout", how: "tap" },
        { from: "address", to: "pay", how: "tap" },
        { from: "address", to: "address-book", via: "Change", how: "tap" },
      ],
      entry: "the tab bar's “Cart”",
      notShown: ["What happens when a payment fails"],
      note: "Three screens from the basket to paying",
      by: "qalam",
      at: 2,
    },
  ],
  gone: [ref(9), "flow:old"],
};

const names = { productName: "Grocery app", goalTitle: (id: string) => (id === "g1" ? "More customers reorder weekly" : undefined), picture: (r: string) => `../../assets/${r.slice(6)}.png` };

describe("hub/seen/<key>.md", () => {
  it("reads back what it wrote", () => {
    const md = seenToMarkdown(map, names);
    expect(md).toContain("# What people see in Grocery app today");
    expect(md).toContain("![Cart](../../assets/000000000000000000000001.png)");
    expect(md).toContain("2. Address, on “Checkout”");
    expect(md).toContain("- From Address, on “Change” goes to Address book");
    expect(md).toContain("Serves: More customers reorder weekly");
    expect(seenFromMarkdown(md)).toEqual(map);
  });

  it("takes a person's words and leaves the records alone", () => {
    const md = seenToMarkdown(map, names)
      .replace("### Cart · list", "### Basket · list")
      .replace("What it's for: Lists what's in the basket with its total", "What it's for: Where people check what they picked")
      .replace("## Checkout · to pay for the basket", "## Checkout · to pay and get a delivery slot")
      .replace("- What happens when a payment fails", "- What happens when a payment fails\n- Paying with cash");
    const back = seenFromMarkdown(md)!;
    expect(back.screens[0]).toMatchObject({ key: "cart", name: "Basket", does: "Where people check what they picked", can: map.screens[0].can });
    expect(back.flows[0]).toMatchObject({ key: "checkout", aim: "to pay and get a delivery slot", notShown: ["What happens when a payment fails", "Paying with cash"] });
  });

  it("drops steps and moves naming screens that aren't in the file, and a flow left with fewer than two steps", () => {
    const md = seenToMarkdown(map, names);
    const noAddress = md.replace(/### Address · form[^\n]*\n/, "### Address · form\n");
    const back = seenFromMarkdown(noAddress)!;
    expect(back.screens.map((s) => s.key)).not.toContain("address");
    expect(back.flows[0].steps).toEqual(["cart", "pay"]);
    expect(back.flows[0].moves.some((m) => m.from === "address" || m.to === "address")).toBe(false);
    const onlyCart = md.replace(/### (Address|Pay|Address book) · [a-z]+[^\n]*\n/g, "### gone\n");
    expect(seenFromMarkdown(onlyCart)!.flows).toEqual([]);
    expect(seenFromMarkdown("# Not one")).toBeNull();
  });

  it("can't be closed early by a record's words", () => {
    const tricky = { ...map, screens: [screen("cart", "Cart", [ref(1)], { can: [{ label: "Go --> now" }] })], flows: [] };
    expect(seenFromMarkdown(seenToMarkdown(tricky, names))!.screens[0].can).toEqual([{ label: "Go --> now" }]);
  });
});

describe("keys that stay", () => {
  it("keeps a screen's key while one of its screenshots stays, a flow's while its name or most of its steps do", () => {
    const keyed = withSeenKeys(
      [
        { key: "~n1", name: "Basket", shots: [ref(2), ref(7)], states: {}, kind: "list", can: [], nav: [], by: "qalam", at: 3 },
        { key: "~n2", name: "Address", shots: [ref(8)], states: {}, kind: "form", can: [], nav: [], by: "qalam", at: 3 },
        { key: "~n3", name: "Pay", shots: [ref(10)], states: {}, kind: "form", can: [], nav: [], by: "qalam", at: 3 },
      ],
      [
        { name: "Checkout", aim: "", steps: ["~n1", "~n2"], moves: [{ from: "~n1", to: "~n2", how: "tap" }], notShown: [], by: "qalam", at: 3 },
        { name: "Paying", aim: "", steps: ["~n2", "~n3"], moves: [], notShown: [], by: "qalam", at: 3 },
      ],
      map,
    );
    // The basket shares a screenshot with "cart"; the new address doesn't share one, and "address" is taken.
    expect(keyed.screens.map((s) => s.key)).toEqual(["cart", "address-2", "pay-2"]);
    expect(keyed.flows.map((f) => f.key)).toEqual(["checkout", "paying"]);
    expect(keyed.flows[0].steps).toEqual(["cart", "address-2"]);
    expect(keyed.flows[0].moves[0]).toMatchObject({ from: "cart", to: "address-2" });
  });
});
