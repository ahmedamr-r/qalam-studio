import { beforeAll, describe, expect, it } from "vitest";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen, type Inst, type ScreenSpec } from "./builders";
import { BUILTIN } from "./resolve";
import { lintSpec, repeatedPrimaries } from "./spec-lint";
import { demoteRepeatedPrimaries, fixSpec } from "./spec-fix";
import { DEMO_SCREENS } from "@/ui/demo";
import type { ComponentDef } from "./docs";
import { measureText } from "@/doc/measure";

/**
 * A primary Button on every item of a collection is flagged, and code makes it quiet: tertiary
 * beside the item's price, or secondary where there's none. The same rule holds for any product,
 * so each case is a different kind of app.
 */

const screen = (body: Inst[], extra: Partial<ScreenSpec> = {}): ScreenSpec => ({ name: "Screen", platform: "mobile", body, ...extra });
const rules = (s: ScreenSpec) => lintSpec(s).map((i) => i.rule);
const text = (t: string, style = "body"): Inst => ({ component: "Text", props: { text: t, style } });
const primary = (label: string, extra: Record<string, unknown> = {}): Inst => ({ component: "Button", props: { label, variant: "primary", ...extra } });
/** Every Button in a spec, with the props it ended up with. */
const buttons = (s: ScreenSpec): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  const go = (l?: Inst[]) => l?.forEach((i) => (i.component === "Button" && out.push(i.props ?? {}), go(i.children)));
  for (const r of ["header", "hero", "body", "footer"] as const) go(s[r]);
  return out;
};

// A super app home's reorder shelf: past orders, each with a full-width Reorder under its price.
const order = (dishes: string, place: string, amount: string): Inst => ({
  component: "Card",
  children: [{ component: "MediaPlaceholder", props: { height: 112, label: place, icon: "utensils" } }, text(dishes, "body-strong"), text(`${place} · 25 min`, "caption"), text(amount, "headline"), primary("Reorder", { icon: "rotate-ccw", fullWidth: true })],
});
const shelf = screen([
  { component: "ServiceGrid", props: { tiles: [{ label: "Food", icon: "utensils" }, { label: "Rides", icon: "car" }, { label: "Pay", icon: "wallet" }] } },
  { component: "Carousel", props: { title: "Your Tuesday dinner?", action: "All orders", itemWidth: 240 }, children: [order("2× Chicken shawarma, Fattoush", "Al Mallah", "AED 68.50"), order("Falafel wrap, 2× Ayran", "Operation: Falafel", "AED 57.00"), order("Margherita, Burrata", "Pizza di Rocco", "AED 118.00")] },
]);

// A shop's product grid: two rows of tiles, each with its price row (a price and a discount) and Add to cart.
const product = (name: string, amount: string): Inst => ({
  component: "Stack",
  props: { gap: "200" },
  children: [{ component: "Image", props: { alt: `${name} photo`, aspect: "1:1", src: "" } }, text(name, "body-strong"), { component: "Stack", props: { direction: "horizontal", gap: "100" }, children: [text(amount, "headline"), { component: "Tag", props: { label: "-20%", tone: "promo" } }] }, primary("Add to cart", { fullWidth: true })],
});
const shop = screen([
  { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [product("Wireless earbuds", "$59.00"), product("Phone case", "$19.00")] },
  { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [product("USB-C cable", "$9.00"), product("Power bank", "$39.00")] },
]);

// A hotel's rooms, one Card under another, each with its nightly rate above Select room; the screen keeps its own primary.
const room = (name: string, amount: string): Inst => ({
  component: "Card",
  children: [text(name, "headline"), text("Sea view · Free cancellation", "caption"), { component: "Stack", props: { gap: "050" }, children: [text(amount, "headline"), text("per night", "caption")] }, primary("Select room", { fullWidth: true })],
});
const hotel = screen([text("Choose your room", "title-md"), room("Deluxe king", "AED 540"), room("Twin room", "AED 420"), room("Family suite", "AED 880")], { footer: [primary("Continue to payment", { fullWidth: true })] });

// Courses to continue: no price to sit beside.
const course = (title: string, lessons: string): Inst => ({ component: "Card", children: [{ component: "MediaPlaceholder", props: { aspect: "16:9", label: title } }, text(title, "body-strong"), text(lessons, "caption"), primary("Continue", { fullWidth: true })] });
const courses = screen([{ component: "Carousel", props: { title: "Keep learning", itemWidth: 220 }, children: [course("Intro to product discovery", "Lesson 3 of 6"), course("Design systems", "Lesson 1 of 8")] }]);

// A grocery list's rows in one Card: the action already sits in each row.
const grocery = (name: string, amount: string): Inst => ({ component: "Stack", props: { direction: "horizontal", gap: "300", align: "center" }, children: [{ component: "Image", props: { alt: name, src: "", width: 56, aspect: "1:1" } }, { component: "Stack", props: { gap: "050" }, children: [text(name, "body-strong"), text(amount, "caption")] }, primary("Add", { size: "sm" })] });
const groceries = screen([{ component: "Card", props: { title: "Buy again" }, children: [grocery("Whole milk 2 L", "AED 14.50"), grocery("Eggs, 12 pack", "AED 11.00"), grocery("Sourdough loaf", "AED 18.00")] }]);

describe("a primary action repeated on every item", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("is flagged at the collection, in food, shop, hotel, course and grocery screens", () => {
    expect(repeatedPrimaries(shelf)).toEqual([{ collection: "body.1", items: [0, 1, 2].map((i) => ({ item: `body.1.children.${i}`, button: `body.1.children.${i}.children.4` })) }]);
    // Two rows of tiles are two collections.
    expect(repeatedPrimaries(shop).map((r) => r.collection)).toEqual(["body.0", "body.1"]);
    // Cards one under another in the body; the footer's own primary isn't one of them.
    expect(repeatedPrimaries(hotel).map((r) => [r.collection, r.items.length])).toEqual([["body", 3]]);
    expect(repeatedPrimaries(courses)[0].items).toHaveLength(2);
    expect(repeatedPrimaries(groceries).map((r) => r.collection)).toEqual(["body.0"]);
    for (const s of [shelf, shop, hotel, courses, groceries]) {
      const r = rules(s);
      expect(r).toContain("repeated-primary");
      // The repeated ones are their own issue, not a second count of primaries.
      expect(r).not.toContain("one-primary");
    }
  });

  it("leaves screens with one primary action, and different actions on different sections, to the one-primary rule", () => {
    for (const s of DEMO_SCREENS) expect(repeatedPrimaries(s)).toEqual([]);
    // Two sections that each lead with their own action aren't a collection.
    const twoSections = screen([
      { component: "Card", children: [text("Your order is on its way", "headline"), primary("Track order")] },
      { component: "Card", children: [text("How was yesterday's dinner?", "headline"), primary("Rate it")] },
    ]);
    expect(repeatedPrimaries(twoSections)).toEqual([]);
    expect(rules(twoSections)).toContain("one-primary");
    // One card with an action among cards without one.
    const one = screen([{ component: "Carousel", props: { itemWidth: 200 }, children: [order("Shawarma", "Al Mallah", "AED 30.00"), { component: "Card", children: [text("Falafel wrap", "body-strong"), text("AED 21.00")] }] }]);
    expect(repeatedPrimaries(one)).toEqual([]);
    expect(fixSpec(one).changes).toEqual([]);
  });

  it("keeps the primary on the one item set apart, such as the plan a pricing page recommends", () => {
    const plan = (name: string, amount: string, tone?: string): Inst => ({ component: "Card", props: tone ? { tone } : {}, children: [text(name, "headline"), text(amount, "title-md"), text("Unlimited projects", "caption"), primary(`Choose ${name}`, { fullWidth: true })] });
    const pricing = screen([{ component: "Stack", props: { direction: "vertical", gap: "300" }, children: [plan("Basic", "$0"), plan("Pro", "$29 / month", "brand-subtle"), plan("Team", "$99 / month")] }], { platform: "web" });
    expect(repeatedPrimaries(pricing)[0].items.map((i) => i.item)).toEqual(["body.0.children.0", "body.0.children.2"]);
    const { spec } = fixSpec(pricing);
    expect(buttons(spec).map((b) => b.variant)).toEqual(["secondary", "primary", "secondary"]);
    expect(rules(spec)).not.toContain("one-primary");
    expect(rules(spec)).not.toContain("repeated-primary");
  });

  it("food: Reorder turns tertiary and small, in a row with the price, and the cards' price rows line up at the bottom", () => {
    const { spec, changes } = demoteRepeatedPrimaries(shelf);
    expect(changes).toHaveLength(3);
    const card = spec.body[1].children![0];
    expect(card.children!.map((c) => c.component)).toEqual(["MediaPlaceholder", "Text", "Text", "Stack"]);
    const last = card.children![3];
    expect(last.props).toMatchObject({ direction: "horizontal", justify: "between", align: "center" });
    expect(last.children!.map((c) => c.component)).toEqual(["Text", "Button"]);
    expect(last.children![1].props).toEqual({ label: "Reorder", icon: "rotate-ccw", variant: "tertiary", size: "sm" });
    expect(lintSpec(spec)).toEqual([]);
    // The input is left as it was.
    expect(buttons(shelf).every((b) => b.variant === "primary")).toBe(true);

    const nodes: SceneNode[] = layoutToNodes(buildScreen(spec, BUILTIN), { dir: "ltr", lang: "en", ts: BUILTIN }, { x: 0, y: 0 });
    const cards = nodes.filter((n) => n.parentId === nodes.find((t) => t.name === "Track")!.id);
    const rows = cards.map((c) => nodes.filter((k) => k.parentId === c.id).at(-1)!);
    // The row is the card's last part, flush with its padding at the bottom, the same in every card.
    const gaps = rows.map((r, i) => cards[i].h - (r.y + r.h));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.5);
    for (const r of rows) expect(nodes.filter((k) => k.parentId === r.id).at(-1)!.name).toBe("Button/Tertiary");
  });

  it("shop: Add joins the price row it ends with where it fits, and keeps a line of its own where it would squeeze the price", () => {
    // Half a phone's width: a price, a discount and "Add to cart" don't fit on one line.
    const { spec } = fixSpec(shop);
    for (const tile of spec.body.flatMap((r) => r.children!)) {
      expect(tile.children!.map((c) => c.component)).toEqual(["Image", "Text", "Stack", "Button"]);
      expect(tile.children![2].children!.map((c) => c.component)).toEqual(["Text", "Tag"]);
      expect(tile.children![3].props).toEqual({ label: "Add to cart", variant: "secondary", size: "sm", fullWidth: true });
    }
    expect(rules(spec)).not.toContain("repeated-primary");
    // A price and a short "Add" do.
    const short = (name: string, amount: string): Inst => ({ ...product(name, amount), children: [...product(name, amount).children!.slice(0, 2), { component: "Stack", props: { direction: "horizontal" }, children: [text(amount, "headline")] }, primary("Add", { fullWidth: true })] });
    const fits = fixSpec(screen([{ component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [short("Wireless earbuds", "$59.00"), short("Phone case", "$19.00")] }])).spec;
    for (const tile of fits.body[0].children!) {
      expect(tile.children!.map((c) => c.component)).toEqual(["Image", "Text", "Stack"]);
      const r = tile.children![2];
      expect(r.children!.map((c) => c.component)).toEqual(["Text", "Button"]);
      expect(r.props).toMatchObject({ justify: "between", align: "center" });
      expect(r.children![1].props).toEqual({ label: "Add", variant: "tertiary", size: "sm" });
    }
  });

  it("food, as a live Generate drew it: a price with a note and a Tag leaves no room, so Reorder keeps its own line and nothing is squeezed", () => {
    const card = (dishes: string, amount: string, tag: string): Inst => ({
      component: "Card",
      props: { padding: "300" },
      children: [{ component: "MediaPlaceholder", props: { aspect: "16:9", label: dishes } }, text(dishes, "body-strong"), { component: "Stack", props: { direction: "horizontal", justify: "between", align: "center", gap: "200" }, children: [text(amount, "headline"), { component: "Tag", props: { label: tag, tone: "member" } }] }, primary("Reorder", { icon: "rotate-ccw", fullWidth: true })],
    });
    const s = screen([{ component: "Carousel", props: { title: "Your Tuesday dinner?", itemWidth: 264 }, children: [card("Chicken shawarma plate", "42.00 AED today", "Free delivery"), card("Butter chicken, naan", "38.50 AED today", "3.50 AED less"), card("Salmon poke bowl", "61.00 AED today", "Busy · 45 min")] }]);
    const { spec } = fixSpec(s);
    for (const c of spec.body[0].children!) {
      expect(c.children!.at(-2)!.children!.map((k) => k.component)).toEqual(["Text", "Tag"]);
      expect(c.children!.at(-1)!.props).toMatchObject({ label: "Reorder", variant: "secondary", size: "sm" });
    }
    // Every price keeps its one line.
    const nodes = layoutToNodes(buildScreen(spec, BUILTIN), { dir: "ltr", lang: "en", ts: BUILTIN }, { x: 0, y: 0 });
    for (const n of nodes) if (n.type === "text" && n.text.content.includes("AED today")) expect(n.w).toBeGreaterThanOrEqual(measureText(n.text, null).w - 1);
  });

  it("hotel: Select room sits beside the nightly rate, and the screen's own primary stays", () => {
    const { spec } = fixSpec(hotel);
    const r = spec.body[1].children!.at(-1)!;
    expect(r.children!.map((c) => c.component)).toEqual(["Stack", "Button"]);
    expect(r.children![0].children!.map((c) => c.props?.text)).toEqual(["AED 540", "per night"]);
    expect(buttons(spec).map((b) => b.variant)).toEqual(["tertiary", "tertiary", "tertiary", "primary"]);
    expect(spec.footer![0].props).toMatchObject({ variant: "primary", fullWidth: true });
    expect(rules(spec)).not.toContain("one-primary");
  });

  it("courses: with no price to sit beside, Continue is secondary and small on its own line", () => {
    const { spec } = fixSpec(courses);
    for (const c of spec.body[0].children!) expect(c.children!.at(-1)!.props).toEqual({ label: "Continue", variant: "secondary", size: "sm", fullWidth: true });
  });

  it("groceries: an Add already in its row turns tertiary where it is", () => {
    const { spec } = fixSpec(groceries);
    for (const row of spec.body[0].children!) {
      expect(row.children!.map((c) => c.component)).toEqual(["Image", "Stack", "Button"]);
      expect(row.children![2].props).toEqual({ label: "Add", variant: "tertiary", size: "sm" });
    }
  });

  describe("instances of a component made for the screen", () => {
    const use = (name: string, values: Record<string, string>): Inst => ({ component: "Custom", props: { name, values: Object.entries(values).map(([prop, value]) => ({ prop, value })) } });
    const prop = (name: string, example: string) => ({ name, kind: "text" as const, maxChars: 40, example });
    // A food app's reorder card, with its price a placeholder each instance fills.
    const reorderCard: ComponentDef = {
      name: "Reorder Card",
      purpose: "A past order to reorder in one tap",
      props: [prop("restaurant", "Ravi"), prop("dishes", "Chicken biryani"), prop("price", "AED 58.50")],
      composition: {
        component: "Card",
        props: { padding: "300" },
        children: [{ component: "MediaPlaceholder", props: { aspect: "16:9", label: "{restaurant}" } }, { component: "Stack", props: { gap: "100" }, children: [text("{restaurant}", "headline"), text("{dishes}")] }, text("{price}", "body-strong"), primary("Reorder", { icon: "rotate-ccw", fullWidth: true })],
      },
    };
    const home = screen([{ component: "Carousel", props: { title: "Your Tuesday dinner?", itemWidth: 264 }, children: [use("Reorder Card", { restaurant: "Ravi", price: "AED 58.50" }), use("Reorder Card", { restaurant: "Salt", price: "AED 74.00" }), use("Reorder Card", { restaurant: "Wagamama", price: "AED 96.00" })] }], { components: [reorderCard] });

    it("food: the Reorder in the component's composition is flagged once, and moves beside the price for every card", () => {
      expect(repeatedPrimaries(home)).toEqual([{ collection: "body.0", items: [0, 1, 2].map((i) => ({ item: `body.0.children.${i}`, button: `body.0.children.${i}` })), component: { name: "Reorder Card", part: "children.3" } }]);
      expect(rules(home)).toContain("repeated-primary");
      const { spec, changes } = fixSpec(home);
      expect(changes).toHaveLength(1);
      const comp = spec.components![0].composition;
      expect(comp.children!.map((c) => c.component)).toEqual(["MediaPlaceholder", "Stack", "Stack"]);
      expect(comp.children![2].children!.map((c) => c.props?.text ?? c.props?.label)).toEqual(["{price}", "Reorder"]);
      expect(comp.children![2].children![1].props).toMatchObject({ variant: "tertiary", size: "sm" });
      expect(rules(spec)).not.toContain("repeated-primary");
      // The instances are untouched: they place the component, which changed.
      expect(spec.body[0].children).toEqual(home.body[0].children);
    });

    it("hotel: a room component's Book joins the nightly-rate row it ends with", () => {
      const room: ComponentDef = { name: "Room Option", purpose: "A room to book", props: [prop("room", "Deluxe king"), prop("rate", "AED 540")], composition: { component: "Card", children: [text("{room}", "headline"), { component: "Stack", props: { direction: "horizontal", gap: "100" }, children: [text("{rate}", "headline"), text("per night", "caption")] }, primary("Book", { fullWidth: true })] } };
      const s = screen([use("Room Option", { room: "Deluxe king" }), use("Room Option", { room: "Twin room", rate: "AED 420" })], { components: [room] });
      const comp = fixSpec(s).spec.components![0].composition;
      expect(comp.children!.at(-1)!.children!.map((c) => c.component)).toEqual(["Text", "Text", "Button"]);
      expect(comp.children!.at(-1)!.props).toMatchObject({ justify: "between", align: "center" });
    });

    it("leaves a design system's own component as the designer made it", () => {
      const library = [{ ...reorderCard }];
      const s = { ...home, components: undefined };
      expect(repeatedPrimaries(s, library)).toEqual([]);
      expect(fixSpec(s, { library }).changes).toEqual([]);
      // Its name taken by the system, the screen's copy isn't the one placed.
      expect(repeatedPrimaries(home, library)).toEqual([]);
    });
  });

  it("a list's rows in a card inside a collection of cards: the rows are claimed by their card", () => {
    const store = (name: string): Inst => ({ component: "Card", props: { title: name }, children: [grocery("Whole milk 2 L", "AED 14.50"), grocery("Eggs, 12 pack", "AED 11.00")] });
    const s = screen([store("Carrefour"), store("Spinneys")]);
    expect(repeatedPrimaries(s).map((r) => r.collection)).toEqual(["body.0", "body.1"]);
    expect(buttons(fixSpec(s).spec).every((b) => b.variant === "tertiary")).toBe(true);
  });
});
