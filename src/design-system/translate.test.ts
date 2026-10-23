import { describe, expect, it } from "vitest";
import type { ScreenSpec } from "./builders";
import { mapSpecCopy, needsTranslation, specCopy, translateSpec, translationUnits } from "./translate";

const SPEC: ScreenSpec = {
  name: "Wallet",
  header: [{ component: "TopBar", props: { title: "Wallet", leading: "back", trailing: "help" } }],
  body: [
    { component: "Tabs", props: { tabs: ["Activity", "Cards"], selected: 0 } },
    { component: "Button", props: { label: "Add money", variant: "primary", icon: "plus" } },
    { component: "Card", children: [{ component: "ListItem", props: { title: "Add money", subtitle: "From your Visa ••12", trailing: "text", trailingText: "AED 50" } }] },
    { component: "Custom", props: { name: "Cash Card", values: [{ prop: "holder", value: "Sara Ahmed" }, { prop: "mark", value: "credit-card" }] } },
  ],
  components: [
    {
      name: "Cash Card",
      purpose: "The member's card",
      props: [
        { name: "holder", kind: "text", maxChars: 24, example: "Card holder" },
        { name: "mark", kind: "icon", maxChars: 40, example: "credit-card" },
      ],
      composition: { component: "Card", children: [{ component: "ListItem", props: { title: "{holder}", subtitle: "Debit card" } }] },
    },
  ],
};

describe("which copy needs translating", () => {
  it("reads the script each string is written in", () => {
    expect(needsTranslation("Add money", "ar")).toBe(true);
    expect(needsTranslation("أضف رصيد", "ar")).toBe(false);
    expect(needsTranslation("أضف رصيد", "en")).toBe(true);
    expect(needsTranslation("Add money", "en")).toBe(false);
    // Amounts in a currency code and addresses stay as they are; units are words in Arabic.
    expect(needsTranslation("AED 94.00", "ar")).toBe(false);
    expect(needsTranslation("12.5 EGP", "ar")).toBe(false);
    expect(needsTranslation("4.7 (280) • 20 - 30 mins", "ar")).toBe(true);
    expect(needsTranslation("18.4 km", "ar")).toBe(true);
    expect(needsTranslation("help@lumen.app", "ar")).toBe(false);
    expect(needsTranslation("  ", "ar")).toBe(false);
    expect(needsTranslation("{holder}", "ar")).toBe(false);
    expect(needsTranslation("Hi {name}", "ar")).toBe(true);
    // A brand is the model's call (it may have an official Arabic name).
    expect(needsTranslation("Lumen Pay", "ar")).toBe(true);
  });
});

describe("the copy of a spec", () => {
  it("finds every string a screen shows, and nothing that isn't copy", () => {
    const texts = specCopy(SPEC).map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["Wallet", "Activity", "Cards", "Add money", "From your Visa ••12", "AED 50", "Sara Ahmed", "Card holder", "Debit card"]));
    // Icons, option values, a Custom instance's component and prop names are not copy.
    for (const not of ["help", "back", "plus", "primary", "text", "Cash Card", "holder", "credit-card"]) expect(texts).not.toContain(not);
  });

  it("knows where each string lives and its length budget", () => {
    const c = specCopy(SPEC);
    expect(c.find((x) => x.text === "Wallet")).toMatchObject({ where: "TopBar.title", maxChars: 24 });
    expect(c.find((x) => x.text === "AED 50")).toMatchObject({ where: "ListItem.trailingText", maxChars: 14 });
    expect(c.find((x) => x.text === "Sara Ahmed")).toMatchObject({ where: "Cash Card.holder", maxChars: 24 });
  });

  it("sends each distinct string once, with the tightest budget", () => {
    const units = translationUnits(specCopy(SPEC), "ar");
    const add = units.filter((u) => u.text === "Add money");
    expect(add).toHaveLength(1);
    expect(add[0].maxChars).toBe(24);
    expect(units.map((u) => u.text)).not.toContain("AED 50");
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
  });

  it("swaps translations in and sets the direction and language, leaving the rest", () => {
    const map = new Map([
      ["Add money", "أضف رصيد"],
      ["Wallet", "المحفظة"],
      ["Debit card", "بطاقة خصم"],
    ]);
    const ar = translateSpec(SPEC, map, "rtl", "ar");
    expect([ar.dir, ar.lang]).toEqual(["rtl", "ar"]);
    expect(ar.header![0].props!.title).toBe("المحفظة");
    expect(ar.body[1].props).toMatchObject({ label: "أضف رصيد", icon: "plus", variant: "primary" });
    expect(ar.body[2].children![0].props).toMatchObject({ title: "أضف رصيد", trailingText: "AED 50" });
    expect(ar.components![0].composition.children![0].props!.subtitle).toBe("بطاقة خصم");
    // The source spec is untouched.
    expect(SPEC.body[1].props!.label).toBe("Add money");
    expect(mapSpecCopy(SPEC, (t) => t)).toEqual(SPEC);
  });
});
