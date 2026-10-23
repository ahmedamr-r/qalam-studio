import type { Inst, ScreenSpec } from "@/design-system/builders";
import { collectionBar, configureAndAdd, headerOnScroll, stickySections } from "../recipes";
import { fixture, text, type Fixture, type FixtureDef } from "./build";

/*
 * A fashion shop's list (a fixture): category chips over sections of products, each with its
 * price and a + that opens its options — a size that must be picked (none is, as designed) and a
 * colour that may cost more — then a bag bar. Prices are euros written the continental way
 * ("39,90 €"), and the + sits deeper in its row than a menu's. The copy is fictional.
 */

const product = (title: string, caption: string, price: string): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", gap: "300", align: "center", justify: "between" },
  children: [
    { component: "Stack", props: { direction: "vertical", gap: "100" }, children: [text(title, "body-strong"), text(caption, "caption", "secondary")] },
    {
      component: "Stack",
      props: { direction: "horizontal", gap: "200", align: "center" },
      children: [text(price, "body-strong"), { component: "IconButton", props: { icon: "plus", label: `Add ${title}`.slice(0, 24), variant: "outline" } }],
    },
  ],
});

const section = (title: string, items: [string, string, string][]): Inst => ({
  component: "Card",
  props: { title, tone: "raised" },
  children: items.flatMap((it, i) => [...(i ? [{ component: "Divider", props: {} } as Inst] : []), product(...it)]),
});

/** The products, by section: name, what it is, price. */
export const PRODUCTS: Record<string, [string, string, string][]> = {
  Tops: [
    ["Linen shirt", "Relaxed fit, sand", "39,90 €"],
    ["Ribbed tee", "Organic cotton, white", "19,90 €"],
    ["Knit polo", "Merino, navy", "49,90 €"],
  ],
  Trousers: [
    ["Pleated chinos", "Tapered, stone", "59,90 €"],
    ["Wide jeans", "Rigid denim, mid blue", "69,90 €"],
    ["Drawstring pants", "Linen, olive", "45,00 €"],
  ],
  Shoes: [
    ["Canvas sneakers", "Low top, off-white", "55,00 €"],
    ["Suede loafers", "Penny strap, tan", "89,00 €"],
    ["Leather sandals", "Two straps, black", "49,00 €"],
  ],
};

export const SHOP_SCREEN: ScreenSpec = {
  name: "Linea · New in",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  background: "canvas",
  header: [{ component: "TopBar", props: { title: "New in", leading: "back", trailing: "search" } }],
  body: [{ component: "ChipGroup", props: { chips: Object.keys(PRODUCTS), selected: 0 } }, ...Object.entries(PRODUCTS).map(([title, items]) => section(title, items))],
};

export const PRODUCT_SHEET: ScreenSpec = {
  name: "Product options",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  surface: "sheet",
  header: [{ component: "TopBar", props: { title: "Linen shirt", leading: "close" } }],
  body: [
    text("Relaxed fit, sand", "body", "secondary"),
    {
      component: "Card",
      props: { title: "Size · Required", tone: "surface" },
      children: ["S", "M", "L"].map((title) => ({ component: "ListItem", props: { title, trailing: "radio", checked: false } })),
    },
    {
      component: "Card",
      props: { title: "Colour", tone: "surface" },
      children: [
        { component: "ListItem", props: { title: "Sand", trailing: "radio", checked: true } },
        { component: "ListItem", props: { title: "Olive", trailing: "radio", trailingText: "+5,00 €", checked: false } },
      ],
    },
  ],
  footer: [
    {
      component: "Stack",
      props: { direction: "horizontal", gap: "300", align: "center" },
      children: [
        { component: "Stepper", props: { value: 1 } },
        { component: "Button", props: { label: "Add · 39,90 €", variant: "primary", fullWidth: true } },
      ],
    },
  ],
};

export const BAG_BAR: ScreenSpec = {
  name: "Bag bar",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  surface: "bar",
  body: [{ component: "Button", props: { label: "View bag · 39,90 €", variant: "primary", icon: "shopping-bag", fullWidth: true } }],
};

/** The shop route: the menu's recipes, on another kind of product. */
export const SHOP: FixtureDef = {
  screen: SHOP_SCREEN,
  parts: { options: PRODUCT_SHEET, bag: BAG_BAR },
  steps: [
    (_, f) => headerOnScroll(f.scan),
    (_, f) => stickySections(f.scan),
    (_, f) => configureAndAdd(f.scan, f.scanOf("options"), { part: "options", list: "bag" }),
    (_, f) => collectionBar(f.scan, f.scanOf("bag"), { part: "bag", list: "bag" }),
  ],
};

export const shopFixture = (): Fixture => fixture(SHOP);
