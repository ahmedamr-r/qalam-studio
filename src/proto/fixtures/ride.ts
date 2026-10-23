import type { ScreenSpec } from "@/design-system/builders";
import { chooseOne, confirmFirst, toastAfter } from "../recipes";
import { fixture, text, type Fixture, type FixtureDef } from "./build";

/*
 * Ride booking (a fixture): pick a ride type — the book button says which, and what it costs —
 * then confirm the pickup in a dialog, and a toast says a driver is being found. The copy is
 * fictional.
 */

/** The ride types: name, what to know, price. */
export const RIDES: [string, string, string][] = [
  ["Economy", "3 min away · 4 seats", "AED 18.00"],
  ["Comfort", "5 min away · newer cars", "AED 24.00"],
  ["Max", "8 min away · 6 seats", "AED 32.00"],
];

export const RIDE_SCREEN: ScreenSpec = {
  name: "Ride · Choose a ride",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  background: "canvas",
  header: [{ component: "TopBar", props: { title: "Choose a ride", leading: "back" } }],
  body: [
    { component: "MapPlaceholder", props: { height: 220, pin: "Gate 3", eta: "3 min" } },
    { component: "ListItem", props: { title: "Mall of the Emirates", subtitle: "Pickup at Gate 3", leadingIcon: "map-pin", trailing: "chevron" } },
    {
      component: "Card",
      props: { title: "Rides", tone: "raised" },
      children: RIDES.map(([title, subtitle, price], i) => ({ component: "ListItem", props: { title, subtitle, leadingIcon: i === 2 ? "bus" : "car", trailing: "radio", trailingText: price, checked: i === 0 } })),
    },
  ],
  footer: [{ component: "Button", props: { label: `Book ${RIDES[0][0]} · ${RIDES[0][2]}`, variant: "primary", fullWidth: true } }],
};

export const PICKUP_DIALOG: ScreenSpec = {
  name: "Confirm pickup",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  surface: "dialog",
  header: [text("Confirm your pickup", "title")],
  body: [text(`Your ${RIDES[0][0]} driver will meet you at Gate 3.`, "body", "secondary")],
  footer: [
    { component: "Button", props: { label: "Confirm pickup", variant: "primary", fullWidth: true } },
    { component: "Button", props: { label: "Change", variant: "tertiary", fullWidth: true } },
  ],
};

export const FINDING_TOAST: ScreenSpec = { name: "Finding a driver", platform: "mobile", dir: "ltr", lang: "en", surface: "toast", body: [text("Finding you a driver…", "body-strong")] };

/** The ride route: choose one, confirm first, then a toast. */
export const RIDE: FixtureDef = {
  screen: RIDE_SCREEN,
  parts: { pickup: PICKUP_DIALOG, finding: FINDING_TOAST },
  steps: [
    (_, f) => chooseOne(f.scan, { name: "ride" }),
    (r, f) => confirmFirst(r, f.scan, f.scanOf("pickup"), { part: "pickup" }),
    (r, f) => toastAfter(r, { part: "pickup", path: f.scanOf("pickup").primary!.path }, { part: "finding" }),
  ],
};

export const rideFixture = (): Fixture => fixture(RIDE);
