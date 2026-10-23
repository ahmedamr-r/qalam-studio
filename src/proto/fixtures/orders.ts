import type { ScreenSpec } from "@/design-system/builders";
import { headerOnScroll, tabPanels } from "../recipes";
import { fixture, text, type Fixture, type FixtureDef } from "./build";

/*
 * A food app's orders (a fixture): tabs switch between what's on its way and what came before.
 * The copy is fictional.
 */

export const ORDERS_SCREEN: ScreenSpec = {
  name: "Orders",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  background: "canvas",
  header: [{ component: "TopBar", props: { title: "Orders", leading: "none" } }],
  body: [
    { component: "Tabs", props: { tabs: ["Active", "Past"], selected: 0 } },
    {
      component: "Card",
      props: { title: "Active", tone: "raised" },
      children: [{ component: "ListItem", props: { title: "Al Mallah", subtitle: "On its way · 12 min", leadingIcon: "bike", trailing: "chevron" } }],
    },
    {
      component: "Card",
      props: { title: "Past", tone: "raised" },
      children: [
        { component: "ListItem", props: { title: "Burger Lab", subtitle: "Delivered on Tuesday", leadingIcon: "receipt", trailing: "chevron" } },
        { component: "ListItem", props: { title: "Sushi Corner", subtitle: "Delivered on 2 Oct", leadingIcon: "receipt", trailing: "chevron" } },
      ],
    },
    text("Orders from the last 90 days show here.", "caption", "secondary"),
  ],
};

/** The orders route: tab panels (and the header on scroll). */
export const ORDERS: FixtureDef = {
  screen: ORDERS_SCREEN,
  parts: {},
  steps: [(_, f) => headerOnScroll(f.scan), (_, f) => tabPanels(f.scan)],
};

export const ordersFixture = (): Fixture => fixture(ORDERS);
