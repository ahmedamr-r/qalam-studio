import type { Inst, ScreenSpec } from "@/design-system/builders";
import type { Doc, RouteProto, VarDef } from "@/doc/schema";
import { buildScreenNodes } from "@/design-system/place";
import { PART_DROP, PART_GAP } from "../edit";
import { scanFrame } from "../scan";
import { applyDelta, collectionBar, configureAndAdd, headerOnScroll, stickySections } from "../recipes";

/*
 * A restaurant menu as a route (a fixture for tests and the demo): the menu screen, the options
 * sheet a dish opens (the way Deliveroo and Bolt Food do it), and the basket bar that shows once
 * something is added. The copy is fictional.
 */

const dish = (title: string, caption: string, price: string): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", gap: "300", align: "center", justify: "between" },
  children: [
    {
      component: "Stack",
      props: { direction: "vertical", gap: "100" },
      children: [
        { component: "Text", props: { text: title, style: "body-strong" } },
        { component: "Text", props: { text: caption, style: "caption", tone: "secondary", maxLines: 2 } },
        { component: "Text", props: { text: price, style: "body-strong" } },
      ],
    },
    { component: "IconButton", props: { icon: "plus", label: `Add ${title}`.slice(0, 24), variant: "outline" } },
  ],
});

/** A menu section: its dishes in a card, divided. */
const section = (title: string, dishes: [string, string, string][]): Inst => ({
  component: "Card",
  props: { title, tone: "raised" },
  children: dishes.flatMap((d, i) => [...(i ? [{ component: "Divider", props: {} } as Inst] : []), dish(...d)]),
});

export const MENU_SCREEN: ScreenSpec = {
  name: "Al Mallah · Menu",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  background: "canvas",
  header: [{ component: "TopBar", props: { title: "Al Mallah", leading: "back", trailing: "search" } }],
  body: [
    { component: "Rating", props: { value: 4.6, count: "Lebanese · 25–35 min" } },
    { component: "ChipGroup", props: { chips: ["Popular", "Shawarma", "Plates", "Drinks"], selected: 0 } },
    section("Popular", [
      ["Chicken shawarma", "Garlic toum, pickles and fries in saj bread", "AED 18.00"],
      ["Falafel wrap", "Tahini, parsley, tomato and turnip pickles", "AED 14.00"],
      ["Halloumi manoushe", "Grilled halloumi, tomato and mint on flatbread", "AED 15.00"],
    ]),
    section("Shawarma", [
      ["Beef shawarma", "Tahini, onions, sumac and parsley in Arabic bread", "AED 20.00"],
      ["Shawarma plate", "Chicken, fries, garlic toum and pickles", "AED 32.00"],
      ["Shawarma fatteh", "Crisp bread, chickpeas, yoghurt and pine nuts", "AED 28.00"],
    ]),
    section("Plates", [
      ["Mixed grill", "Shish tawook, kofta and lamb with rice", "AED 46.00"],
      ["Hummus beiruti", "Chickpeas, chilli, parsley and olive oil", "AED 16.00"],
      ["Fattoush", "Crisp bread, sumac, pomegranate and greens", "AED 19.00"],
    ]),
    section("Drinks", [
      ["Fresh lemon mint", "Blended with ice", "AED 12.00"],
      ["Laban ayran", "Salted yoghurt drink", "AED 6.00"],
      ["Jallab", "Grape molasses, rose water and pine nuts", "AED 10.00"],
    ]),
  ],
};

export const OPTIONS_SHEET: ScreenSpec = {
  name: "Dish options",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  surface: "sheet",
  header: [{ component: "TopBar", props: { title: "Chicken shawarma", leading: "close" } }],
  body: [
    { component: "Text", props: { text: "Garlic toum, pickles and fries in saj bread", style: "body", tone: "secondary" } },
    {
      component: "Card",
      props: { title: "Size · Required", tone: "surface" },
      children: [
        { component: "ListItem", props: { title: "Regular", trailing: "radio", trailingText: "AED 18.00", checked: true } },
        { component: "ListItem", props: { title: "Large", trailing: "radio", trailingText: "+AED 6.00", checked: false } },
      ],
    },
    {
      component: "Card",
      props: { title: "Extras", tone: "surface" },
      children: [
        { component: "ListItem", props: { title: "Extra garlic", trailing: "checkbox", trailingText: "+AED 2.00", checked: false } },
        { component: "ListItem", props: { title: "Cheese", trailing: "checkbox", trailingText: "+AED 3.00", checked: false } },
      ],
    },
  ],
  footer: [
    {
      component: "Stack",
      props: { direction: "horizontal", gap: "300", align: "center" },
      children: [
        { component: "Stepper", props: { value: 1 } },
        { component: "Button", props: { label: "Add · AED 18.00", variant: "primary", fullWidth: true } },
      ],
    },
  ],
};

export const BASKET_BAR: ScreenSpec = {
  name: "Basket bar",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  surface: "bar",
  body: [{ component: "Button", props: { label: "View basket · AED 18.00", variant: "primary", icon: "shopping-bag", fullWidth: true } }],
};

/**
 * The route, from recipes over what the scan finds: the header compacts on scroll; the category
 * chips stick, follow the section in view and scroll to theirs; a dish's + opens its options
 * (a required size, any extras, a quantity, a live total) and Add puts it in the basket; the
 * basket bar shows once something's in it, and each dish shows how many are.
 */
export function menuRoute(doc: Doc, ids: { menu: string; sheet: { frame: string; part: string }; bar: { frame: string; part: string } }): { route: RouteProto; appVars: Record<string, VarDef> } {
  let route: RouteProto = {
    overlays: { [ids.sheet.part]: { frame: ids.sheet.frame, kind: "sheet", dismiss: ["scrim", "drag", "back"] } },
    addOns: { [ids.bar.part]: { frame: ids.bar.frame, region: "bottom" } },
    rules: [],
  };
  const screen = scanFrame(doc, ids.menu);
  const sheet = scanFrame(doc, ids.sheet.frame);
  const bar = scanFrame(doc, ids.bar.frame);
  let appVars: Record<string, VarDef> = {};
  for (const d of [headerOnScroll(screen), stickySections(screen), configureAndAdd(screen, sheet, { part: ids.sheet.part }), collectionBar(screen, bar, { part: ids.bar.part })]) {
    if (d.skipped) continue;
    route = applyDelta(route, d);
    appVars = { ...appVars, ...d.appVars };
  }
  return { route, appVars };
}

/** The menu route as a document (needs ensureYoga first), parts under the screen as the studio places them. */
export function foodMenuDoc(): { doc: Doc; ids: { menu: string; sheet: string; bar: string } } {
  const doc: Doc = { nodes: {}, roots: [] };
  const add = (spec: ScreenSpec, at: { x: number; y: number }) => {
    const nodes = buildScreenNodes(spec, "builtin", at, "ai");
    for (const n of nodes) doc.nodes[n.id] = n;
    doc.roots.push(nodes[0].id);
    return nodes[0];
  };
  const menu = add(MENU_SCREEN, { x: 0, y: 0 });
  const sheet = add(OPTIONS_SHEET, { x: 0, y: menu.h + PART_DROP });
  const bar = add(BASKET_BAR, { x: sheet.w + PART_GAP, y: menu.h + PART_DROP });
  const { route, appVars } = menuRoute(doc, { menu: menu.id, sheet: { frame: sheet.id, part: "options" }, bar: { frame: bar.id, part: "basket" } });
  doc.proto = { links: [], states: {}, tracks: [], start: menu.id, routes: { [menu.id]: route }, vars: appVars };
  return { doc, ids: { menu: menu.id, sheet: sheet.id, bar: bar.id } };
}
