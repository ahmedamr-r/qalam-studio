import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import { foodMenuDoc } from "./fixtures/food-menu";
import { playPrototype } from "./runner";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);
const DISH = "body.2.children.0.children.1";
const FALAFEL = "body.2.children.2.children.1";

describe("the menu route, played", () => {
  it("compiles from its recipes with nothing left out", () => {
    const { doc } = foodMenuDoc();
    expect(playPrototype(doc, { typography }).warnings).toEqual([]);
  });

  it("configures a dish: options and quantity move the total, and Add puts it in the basket", () => {
    const { doc } = foodMenuDoc();
    const p = playPrototype(doc, { typography });
    expect(p.text()).toContain("Al Mallah");
    expect(p.text()).not.toContain("View basket");

    // The dish's + opens its options, about that dish.
    expect(p.tap({ path: DISH })).toBe(true);
    expect(p.state.open).toEqual(["options"]);
    const sheet = () => p.textOf("options");
    expect(sheet()).toContain("Chicken shawarma");
    expect(sheet()).toContain("Garlic toum, pickles and fries in saj bread");
    expect(sheet()).toContain("Add · AED 18.00");

    // Large adds 6, garlic 2; two of them double it.
    p.tap({ part: "options", path: "body.1.children.1" });
    expect(sheet()).toContain("Add · AED 24.00");
    p.tap({ part: "options", path: "body.2.children.0" });
    expect(sheet()).toContain("Add · AED 26.00");
    p.tap({ part: "options", name: "Increase" });
    expect(sheet()).toContain("Add · AED 52.00");
    // The stepper shows the count, and doesn't go under one.
    p.tap({ part: "options", name: "Decrease" });
    p.tap({ part: "options", name: "Decrease" });
    expect(sheet()).toContain("Add · AED 26.00");
    p.tap({ part: "options", name: "Increase" });

    // Add: a line in the basket, the sheet closes, the bar shows the total, the dish its count.
    p.tap({ part: "options", path: "footer.0.children.1" });
    expect(p.state.open).toEqual([]);
    expect(p.state.app.basket).toEqual([{ item: "body.2.children.0", title: "Chicken shawarma", note: "Large · Extra garlic", qty: 2, unit: 2600 }]);
    expect(p.text()).toContain("View basket · AED 52.00");

    // Another dish's options start over: its own price, regular size, one.
    p.tap({ path: FALAFEL });
    expect(sheet()).toContain("Falafel wrap");
    expect(sheet()).toContain("Add · AED 14.00");
    p.tap({ part: "options", path: "footer.0.children.1" });
    expect(p.text()).toContain("View basket · AED 66.00");
  });

  it("closes the sheet from its close button, and with Back", () => {
    const { doc } = foodMenuDoc();
    const p = playPrototype(doc, { typography });
    p.tap({ path: DISH });
    p.tap({ part: "options", name: "Close" });
    expect(p.state.open).toEqual([]);
    p.tap({ path: DISH });
    p.back();
    expect(p.state.open).toEqual([]);
  });

  it("compacts the header and follows the section in view as the menu scrolls; a chip scrolls to its section", () => {
    const { doc } = foodMenuDoc();
    const p = playPrototype(doc, { typography });
    expect(p.state.data.scrolled).toBe(false);
    expect(p.state.data.section).toBe("body.2");
    p.scroll(600);
    expect(p.state.data.scrolled).toBe(true);
    expect(p.state.data.section).not.toBe("body.2");
    p.scroll(0);
    expect(p.state.data.scrolled).toBe(false);
    expect(p.state.data.section).toBe("body.2");
    p.tap({ name: "Chip/Drinks" });
    expect(p.state.data.section).toBe("body.5");
    expect(p.state.scrollTo?.y).toBeGreaterThan(0);
  });

  it("keeps a tapped section picked while the menu scrolls to it, though it stops short at the bottom", () => {
    const { doc } = foodMenuDoc();
    const p = playPrototype(doc, { typography });
    const mark = (chip: string) => {
      p.tap({ name: `Chip/${chip}` });
      return p.state.scrollTo!.y;
    };
    const plates = mark("Plates");
    const drinks = mark("Drinks");
    // The menu scrolls to just past Plates: Drinks can't reach the top.
    const max = plates + 40;
    expect(drinks).toBeGreaterThan(max);
    // Heading for Drinks, the scroll passes Shawarma and Plates and stops at the bottom: Drinks stays picked.
    for (let y = 0; y < max; y += 60) p.scroll(y, max);
    p.scroll(max, max);
    expect(p.state.data.section).toBe("body.5");
    // Scrolling back up hands over to the section in view.
    p.scroll(max - 20, max);
    expect(p.state.data.section).toBe("body.4");
    // At the bottom by hand, the last section is the one in view.
    p.scroll(max, max);
    expect(p.state.data.section).toBe("body.5");
    // Taking over mid-scroll (heading up for Popular, then down again) lets it follow the scroll again.
    p.tap({ name: "Chip/Popular" });
    expect(p.state.data.section).toBe("body.2");
    p.scroll(max - 100, max);
    p.scroll(max - 200, max);
    expect(p.state.data.section).toBe("body.2");
    p.scroll(max - 150, max);
    expect(p.state.data.section).not.toBe("body.2");
  });

  it("gives every section its turn as the menu scrolls by, though the last ones can't reach the top", () => {
    const { doc } = foodMenuDoc();
    const marks = playPrototype(doc, { typography });
    marks.tap({ name: "Chip/Plates" });
    // The menu ends just before Plates could reach the top.
    const max = marks.state.scrollTo!.y - 10;
    const p = playPrototype(doc, { typography });
    const seen: unknown[] = [];
    for (let y = 0; y <= max; y += 8) {
      p.scroll(Math.min(y, max), max);
      if (seen[seen.length - 1] !== p.state.data.section) seen.push(p.state.data.section);
    }
    p.scroll(max, max);
    if (seen[seen.length - 1] !== p.state.data.section) seen.push(p.state.data.section);
    expect(seen).toEqual(["body.2", "body.3", "body.4", "body.5"]);
  });
});
