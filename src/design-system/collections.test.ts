import { beforeAll, describe, expect, it } from "vitest";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen, type Inst, type ScreenSpec } from "./builders";
import { BUILTIN } from "./resolve";
import type { ComponentDef } from "./docs";
import { withProps } from "./component-props";

/**
 * Collections: items of one kind side by side share the row, and pictures keep their shape. The
 * same rules hold for any product, so each case is a different kind of app.
 */

function build(body: Inst[], library: ComponentDef[] = [], platform: ScreenSpec["platform"] = "mobile"): SceneNode[] {
  const spec = { name: "Screen", platform, body } as ScreenSpec;
  return layoutToNodes(buildScreen(spec, BUILTIN, library), { dir: "ltr", lang: "en", ts: BUILTIN }, { x: 0, y: 0 });
}
const kids = (ns: SceneNode[], p: SceneNode) => ns.filter((n) => n.parentId === p.id);
const named = (ns: SceneNode[], name: string) => ns.filter((n) => n.name === name);
const row = (children: Inst[]): Inst => ({ component: "Stack", props: { direction: "horizontal", gap: "400" }, children });

const tile = (name: string, price: string, tag?: string): Inst => ({
  component: "Stack",
  props: { gap: "200" },
  children: [
    { component: "Image", props: { alt: `${name} photo`, aspect: "1:1", radius: "lg", src: "" } },
    ...(tag ? [{ component: "Tag", props: { label: tag, tone: "brand" } }] : []),
    { component: "Text", props: { text: name, style: "body-strong", maxLines: 2 } },
    { component: "Text", props: { text: price, style: "body" } },
  ],
});

describe("collections", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("food tiles with names of different lengths share the row, with square pictures", () => {
    const ns = build([row([tile("Classic Koshary", "EGP 120.00", "Popular"), tile("Pink Ta'ameya Sandwich", "EGP 45.00")])]);
    const pics = [...named(ns, "Classic Koshary photo"), ...named(ns, "Pink Ta'ameya Sandwich photo")];
    expect(pics).toHaveLength(2);
    expect(pics[0].w).toBe(pics[1].w);
    for (const p of pics) expect(Math.abs(p.h - p.w)).toBeLessThanOrEqual(1);
    // Half the content width each, less the gap: not sized by their text.
    expect(pics[0].w).toBeGreaterThan(150);
  });

  it("pricing plans and quick actions (icon-led columns) share the row too", () => {
    const plan = (name: string, price: string): Inst => ({ component: "Stack", props: { gap: "100" }, children: [{ component: "Icon", props: { icon: "star" } }, { component: "Text", props: { text: name, style: "headline" } }, { component: "Text", props: { text: price } }] });
    const ns = build([row([plan("Basic", "$0"), plan("Professional plus", "$29 / month"), plan("Team", "$99")])]);
    const r = ns.find((n) => n.name === "Stack" && kids(ns, n).length === 3 && kids(ns, n).every((k) => k.name === "Stack"))!;
    const ws = kids(ns, r).map((k) => k.w);
    // Equal shares, to the pixel the layout rounds to.
    expect(Math.max(...ws) - Math.min(...ws)).toBeLessThanOrEqual(1);
    expect(Math.min(...ws)).toBeGreaterThan(100);
  });

  it("a product's own components side by side share the row", () => {
    const ride: ComponentDef = withProps({
      name: "Ride Option",
      purpose: "A ride type with its price",
      composition: { component: "Stack", props: { gap: "100" }, children: [{ component: "Icon", props: { icon: "car" } }, { component: "Text", props: { text: "Comfort", style: "body-strong" } }, { component: "Text", props: { text: "AED 24", style: "body" } }] },
    });
    const use = (values: Record<string, string>): Inst => ({ component: "Custom", props: { name: "Ride Option", values: Object.entries(values).map(([prop, value]) => ({ prop, value })) } });
    const ns = build([row([use({ title: "Economy" }), use({ title: "Business class with extra room" })])], [ride]);
    const items = ns.filter((n) => n.name === "Ride Option");
    expect(items).toHaveLength(2);
    expect(items[0].w).toBe(items[1].w);
  });

  it("gives a row's one column of text the room left, so long copy wraps beside a photo and a +, an avatar and a chevron, an amount", () => {
    const texts = (title: string, caption: string): Inst => ({ component: "Stack", props: { gap: "100" }, children: [{ component: "Text", props: { text: title, style: "body-strong" } }, { component: "Text", props: { text: caption, style: "caption", maxLines: 2 } }] });
    const long = "Garlic toum, pickles and fries rolled in Arabic bread, toasted on the grill with extra sauce";
    const dish = { component: "Stack", props: { direction: "horizontal", gap: "300", justify: "between" }, children: [texts("Chicken shawarma", long), { component: "Stack", props: { gap: "200" }, children: [{ component: "Image", props: { alt: "Dish photo", src: "", width: 88, aspect: "1:1" } }, { component: "IconButton", props: { icon: "plus", label: "Add" } }] }] };
    const contact = { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [{ component: "Avatar", props: { name: "Mariam Haddad" } }, texts("Mariam Haddad", `Last paid AED 250.00 for dinner at the place by the marina, split three ways with ${long}`), { component: "Icon", props: { icon: "chevron-right" } }] };
    const payment = { component: "Stack", props: { direction: "horizontal", gap: "300", justify: "between" }, children: [texts("Dubai Electricity and Water Authority bill", long), { component: "Text", props: { text: "−AED 412.50", style: "body-strong" } }] };
    const ns = build([dish, contact, payment] as Inst[]);
    const rows = ns.filter((n) => n.name === "Stack" && kids(ns, n).length >= 2 && n.type === "frame" && (n as Extract<SceneNode, { type: "frame" }>).layout?.direction === "horizontal");
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const last = kids(ns, r).at(-1)!;
      // Everything stays inside the row; the text column wraps instead.
      expect(last.x + last.w).toBeLessThanOrEqual(r.w + 0.5);
      const col = kids(ns, r).find((k) => k.name === "Stack" && kids(ns, k).some((t) => t.type === "text"))!;
      expect(col.w).toBeLessThan(r.w);
    }
  });

  it("leaves a centred row's text hugging it", () => {
    const ns = build([{ component: "Stack", props: { direction: "horizontal", gap: "200", justify: "center" }, children: [{ component: "Icon", props: { icon: "shield-check" } }, { component: "Stack", props: { gap: "0" }, children: [{ component: "Text", props: { text: "Secure checkout", style: "caption" } }] }] }]);
    const col = ns.find((n) => n.name === "Stack" && kids(ns, n).length === 1 && kids(ns, n)[0].type === "text")!;
    const r = ns.find((n) => n.id === col.parentId)!;
    expect(col.w).toBeLessThan(r.w / 2);
  });

  it("leaves rows that aren't collections alone: a label and its value, a set of tags", () => {
    const pair: Inst = row([
      { component: "Stack", children: [{ component: "Text", props: { text: "Subtotal" } }, { component: "Text", props: { text: "3 items", style: "caption" } }] },
      { component: "Stack", children: [{ component: "Text", props: { text: "$42.00" } }] },
    ]);
    const tags: Inst = row([{ component: "Tag", props: { label: "New" } }, { component: "Tag", props: { label: "Free delivery" } }]);
    const ns = build([pair, tags]);
    const stacks = ns.filter((n) => n.name === "Stack" && n.parentId && ns.find((p) => p.id === n.parentId)?.name === "Stack");
    const ws = stacks.slice(0, 2).map((s) => Math.round(s.w));
    expect(ws[0]).not.toBe(ws[1]);
    const tagWs = ns.filter((n) => n.name === "Tag" || n.name?.startsWith("Tag")).map((n) => Math.round(n.w));
    expect(new Set(tagWs).size).toBeGreaterThan(1);
  });

  it("a picture with an aspect keeps its shape at any width (a 16:9 cover, a 3:4 poster)", () => {
    const ns = build([
      { component: "MediaPlaceholder", props: { aspect: "16:9", label: "Cover" } },
      row([0, 1, 2].map((i) => ({ component: "Stack", children: [{ component: "Image", props: { alt: `Poster ${i}`, aspect: "3:4", src: "" } }, { component: "Text", props: { text: `Film ${i}` } }] }))),
    ]);
    const cover = ns.find((n) => n.name === "Media")!;
    expect(Math.abs(cover.h - (cover.w * 9) / 16)).toBeLessThanOrEqual(1);
    for (const p of ns.filter((n) => n.name.startsWith("Poster"))) expect(Math.abs(p.h - (p.w * 4) / 3)).toBeLessThanOrEqual(1);
  });

  it("an Image without an aspect keeps its height", () => {
    const ns = build([{ component: "Image", props: { alt: "Banner", height: 140, src: "" } }]);
    expect(ns.find((n) => n.name === "Banner")!.h).toBe(140);
  });
});
