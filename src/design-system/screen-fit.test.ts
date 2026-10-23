import { beforeAll, describe, expect, it } from "vitest";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen, type Inst, type LBox, type ScreenSpec } from "./builders";
import { BUILTIN } from "./resolve";

/**
 * What the model builds from plain parts still fits the screen: a header row it made itself sits
 * inside the gutter with icons that show on the backdrop, and cards side by side in a carousel are
 * one height with their actions on one line. Each case is a different kind of product.
 */

const W = 390;
const gutter = BUILTIN.dimension("layout.gutter") ?? 16;
const searchHero: Inst[] = [{ component: "SearchBar", props: { placeholder: "Search" } }];

function screen(spec: Partial<ScreenSpec>): { box: LBox; nodes: SceneNode[] } {
  const box = buildScreen({ name: "Screen", platform: "mobile", body: [], ...spec } as ScreenSpec, BUILTIN);
  return { box, nodes: layoutToNodes(box, { dir: spec.dir ?? "ltr", lang: "en", ts: BUILTIN }, { x: 0, y: 0 }) };
}
const walk = (b: LBox, out: LBox[] = []): LBox[] => (out.push(b), (b.children ?? []).forEach((c) => walk(c, out)), out);
const iconColors = (b: LBox) => walk(b).filter((x) => x.kind === "icon").map((x) => x.icon!.color);
const kids = (ns: SceneNode[], p: SceneNode) => ns.filter((n) => n.parentId === p.id);
/** A node's box in screen space (layoutToNodes places children relative to their parent). */
function abs(ns: SceneNode[], n: SceneNode): { x: number; y: number; w: number; h: number } {
  let x = n.x, y = n.y;
  for (let p = ns.find((q) => q.id === n.parentId); p && p.parentId; p = ns.find((q) => q.id === p!.parentId)) (x += p.x), (y += p.y);
  return { x, y, w: n.w, h: n.h };
}

const pin = (text: string): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", align: "center", justify: "between" },
  children: [
    { component: "Stack", props: { direction: "horizontal", gap: "100", align: "center" }, children: [{ component: "Icon", props: { icon: "map-pin", tone: "brand" } }, { component: "Text", props: { text, style: "headline" } }, { component: "Icon", props: { icon: "chevron-down" } }] },
    { component: "Avatar", props: { initials: "LH" } },
  ],
});
const greeting: Inst = {
  component: "Stack",
  props: { direction: "horizontal", align: "center", justify: "between" },
  children: [
    { component: "Stack", props: { direction: "horizontal", gap: "200", align: "center" }, children: [{ component: "Avatar", props: { initials: "SA" } }, { component: "Text", props: { text: "Good morning, Sara", style: "headline" } }] },
    { component: "Icon", props: { icon: "bell", tone: "brand" } },
  ],
};

describe("a header row the model built from plain parts", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  const cases: [string, Inst][] = [
    ["a delivery address over a food super app", pin("Deliver to Dubai Marina")],
    ["a greeting over a banking home", greeting],
    ["a pickup point over a ride home", pin("Pickup · Mall of the Emirates")],
  ];

  for (const [what, row] of cases) {
    it(`${what} sits inside the gutter on both edges`, () => {
      const { nodes } = screen({ header: [row], hero: searchHero });
      const backdrop = nodes.find((n) => n.name === "Backdrop")!;
      const bar = kids(nodes, backdrop).find((n) => n.name === "Stack")!;
      const parts = kids(nodes, bar).map((k) => abs(nodes, k));
      expect(Math.min(...parts.map((b) => b.x))).toBeGreaterThanOrEqual(gutter - 0.5);
      // The avatar or bell lands on the end edge, inside the gutter.
      expect(Math.max(...parts.map((b) => b.x + b.w))).toBeGreaterThanOrEqual(W - gutter - 0.5);
      expect(Math.max(...parts.map((b) => b.x + b.w))).toBeLessThanOrEqual(W - gutter + 0.5);
    });

    it(`${what} turns its brand icons light on a dark backdrop`, () => {
      const { box } = screen({ header: [row], hero: searchHero });
      const backdrop = walk(box).find((x) => x.name === "Backdrop")!;
      const bar = backdrop.children!.find((x) => x.component === "Stack")!;
      const colors = iconColors(bar);
      expect(colors.length).toBeGreaterThan(0);
      expect(colors.every((c) => c === "icon.inverse")).toBe(true);
    });
  }

  it("keeps a brand icon brand when the header has no backdrop", () => {
    const { box } = screen({ header: [pin("Deliver to Dubai Marina")] });
    expect(iconColors(box)).toContain("icon.brand");
  });

  it("leaves a TopBar's own padding alone", () => {
    const withBar = screen({ header: [{ component: "TopBar", props: { title: "Orders", leading: "back" } }] });
    const bar = withBar.nodes.find((n) => n.name.startsWith("TopBar"))!;
    expect(abs(withBar.nodes, bar).x).toBe(0);
  });
});

describe("cards side by side in a carousel", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  const card = (title: string, meta: string, extra: Inst[], action: string): Inst => ({
    component: "Card",
    props: { tone: "surface" },
    children: [
      { component: "MediaPlaceholder", props: { label: title.split(" ")[0], aspect: "16:9" } },
      { component: "Text", props: { text: title, style: "headline", maxLines: 2 } },
      { component: "Text", props: { text: meta, style: "caption", tone: "secondary" } },
      ...extra,
      { component: "Button", props: { label: action, variant: "primary", fullWidth: true } },
    ],
  });
  const price = (amount: string, note?: Inst): Inst => ({ component: "Stack", props: { direction: "horizontal", justify: "between", align: "center" }, children: [{ component: "Text", props: { text: amount, style: "headline" } }, ...(note ? [note] : [])] });

  const cases: [string, Inst[]][] = [
    [
      "past orders to reorder, one with a changed price",
      [
        card("2× Chicken shawarma, Fattoush, Mint lemonade", "Al Mallah · Usually Tue · 25 min", [price("AED 68.50", { component: "Text", props: { text: "Today's price", style: "caption" } })], "Reorder"),
        card("Falafel wrap", "Operation: Falafel · Last on Sun", [price("AED 57.00", { component: "Tag", props: { label: "Price updated", tone: "warning" } })], "Reorder"),
      ],
    ],
    [
      "products in a shop, names of different lengths",
      [card("Wireless earbuds", "Audio", [price("$59")], "Add to cart"), card("Noise cancelling over-ear headphones with case", "Audio · Bestseller", [price("$249")], "Add to cart"), card("Cable", "Accessories", [], "Add to cart")],
    ],
    [
      "courses to continue, one with a progress note",
      [card("Intro to product discovery", "6 lessons", [{ component: "Text", props: { text: "Lesson 3 of 6 · 12 min left", style: "caption" } }], "Continue"), card("Design systems", "8 lessons", [], "Continue")],
    ],
  ];

  for (const [what, items] of cases) {
    it(`${what}: every card is the same height, actions on one line`, () => {
      const { nodes } = screen({ body: [{ component: "Carousel", props: { title: "Again?", itemWidth: 240 }, children: items }] });
      const track = nodes.find((n) => n.name === "Track")!;
      const cards = kids(nodes, track);
      expect(cards).toHaveLength(items.length);
      const hs = cards.map((c) => c.h);
      expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(0.5);
      const buttons = cards.map((c) => kids(nodes, c).find((k) => k.name.startsWith("Button"))!);
      const ys = buttons.map((b) => abs(nodes, b).y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(0.5);
    });
  }

  // The action can share the last row with the price: that row lines up instead.
  const caption = (text: string): Inst => ({ component: "Text", props: { text, style: "caption", tone: "secondary" } });
  const rowCard = (title: string, amount: string, note: Inst, act: Inst, meta?: string): Inst => ({
    component: "Card",
    children: [
      { component: "MediaPlaceholder", props: { label: title.split(" ")[0], height: 96 } },
      { component: "Text", props: { text: title, style: "body-strong", maxLines: 2 } },
      ...(meta ? [caption(meta)] : []),
      { component: "Stack", props: { direction: "horizontal", justify: "between", align: "center" }, children: [{ component: "Stack", props: {}, children: [{ component: "Text", props: { text: amount, style: "headline" } }, note] }, act] },
    ],
  });
  const rowCases: [string, Inst[]][] = [
    ["past orders with a tertiary Reorder beside the price", [rowCard("2× Chicken shawarma, Fattoush, Mint lemonade", "AED 68.50", caption("Today's price"), { component: "Button", props: { label: "Reorder", variant: "tertiary", size: "sm" } }), rowCard("Falafel wrap", "AED 57.00", { component: "Tag", props: { label: "Price updated", tone: "warning" } }, { component: "Button", props: { label: "Reorder", variant: "tertiary", size: "sm" } })]],
    ["groceries with a + beside the price", [rowCard("Whole milk", "AED 14.50", caption("per bottle"), { component: "IconButton", props: { icon: "plus", label: "Add" } }, "Al Rawabi · 2 litres"), rowCard("Eggs", "AED 11.00", caption("12 pack"), { component: "IconButton", props: { icon: "plus", label: "Add" } })]],
    ["hotel rooms with Book beside the nightly rate", [rowCard("Deluxe room", "$220", caption("per night"), { component: "Button", props: { label: "Book", variant: "secondary", size: "sm" } }, "Sea view · Free cancellation"), rowCard("Twin room", "$140", caption("per night"), { component: "Button", props: { label: "Book", variant: "secondary", size: "sm" } })]],
  ];
  for (const [what, items] of rowCases) {
    it(`${what}: the price rows line up at the bottom`, () => {
      const { nodes } = screen({ body: [{ component: "Carousel", props: { itemWidth: 240 }, children: items }] });
      const cards = kids(nodes, nodes.find((n) => n.name === "Track")!);
      const hs = cards.map((c) => c.h);
      expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(0.5);
      const rows = cards.map((c) => kids(nodes, c).filter((k) => k.name === "Stack").at(-1)!);
      const bottoms = rows.map((r, i) => abs(nodes, r).y + r.h - abs(nodes, cards[i]).y);
      expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(0.5);
    });
  }
});
