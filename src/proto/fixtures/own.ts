import type { Inst, ScreenSpec } from "@/design-system/builders";
import type { ComponentDef } from "@/design-system/docs";

/*
 * Screens made of components of their own, the way Generate draws a product's repeated things
 * (a dish row, a product card) when the design system has none: the items' layers have no spec
 * paths, so what's tapped in them is found by role. A menu whose sections are headings over rows,
 * and a shop whose card has a heart before its Add. The copy is fictional.
 */

const custom = (name: string, values: Record<string, string>): Inst => ({ component: "Custom", props: { name, values: Object.entries(values).map(([prop, value]) => ({ prop, value })) } });

const DISH_ROW: ComponentDef = {
  name: "Dish Row",
  purpose: "A dish in a restaurant's menu: its name, what's in it and its price, with a photo and an add button.",
  props: [
    { name: "name", kind: "text", maxChars: 32, example: "Chicken shawarma" },
    { name: "description", kind: "text", maxChars: 70, example: "Garlic toum, pickles, fries" },
    { name: "price", kind: "text", maxChars: 12, example: "AED 14.00" },
  ],
  composition: {
    component: "Stack",
    props: { direction: "horizontal", gap: "300", align: "start", justify: "between", padding: "300" },
    children: [
      {
        component: "Stack",
        props: { direction: "vertical", gap: "100" },
        children: [
          { component: "Text", props: { text: "{name}", style: "body-strong", maxLines: 1 } },
          { component: "Text", props: { text: "{description}", style: "caption", tone: "secondary", maxLines: 2 } },
          { component: "Text", props: { text: "{price}", style: "label" } },
        ],
      },
      {
        component: "Stack",
        props: { direction: "vertical", gap: "200", align: "center" },
        children: [
          { component: "Image", props: { alt: "Dish photo", src: "", width: 88, aspect: "1:1", radius: "md" } },
          { component: "IconButton", props: { icon: "plus", label: "Add to basket", variant: "outline" } },
        ],
      },
    ],
  },
};

const DISH_TILE: ComponentDef = {
  name: "Dish Tile",
  purpose: "A dish in a carousel of popular ones: photo, name, price and a quick add.",
  props: [
    { name: "name", kind: "text", maxChars: 24, example: "Chicken platter" },
    { name: "price", kind: "text", maxChars: 12, example: "AED 29.00" },
  ],
  composition: {
    component: "Stack",
    props: { direction: "vertical", gap: "200" },
    children: [
      { component: "Image", props: { alt: "Dish photo", src: "", aspect: "1:1", radius: "lg" } },
      { component: "Text", props: { text: "{name}", style: "body-strong", maxLines: 1 } },
      {
        component: "Stack",
        props: { direction: "horizontal", justify: "between", align: "center", gap: "200" },
        children: [
          { component: "Text", props: { text: "{price}", style: "label" } },
          { component: "IconButton", props: { icon: "plus", label: "Add to basket", variant: "outline" } },
        ],
      },
    ],
  },
};

const heading = (text: string, rows: Inst[]): Inst => ({
  component: "Stack",
  props: { direction: "vertical", gap: "0" },
  children: [{ component: "Text", props: { text, style: "headline" } }, ...rows.flatMap((r, i) => [...(i ? [{ component: "Divider", props: {} } as Inst] : []), r])],
});

/** A shawarma place's menu: popular dishes in a carousel, then sections of rows under headings, with tabs naming them. */
export const OWN_MENU: ScreenSpec = {
  name: "Al Diyafa · Menu",
  platform: "mobile",
  components: [DISH_ROW, DISH_TILE],
  header: [{ component: "TopBar", props: { title: "Al Diyafa", leading: "back", trailing: "search" } }],
  body: [
    { component: "Text", props: { text: "Lebanese · Shawarma · 25–35 min · AED 5 delivery", style: "caption", tone: "secondary" } },
    { component: "Tabs", props: { tabs: ["Popular", "Sandwiches", "Plates"], selected: 0 } },
    {
      component: "Carousel",
      props: { title: "Popular", itemWidth: 148, gap: "300" },
      children: [custom("Dish Tile", { name: "Chicken platter", price: "AED 29.00" }), custom("Dish Tile", { name: "Spicy beef saj", price: "AED 21.00" }), custom("Dish Tile", { name: "Falafel box", price: "AED 18.00" })],
    },
    heading("Sandwiches", [
      custom("Dish Row", { name: "Chicken shawarma", description: "Garlic toum, pickles, fries", price: "AED 14.00" }),
      custom("Dish Row", { name: "Beef shawarma", description: "Tahini, parsley, onions", price: "AED 17.00" }),
      custom("Dish Row", { name: "Falafel wrap", description: "Hummus, turnips, mint", price: "AED 12.00" }),
    ]),
    heading("Plates", [
      custom("Dish Row", { name: "Mixed grill", description: "Kofta, tawook, rice, salad", price: "AED 42.00" }),
      custom("Dish Row", { name: "Shawarma plate", description: "Chicken, fries, garlic, salad", price: "AED 32.00" }),
    ]),
  ],
};

const PRODUCT_CARD: ComponentDef = {
  name: "Product Card",
  purpose: "A product in a shop's grid: photo, name and price, a heart to save it and Add.",
  props: [
    { name: "name", kind: "text", maxChars: 28, example: "Linen shirt" },
    { name: "price", kind: "text", maxChars: 12, example: "€49,00" },
  ],
  composition: {
    component: "Stack",
    props: { direction: "vertical", gap: "200" },
    children: [
      { component: "Image", props: { alt: "Product photo", src: "", aspect: "1:1", radius: "md" } },
      {
        component: "Stack",
        props: { direction: "horizontal", justify: "between", align: "center", gap: "200" },
        children: [
          { component: "Text", props: { text: "{name}", style: "body-strong", maxLines: 1 } },
          { component: "IconButton", props: { icon: "heart", label: "Save", variant: "ghost" } },
        ],
      },
      { component: "Text", props: { text: "{price}", style: "label" } },
      { component: "Button", props: { label: "Add to bag", variant: "secondary", fullWidth: true } },
    ],
  },
};

/** A clothes shop's new arrivals: product cards in rows of two, each with a heart before its Add. */
export const OWN_SHOP: ScreenSpec = {
  name: "Maison · New in",
  platform: "mobile",
  components: [PRODUCT_CARD],
  header: [{ component: "TopBar", props: { title: "New in", leading: "back", trailing: "shopping-bag" } }],
  body: [
    { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [custom("Product Card", { name: "Linen shirt", price: "€49,00" }), custom("Product Card", { name: "Wide trousers", price: "€69,00" })] },
    { component: "Stack", props: { direction: "horizontal", gap: "300" }, children: [custom("Product Card", { name: "Knit vest", price: "€39,00" }), custom("Product Card", { name: "Canvas tote", price: "€25,00" })] },
  ],
};

const dishRow = (title: string, caption: string, price: string): Inst => ({ component: "ListItem", props: { title, subtitle: caption, trailing: "text", trailingText: price } });

/** A menu whose dishes have no + of their own: tapping a dish opens its options, the way Deliveroo does it. */
export const TAP_MENU: ScreenSpec = {
  name: "Zaatar w Zeit · Menu",
  platform: "mobile",
  header: [{ component: "TopBar", props: { title: "Zaatar w Zeit", leading: "back" } }],
  body: [
    { component: "Tabs", props: { tabs: ["Wraps", "Plates"], selected: 0 } },
    {
      component: "Card",
      props: { title: "Wraps", tone: "raised" },
      children: [dishRow("Chicken shawarma", "Garlic toum, pickles", "AED 18.00"), { component: "Divider", props: {} }, dishRow("Halloumi wrap", "Tomato, mint", "AED 16.00")],
    },
    {
      component: "Card",
      props: { title: "Plates", tone: "raised" },
      children: [dishRow("Mixed grill", "Kofta, tawook, rice", "AED 46.00"), { component: "Divider", props: {} }, dishRow("Fattoush", "Sumac, pomegranate", "AED 19.00")],
    },
  ],
};
